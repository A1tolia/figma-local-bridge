import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const runtimePath = process.env.FIGMA_BRIDGE_STATE || fileURLToPath(new URL('../.runtime/connection.json', import.meta.url));
const secret = () => randomBytes(32).toString('hex');
export async function startBroker({ port = 19429, statePath = runtimePath, ttl = 30000 } = {}) {
  const controllerToken = secret(), pairingToken = secret();
  const sessions = new Map(), jobs = new Map();
  const json = (res, status, data) => { res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'}); res.end(JSON.stringify(data)); };
  async function body(req) {
    let data = '';
    for await (const chunk of req) { data += chunk; if (data.length > 2_000_000) throw new Error('Body too large'); }
    return data ? JSON.parse(data) : {};
  }
  const server = http.createServer(async (req, res) => {
    try {
      const localPort = server.address().port;
      if (![ `127.0.0.1:${localPort}`, `localhost:${localPort}` ].includes(req.headers.host)) return json(res,403,{error:'Invalid host'});
      const origin = req.headers.origin;
      if (origin && origin !== 'null' && origin !== 'https://www.figma.com' && origin !== 'https://figma.com') return json(res,403,{error:'Origin denied'});
      if (origin) { res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin'); }
      res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Private-Network','true');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (req.method !== 'POST') return json(res,405,{error:'POST required'});
      const token = (req.headers.authorization || '').replace(/^Bearer /,'');
      const route = req.url;
      if (route === '/connect') {
        if (token !== pairingToken) return json(res,401,{error:'Invalid pairing code'});
        const data = await body(req);
        if (sessions.size >= 16) return json(res,429,{error:'Too many sessions; disconnect another plugin or restart bridge'});
        const id = randomUUID(), sessionToken = secret();
        sessions.set(id,{id, token:sessionToken, name:String(data.name || 'Untitled').slice(0,200), page:String(data.page || '').slice(0,200), lastSeen:Date.now()});
        return json(res,200,{sessionId:id, sessionToken});
      }
      const controller = ['/status','/command','/job'].includes(route);
      let session;
      if (controller) {
        if (origin || token !== controllerToken) return json(res,401,{error:'Controller authentication required'});
      } else {
        session = [...sessions.values()].find(s => s.token === token);
        if (!session) return json(res,401,{error:'Session authentication required'});
        session.lastSeen = Date.now();
      }
      const data = await body(req);
      if (route === '/status') return json(res,200,{sessions:[...sessions.values()].map(({token,...s}) => ({...s, online:Date.now()-s.lastSeen < 10000}))});
      if (route === '/disconnect') {
        sessions.delete(session.id);
        for (const job of jobs.values()) if (job.sessionId === session.id && job.state === 'queued') { job.state='failed'; job.error='Plugin disconnected before execution'; }
        return json(res,200,{ok:true});
      }
      if (route === '/command') {
        const target = sessions.get(data.sessionId);
        if (!target || Date.now()-target.lastSeen > 10000) return json(res,409,{error:'Selected Figma session is offline; run plugin and reconnect'});
        if (!['document','apply','export','fonts'].includes(data.action)) return json(res,400,{error:'Unknown action'});
        if (typeof data.requestId !== 'string' || !/^[\w-]{8,100}$/.test(data.requestId)) return json(res,400,{error:'requestId must be 8-100 letters, numbers, hyphens or underscores'});
        const fingerprint = JSON.stringify([data.sessionId,data.action,data.payload]);
        const previous = [...jobs.values()].find(j=>j.requestId === data.requestId);
        if (previous) {
          if (previous.fingerprint !== fingerprint) return json(res,409,{error:'requestId reused with different content'});
          return json(res,200,{jobId:previous.id, state:previous.state});
        }
        if (jobs.size >= 500) return json(res,429,{error:'Job history full; restart bridge after checking all pending jobs'});
        const job = {id:randomUUID(), requestId:data.requestId, sessionId:data.sessionId, action:data.action, payload:data.payload || {}, fingerprint, state:'queued', createdAt:Date.now()};
        jobs.set(job.id,job);
        return json(res,200,{jobId:job.id,state:job.state});
      }
      if (route === '/poll') {
        if ([...jobs.values()].some(j=>j.sessionId===session.id && j.state==='running')) return json(res,200,{job:null});
        for (const job of jobs.values()) {
          if (job.sessionId !== session.id || job.state !== 'queued') continue;
          if (Date.now()-job.createdAt > ttl) {job.state='failed';job.error='Expired before execution';continue;}
          job.state='running';
          return json(res,200,{job:{id:job.id,action:job.action,payload:job.payload}});
        }
        return json(res,200,{job:null});
      }
      if (route === '/result') {
        const job = jobs.get(data.id);
        if (!job || job.sessionId !== session.id) return json(res,404,{error:'Unknown job'});
        if (job.state === 'running') { job.state=data.error ? 'failed':'done'; job.result=data.result;job.error=data.error; }
        return json(res,200,{ok:true});
      }
      if (route === '/job') {
        const job = jobs.get(data.jobId);
        if (!job) return json(res,404,{error:'Unknown job; history exists only until bridge restart'});
        if (job.state === 'queued' && Date.now()-job.createdAt > ttl) {job.state='failed';job.error='Expired before execution';}
        const {fingerprint,payload,...publicJob} = job;
        return json(res,200,publicJob);
      }
      json(res,404,{error:'Unknown route'});
    } catch (e) { if (!res.headersSent) json(res,400,{error:e.message}); else res.end(); }
  });
  server.requestTimeout = 15000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const address = `http://127.0.0.1:${server.address().port}`;
  if (statePath) {
    await mkdir(path.dirname(statePath),{recursive:true});
    await writeFile(statePath,JSON.stringify({address,controllerToken}),{mode:0o600});
  }
  return {address,controllerToken,pairingToken,server,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));if(statePath)await unlink(statePath).catch(()=>{});}};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const bridge = await startBroker();
    console.log(`Figma Local Bridge\nAddress: ${bridge.address}\nPairing code (paste into Figma plugin):\n${bridge.pairingToken}\nKeep this window open. Ctrl+C stops the bridge.`);
    process.once('SIGINT',()=>bridge.close().then(()=>process.exit(0)));
    process.once('SIGTERM',()=>bridge.close().then(()=>process.exit(0)));
  } catch(e) { console.error(e.code === 'EADDRINUSE' ? 'Port 19429 is occupied. Close the previous bridge or the process using this port.' : e.message);process.exitCode=1; }
}
