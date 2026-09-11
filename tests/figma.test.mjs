import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../figma/code.js',import.meta.url),'utf8');
function sandbox() {
  let next=0,undo=0;const nodes=new Map(),fonts=[];
  function node(type){
    const n={id:String(++next),type,name:type,removed:false,x:0,y:0,width:100,height:100,fills:[],strokes:[],strokeWeight:1,cornerRadius:0,effects:[],
      layoutPositioning:'AUTO',layoutGrow:0,layoutAlign:'INHERIT',constraints:{horizontal:'MIN',vertical:'MIN'},overflowDirection:'NONE',clipsContent:false,
      resize(w,h){this.width=w;this.height=h;},remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}};
    if(['PAGE','FRAME','COMPONENT'].includes(type)){n.children=[];n.appendChild=function(child){if(child.parent)child.parent.children=child.parent.children.filter(n=>n!==child);this.children.push(child);child.parent=this;};n.loadAsync=async()=>{};}
    if(type==='TEXT'){n.fontName={family:'Inter',style:'Regular'};n.fontSize=12;n.getRangeAllFontNames=()=>[n.fontName];let chars='';Object.defineProperty(n,'characters',{get:()=>chars,set:v=>{if(!fonts.length)throw new Error('Font not loaded');chars=v;},enumerable:true});}
    nodes.set(n.id,n);return n;
  }
  const page=node('PAGE');page.selection=[];
  const figma={root:{name:'Mock file',children:[page]},currentPage:page,ui:{postMessage(){}},showUI(){},commitUndo(){undo++;},viewport:{scrollAndZoomIntoView(){}},loadFontAsync:async f=>{if(f.family==='Missing')throw new Error('Missing font');fonts.push(f);},getNodeByIdAsync:async id=>nodes.get(id),setCurrentPageAsync:async p=>{figma.currentPage=p;},createPage(){const p=node('PAGE');figma.root.children.push(p);return p;}};
  for(const [method,type] of Object.entries({createFrame:'FRAME',createRectangle:'RECTANGLE',createEllipse:'ELLIPSE',createText:'TEXT',createComponent:'COMPONENT'}))figma[method]=()=>{const n=node(type);figma.currentPage.appendChild(n);return n;};
  const context=vm.createContext({figma,__html__:'',console});vm.runInContext(code,context);
  return {figma,nodes,fonts,run:(action,payload)=>context.execute(action,payload),undo:()=>undo};
}
test('sample creates editable hierarchy and loads fonts before setting text',async()=>{
  const s=sandbox(),example=JSON.parse(await readFile(new URL('../examples/card.json',import.meta.url),'utf8'));
  const result=await s.run('apply',example);
  assert.equal(result.ok,true);assert.equal(result.completed.length,5);
  const title=s.nodes.get(result.refs.title),frame=s.nodes.get(result.refs.card);
  assert.equal(title.characters,'Hello from Codex');assert.equal(title.parent,frame);
  assert.equal(frame.width,400);assert.equal(s.figma.currentPage.selection[0],frame);assert.ok(s.fonts.length);assert.equal(s.undo(),1);
});
test('failed create cleans up orphan and reports previous successful edits',async()=>{
  const s=sandbox();
  const r=await s.run('apply',{operations:[{op:'create',type:'RECTANGLE',ref:'first'},{op:'create',type:'TEXT',props:{fontName:{family:'Missing',style:'Regular'},characters:'test'}},{op:'create',type:'ELLIPSE'}]});
  assert.equal(r.ok,false);assert.equal(r.failedIndex,1);assert.equal(r.completed.length,1);
  assert.equal(s.figma.currentPage.children.length,1);assert.equal(s.figma.currentPage.children[0].type,'RECTANGLE');
});
test('unsupported property preflight prevents earlier property changes',async()=>{
  const s=sandbox(),node=s.figma.createRectangle(),before=node.name;
  const r=await s.run('apply',{operations:[{op:'update',nodeId:node.id,props:{name:'Changed',arbitraryCode:'bad'}}]});
  assert.equal(r.ok,false);assert.equal(node.name,before);
});
test('page deletion is blocked; invalid reference does not create a node',async()=>{
  const s=sandbox();
  assert.equal((await s.run('apply',{operations:[{op:'delete',nodeId:s.figma.currentPage.id}]})).ok,false);
  assert.equal((await s.run('apply',{operations:[{op:'create',type:'RECTANGLE',parentId:'$missing'}]})).ok,false);
  assert.equal(s.figma.currentPage.children.length,0);
});
test('document snapshot caps children and exposes truncation',async()=>{
  const s=sandbox();for(let i=0;i<550;i++)s.figma.createRectangle();
  const r=await s.run('document',{depth:5});assert.equal(r.tree.children.length,499);assert.equal(r.tree.truncated,true);
});
test('safe-area layout and scroll properties can be updated and inspected',async()=>{
  const s=sandbox(),frame=s.figma.createFrame();
  const r=await s.run('apply',{operations:[{op:'update',nodeId:frame.id,props:{height:778,layoutGrow:1,clipsContent:true,overflowDirection:'VERTICAL',constraints:{horizontal:'STRETCH',vertical:'MIN'}}}]});
  assert.equal(r.ok,true);assert.equal(frame.height,778);assert.equal(frame.layoutGrow,1);assert.equal(frame.clipsContent,true);assert.equal(frame.overflowDirection,'VERTICAL');
  const doc=await s.run('document',{nodeId:frame.id,depth:0});
  assert.equal(doc.tree.overflowDirection,'VERTICAL');assert.equal(doc.tree.layoutGrow,1);
});
test('native glass effects are validated, applied, and exposed in snapshots',async()=>{
  const s=sandbox(),frame=s.figma.createFrame();
  const glass={type:'GLASS',visible:true,radius:16,refraction:0.25,depth:41,lightAngle:-45,lightIntensity:0.8,dispersion:0.16};
  const r=await s.run('apply',{operations:[{op:'update',nodeId:frame.id,props:{effects:[glass]}}]});
  assert.equal(r.ok,true);assert.deepEqual(frame.effects,[glass]);
  const doc=await s.run('document',{nodeId:frame.id,depth:0});
  assert.equal(doc.tree.effects[0].type,'GLASS');assert.equal(doc.tree.effects[0].depth,41);
  const invalid=await s.run('apply',{operations:[{op:'update',nodeId:frame.id,props:{effects:[{...glass,refraction:2}]}}]});
  assert.equal(invalid.ok,false);assert.equal(frame.effects[0].refraction,0.25);
});
