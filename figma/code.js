/* Runs only inside Figma's Plugin API sandbox. No eval or remote scripts. */
const allowed = new Set('name x y width height fills strokes strokeWeight cornerRadius opacity visible locked rotation characters fontName fontSize textAlignHorizontal textAutoResize layoutMode itemSpacing paddingTop paddingBottom paddingLeft paddingRight primaryAxisSizingMode counterAxisSizingMode primaryAxisAlignItems counterAxisAlignItems clipsContent layoutPositioning layoutGrow layoutAlign constraints overflowDirection'.split(' '));
function snapshot(node,depth,budget) {
  if (budget.count++ >= 500) return {id:node.id,truncated:true};
  const out={id:node.id,type:node.type,name:node.name};
  for(const key of ['x','y','width','height','characters','layoutMode','fontSize','fontName','fills','layoutPositioning','layoutGrow','layoutAlign','constraints','overflowDirection','clipsContent','paddingTop','paddingBottom','paddingLeft','paddingRight','primaryAxisSizingMode','counterAxisSizingMode','itemSpacing','visible']) if(key in node && typeof node[key]!=='symbol')out[key]=node[key];
  if(depth>0 && 'children' in node) {
    out.children=[];
    for(const child of node.children) {if(budget.count>=500){out.truncated=true;break;}out.children.push(snapshot(child,depth-1,budget));}
  }
  return out;
}
async function lookup(id,refs) {
  if(typeof id!=='string')throw new Error('nodeId/parentId must be a string');
  const resolved=id.startsWith('$')?refs[id.slice(1)]:id;
  if(!resolved)throw new Error('Unknown reference: '+id);
  const node=await figma.getNodeByIdAsync(resolved);
  if(!node || node.removed)throw new Error('Node not found: '+id);
  return node;
}
async function patch(node,props) {
  if(!props || typeof props!=='object' || Array.isArray(props))throw new Error('props must be an object');
  for(const key of Object.keys(props)) {
    if(!allowed.has(key))throw new Error('Unsupported property: '+key);
    if(!(key in node))throw new Error(node.type+' does not support '+key);
  }
  for(const key of ['width','height']) if(key in props && (!Number.isFinite(props[key]) || props[key]<=0 || props[key]>100000))throw new Error('Invalid '+key);
  if('characters' in props && typeof props.characters!=='string')throw new Error('characters must be a string');
  if(node.type==='TEXT' && ['characters','fontName','fontSize','textAutoResize','width','height'].some(k=>k in props)) {
    const fonts=node.characters.length?node.getRangeAllFontNames(0,node.characters.length):[node.fontName];
    for(const font of fonts)if(typeof font!=='symbol')await figma.loadFontAsync(font);
    if(props.fontName)await figma.loadFontAsync(props.fontName);
  }
  if('fontName' in props)node.fontName=props.fontName;
  for(const [key,value] of Object.entries(props))if(!['width','height','fontName'].includes(key))node[key]=value;
  if('width' in props || 'height' in props)node.resize(props.width===undefined?node.width:props.width,props.height===undefined?node.height:props.height);
}
async function execute(action,payload) {
  if(action==='document') {
    const node=payload.nodeId?await lookup(payload.nodeId,{}):figma.currentPage;
    if(node.type==='PAGE')await node.loadAsync();
    return {fileName:figma.root.name,currentPageId:figma.currentPage.id,pages:figma.root.children.map(p=>({id:p.id,name:p.name})),selection:figma.currentPage.selection.map(n=>n.id),tree:snapshot(node,Math.max(0,Math.min(5,payload.depth===undefined?2:payload.depth)),{count:0})};
  }
  if(action==='fonts')return (await figma.listAvailableFontsAsync()).filter(f=>f.fontName.family.toLowerCase().includes(String(payload.query||'').toLowerCase())).slice(0,200).map(f=>f.fontName);
  if(action==='export') {
    const node=await lookup(payload.nodeId,{}),format=payload.format||'PNG';
    if(!['PNG','SVG'].includes(format) || !node.exportAsync)throw new Error('Unsupported export');
    if(format==='SVG') {const data=await node.exportAsync({format:'SVG_STRING'});if(data.length>1000000)throw new Error('Export exceeds 1 MB');return {format,data};}
    const bytes=await node.exportAsync({format:'PNG',constraint:{type:'SCALE',value:1}});
    if(bytes.length>1000000)throw new Error('Export exceeds 1 MB; export a smaller node');
    return {format,data:figma.base64Encode(bytes)};
  }
  if(action!=='apply')throw new Error('Unknown action');
  const operations=payload.operations;
  if(!Array.isArray(operations) || !operations.length || operations.length>100)throw new Error('Expected 1-100 operations');
  const refs=Object.create(null),completed=[];
  for(let i=0;i<operations.length;i++) {
    const op=operations[i];let created;
    try {
      if(!op || typeof op!=='object')throw new Error('Operation must be an object');
      if(op.ref!==undefined && (typeof op.ref!=='string'|| !/^[a-zA-Z][\w-]{0,63}$/.test(op.ref)|| refs[op.ref]))throw new Error('Invalid or duplicate ref');
      let node;
      if(op.op==='create_page') {node=figma.createPage();created=node;if(op.name!==undefined)node.name=String(op.name);await figma.setCurrentPageAsync(node);}
      else if(op.op==='create') {
        const factories={FRAME:()=>figma.createFrame(),RECTANGLE:()=>figma.createRectangle(),ELLIPSE:()=>figma.createEllipse(),TEXT:()=>figma.createText(),COMPONENT:()=>figma.createComponent()};
        if(!Object.prototype.hasOwnProperty.call(factories,op.type))throw new Error('Unsupported node type');
        const parent=op.parentId?await lookup(op.parentId,refs):figma.currentPage;
        if(!['PAGE','FRAME','COMPONENT'].includes(parent.type))throw new Error('Parent must be PAGE, FRAME or COMPONENT');
        node=factories[op.type]();created=node;parent.appendChild(node);await patch(node,op.props||{});
      } else if(op.op==='update') {node=await lookup(op.nodeId,refs);if(node.type==='DOCUMENT')throw new Error('Cannot edit document root');await patch(node,op.props||{});}
      else if(op.op==='clone') {const source=await lookup(op.nodeId,refs);if(['PAGE','DOCUMENT'].includes(source.type))throw new Error('Clone supports scene nodes only');node=source.clone();created=node;await patch(node,op.props||{});}
      else if(op.op==='delete') {node=await lookup(op.nodeId,refs);if(['PAGE','DOCUMENT'].includes(node.type))throw new Error('Page/document deletion is disabled');node.remove();}
      else if(op.op==='select') {
        if(!Array.isArray(op.nodeIds))throw new Error('nodeIds must be an array');
        const nodes=await Promise.all(op.nodeIds.map(id=>lookup(id,refs)));
        figma.currentPage.selection=nodes;if(nodes.length)figma.viewport.scrollAndZoomIntoView(nodes);
      } else throw new Error('Unknown operation: '+op.op);
      if(op.ref && node)refs[op.ref]=node.id;
      completed.push({index:i,op:op.op,...(node?{id:node.id}:{})});
    } catch(error) {
      if(created && !created.removed)created.remove();
      figma.commitUndo();
      return {ok:false,completed,refs,failedIndex:i,error:error.message,partial:true,message:'Earlier operations remain. A failing update may be partially applied. Inspect before retry; use Figma Undo if needed.'};
    }
  }
  figma.commitUndo();return {ok:true,completed,refs};
}
let busy=false;
figma.ui.onmessage=async msg=>{
  if(msg.type==='info') {figma.ui.postMessage({type:'info',handshakeId:msg.handshakeId,name:figma.root.name,page:figma.currentPage.name});return;}
  if(msg.type!=='execute')return;
  if(busy){figma.ui.postMessage({type:'result',id:msg.id,error:'Plugin is busy'});return;}
  busy=true;
  try {figma.ui.postMessage({type:'result',id:msg.id,result:await execute(msg.action,msg.payload||{})});}
  catch(error){figma.ui.postMessage({type:'result',id:msg.id,error:error.message});}
  finally {busy=false;}
};
figma.showUI(__html__,{width:380,height:460,themeColors:true});
