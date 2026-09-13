import test from 'node:test';
import assert from 'node:assert/strict';
import {startBroker} from '../server/broker.mjs';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import http from 'node:http';
import {fileURLToPath} from 'node:url';

async function setup(t,options={}) {
  const b=await startBroker({port:0,statePath:null,...options});t.after(()=>b.close());
  b.post=async(route,data={},token=b.controllerToken,headers={})=>{
    const r=await fetch(b.address+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...headers},body:JSON.stringify(data)});
    return {status:r.status,data:await r.json()};
  };
  b.connect=async()=> (await b.post('/connect',{name:'Test file'},b.pairingToken)).data;
  return b;
}
test('authentication, role separation, origin and host validation',async t=>{
  const b=await setup(t);
  assert.equal((await b.post('/status',{},'wrong')).status,401);
  assert.equal((await b.post('/connect',{},b.controllerToken)).status,401);
  assert.equal((await b.post('/status',{},b.controllerToken,{Origin:'https://evil.example'})).status,403);
  assert.equal((await b.post('/status',{},b.controllerToken,{Origin:'null'})).status,401);
  const wrongHostStatus=await new Promise((resolve,reject)=>{const req=http.request(b.address+'/status',{method:'POST',headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end('{}');});
  assert.equal(wrongHostStatus,403);
  const localhostResponse = await fetch(b.address.replace('127.0.0.1','localhost')+'/connect', {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+b.pairingToken},body:JSON.stringify({name:'Localhost test'})});
  assert.equal(localhostResponse.status,200);
  const localhostSession=await localhostResponse.json();
  await b.post('/disconnect',{},localhostSession.sessionToken);
  const s=await b.connect();assert.ok(s.sessionToken);
  assert.equal((await b.post('/status',{},s.sessionToken)).status,401);
  const status=(await b.post('/status')).data;
  assert.equal(status.sessions[0].name,'Test file');assert.equal(status.sessions[0].token,undefined);
});
test('deduplication, session isolation, result delivery and job lookup',async t=>{
  const b=await setup(t),s=await b.connect(),other=await b.connect();
  const command={sessionId:s.sessionId,requestId:'unique-001',action:'apply',payload:{operations:[]}};
  const j=(await b.post('/command',command)).data;
  assert.equal((await b.post('/command',command)).data.jobId,j.jobId);
  assert.equal((await b.post('/command',{...command,payload:{different:true}})).status,409);
  assert.equal((await b.post('/poll',{},other.sessionToken)).data.job,null);
  assert.equal((await b.post('/poll',{},s.sessionToken)).data.job.id,j.jobId);
  assert.equal((await b.post('/poll',{},s.sessionToken)).data.job,null);
  assert.equal((await b.post('/result',{id:j.jobId,result:{ok:true}},other.sessionToken)).status,404);
  await b.post('/result',{id:j.jobId,result:{ok:true}},s.sessionToken);
  await b.post('/result',{id:j.jobId,result:{ok:false}},s.sessionToken);
  assert.deepEqual((await b.post('/job',{jobId:j.jobId})).data.result,{ok:true});
});
test('disconnect cancels queued work and rejects new commands',async t=>{
  const b=await setup(t),s=await b.connect();
  const j=(await b.post('/command',{sessionId:s.sessionId,requestId:'unique-002',action:'document',payload:{}})).data;
  await b.post('/disconnect',{},s.sessionToken);
  assert.equal((await b.post('/job',{jobId:j.jobId})).data.state,'failed');
  assert.equal((await b.post('/command',{sessionId:s.sessionId,requestId:'unique-003',action:'document'})).status,409);
});
test('queued mutations expire before late polling',async t=>{
  const b=await setup(t,{ttl:1}),s=await b.connect();
  const j=(await b.post('/command',{sessionId:s.sessionId,requestId:'unique-004',action:'apply',payload:{}})).data;
  await new Promise(r=>setTimeout(r,10));
  assert.equal((await b.post('/poll',{},s.sessionToken)).data.job,null);
  assert.equal((await b.post('/job',{jobId:j.jobId})).data.state,'failed');
});
test('real stdio MCP round trip through HTTP broker to a simulated plugin',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'figma-bridge-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'state.json');
  const b=await setup(t,{statePath}),s=await b.connect();
  const child=spawn(process.execPath,[fileURLToPath(new URL('../server/mcp.mjs',import.meta.url))],{env:{...process.env,FIGMA_BRIDGE_STATE:statePath},stdio:['pipe','pipe','pipe']});
  t.after(()=>{child.kill();});
  const pending=new Map();let id=0;
  readline.createInterface({input:child.stdout}).on('line',line=>{const v=JSON.parse(line);pending.get(v.id)?.(v);pending.delete(v.id);});
  const rpc=(method,params)=>new Promise((resolve,reject)=>{
    const reqId=++id,timer=setTimeout(()=>reject(new Error('RPC timeout')),4000);
    pending.set(reqId,value=>{clearTimeout(timer);resolve(value);});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:reqId,method,params})+'\n');
  });
  const initialized=(await rpc('initialize',{protocolVersion:'2025-06-18'})).result;
  assert.deepEqual(initialized.serverInfo,{name:'figma-local-bridge',version:'1.0.5'});
  const listed=(await rpc('tools/list',{})).result.tools;
  assert.equal(listed.length,6);
  const readOnly={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
  for (const tool of listed) {
    assert.equal(Object.keys(tool.annotations).length,4);
    assert.deepEqual(tool.annotations,tool.name==='figma_local_apply'
      ? {readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}
      : readOnly);
  }
  assert.equal(JSON.parse((await rpc('tools/call',{name:'figma_local_status',arguments:{}})).result.content[0].text).sessions.length,1);
  const roundTrip=async(name,args,expectedAction,result)=>{
    const response=rpc('tools/call',{name,arguments:args});
    let job;
    for(let i=0;i<50;i++){job=(await b.post('/poll',{},s.sessionToken)).data.job;if(job)break;await new Promise(r=>setTimeout(r,20));}
    assert.ok(job,`${name} did not reach the simulated plugin`);
    assert.equal(job.action,expectedAction);
    await b.post('/result',{id:job.id,result},s.sessionToken);
    return {job,response:await response};
  };
  const document=await roundTrip('figma_local_document',{sessionId:s.sessionId},'document',{fileName:'Test file'});
  assert.equal(JSON.parse(document.response.result.content[0].text).fileName,'Test file');
  const apply=await roundTrip('figma_local_apply',{sessionId:s.sessionId,requestId:'mcp-round-trip-apply',operations:[{op:'select',nodeIds:[]}]},'apply',{ok:true,completed:1});
  assert.equal(JSON.parse(apply.response.result.content[0].text).completed,1);
  const exported=await roundTrip('figma_local_export',{sessionId:s.sessionId,nodeId:'1:2',format:'PNG'},'export',{format:'PNG',data:'aW1hZ2U='});
  assert.deepEqual(exported.response.result.content,[{type:'image',data:'aW1hZ2U=',mimeType:'image/png'}]);
  const fonts=await roundTrip('figma_local_fonts',{sessionId:s.sessionId,query:'Inter'},'fonts',{fonts:[{family:'Inter',style:'Regular'}]});
  assert.equal(JSON.parse(fonts.response.result.content[0].text).fonts[0].family,'Inter');
  const jobState=JSON.parse((await rpc('tools/call',{name:'figma_local_job',arguments:{jobId:apply.job.id}})).result.content[0].text);
  assert.equal(jobState.state,'done');
  assert.equal(jobState.result.completed,1);
  assert.equal((await rpc('tools/call',{name:'no_such_tool'})).result.isError,true);
});
