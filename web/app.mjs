import { emptyTask, validateTask, mergeOperations, materialize, shiftPlan, planParts, packPlan } from '/shared/core.mjs';
import { HttpSyncTransport } from '/shared/transports.mjs';
import { LocalStore, STORAGE_KEY } from './local-store.mjs';
import { NativeStore } from './native-store.mjs';
import { WebDavClient, exchangeWithWebDav, describeSyncStatus } from './webdav-client.mjs';
import { holdEditSession } from './edit-session.mjs';
import { localToday, addDays, monday, getWeeks, layoutWeek, classifyTask, planLabel } from './calendar.mjs';
import { daysBetween, planBetween, resizeTask, moveTask, weekTaskAt, unplanTask, deadlineAt, appendTaskPlan, removeTaskSegment, replaceTaskSegment } from './drag-plan.mjs';
import { taskTiming } from './task-form.mjs';
import { resolveLaunchTarget } from './launch-target.mjs';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const native=globalThis.SuiliNative;
const DISPLAY_KEY='suili-display-v1';
const colors=['#477766','#6e7d46','#a6744d','#637eaa','#9a6f91'];
let renderedHeads={},store,anchor=localToday(),mode='four',filter='unplanned',search='',showCompleted=false;
let editing=null,editorHeads=null,editColor=colors[0],transport=null,syncing=false,syncFailed=false;
let syncTimer,toastTimer,pendingImport=null,selectedId=null,pendingCreatePlan=null,gesture=null,drawMode=false;
let deadlinePicking=null,planPicking=null,suppressClickUntil=0,scrollFrame=0,renderPending=false;
let selectedSegment=null,editorSegments=[];
let webDavClient=null,webDavError=null,webDavConfigError=null,webDavBusy=false,webDavDraftDirty=false;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const compact=date=>`${Number(date.slice(5,7))}月${Number(date.slice(8))}日`;
const spanLabel=p=>p.kind==='segments'?`${p.segments.length}段 · ${p.segments.map(spanLabel).join('；')}`:p.kind==='none'?'暂不安排日期':p.kind==='day'?compact(p.start):`${compact(p.start)} — ${compact(p.end)} · ${daysBetween(p.start,p.end)+1}天${p.kind==='week'?'，这周找时间':''}`;
function toast(message){const n=$('#toast');n.textContent=message;n.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>n.hidden=true,4200);}
function safe(fn){return (...args)=>{try{return fn(...args);}catch(error){toast(error.message);}};}
function installDisplayControls(){
 const smallScreen=matchMedia('(max-width:800px)');let prefs={};
 try{const saved=JSON.parse(localStorage.getItem(DISPLAY_KEY)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))prefs=saved;}catch{}
 const densitySelect=$('#display-density'),fontInputs=[$('#display-font'),$('#quick-display-font')].filter(Boolean);
 const apply=()=>{
  const density=['compact','comfortable'].includes(prefs.density)?prefs.density:smallScreen.matches?'compact':'comfortable';
  const font=Number.isInteger(prefs.font)&&prefs.font>=6&&prefs.font<=16?prefs.font:density==='compact'?11:14;
  document.body.dataset.density=density;document.body.style.setProperty('--planner-font-size',`${font}px`);
  if(densitySelect)densitySelect.value=density;
  for(const input of fontInputs)input.value=String(font);
  for(const output of $$('[data-font-value]'))output.textContent=`${font} px`;
 };
 const save=()=>{apply();try{localStorage.setItem(DISPLAY_KEY,JSON.stringify(prefs));}catch{toast('显示已调整，当前设备未能记住此设置');}};
 densitySelect?.addEventListener('change',()=>{prefs={...prefs,density:densitySelect.value};save();});
 for(const input of fontInputs)input.addEventListener('input',()=>{prefs={...prefs,font:Number(input.value)};save();});
 const options=$('#view-options');if(options)options.open=false;
 smallScreen.addEventListener('change',()=>{apply();if(options)options.open=false;});apply();
}
function currentTask(id){return store.view.tasks.find(t=>t.id===id&&!t.deleted);}
function change(tasks,options={}){store.commit(tasks,{expectedHeads:renderedHeads,...options});planPicking=null;document.body.classList.toggle('drawing',drawMode);render();scheduleSync();}
function confirmPlan(t){return !t.deadline||!t.plan.end||t.plan.end<=t.deadline||confirm(`计划结束在 ${t.deadline} 截止日之后。保留这次计划调整吗？截止日仍为 ${t.deadline}。`);}
function statusText(t){return {completed:'已完成',overdue:`已过截止 · ${t.deadline}`,due:'今天截止',replan:'原计划已过 · 可重新安排'}[classifyTask(t,localToday())]??(t.deadline?`${planLabel(t)} · ${t.deadline.slice(5)} 截止`:planLabel(t));}
function scrollToCalendar(){ $('#calendar').scrollIntoView({block:'start',behavior:'smooth'}); }
function scrollToUnplanned(){ $('#unplanned-panel').scrollIntoView({block:'start',behavior:'smooth'}); }
function selectTask(id,segmentIndex=null){selectedId=id;selectedSegment=segmentIndex;deadlinePicking=null;planPicking=null;document.body.classList.remove('deadline-picking');document.body.classList.toggle('drawing',drawMode);renderSelection();}
function renderSelection(){
 const t=selectedId&&currentTask(selectedId);$('#selection-toolbar').hidden=!t;
 if(planPicking&&JSON.stringify(planPicking.expectedHeads[planPicking.task.id]??[])!==JSON.stringify(store.view.heads[planPicking.task.id]??[]))planPicking=null;
 document.body.classList.toggle('drawing',drawMode||Boolean(planPicking));document.body.classList.toggle('range-picking',Boolean(planPicking?.twoClicks));
 document.body.classList.toggle('planning',Boolean(planPicking));
 if(!t||planPicking&&planPicking.task.id!==selectedId){planPicking=null;document.body.classList.toggle('drawing',drawMode);}
 if(!t||deadlinePicking&&deadlinePicking.task.id!==selectedId){deadlinePicking=null;document.body.classList.remove('deadline-picking');}
 $$('[data-task-id]').forEach(n=>{n.classList.toggle('selected',n.dataset.taskId===selectedId);n.classList.toggle('selected-segment',n.dataset.taskId===selectedId&&selectedSegment!==null&&n.dataset.segmentIndex===String(selectedSegment));});
 if(!t){selectedId=null;return;}
 if(selectedSegment!==null&&!planParts(t.plan)[selectedSegment])selectedSegment=null;
 const selectedPlan=selectedSegment===null?t.plan:planParts(t.plan)[selectedSegment];
 $('#selected-title').textContent=t.title;$('#selected-plan').textContent=`${selectedSegment===null?'':`第 ${selectedSegment+1} 段 · `}${spanLabel(selectedPlan)}${t.deadline?` · ${compact(t.deadline)} 截止`:''}`;
 $('#selection-complete').textContent=t.completed?'恢复未完成':'完成';$('#selection-unplan').disabled=t.plan.kind==='none';
 $('#selection-deadline').textContent=deadlinePicking?'点选截止日期…':t.deadline?'调整截止日':'添加截止日';
 $('#selection-plan').textContent=planPicking?'完成安排':t.plan.kind==='none'?'安排日期':'再加一段';
 $('#selection-remove-segment').hidden=selectedSegment===null||Boolean(planPicking);
 $('#planning-controls').hidden=!planPicking;
 $('#selection-pick-range').setAttribute('aria-pressed',String(Boolean(planPicking?.twoClicks)));
 $('#planning-note').textContent=planPicking?.rangeStart?`已选 ${compact(planPicking.rangeStart)}，再点结束日期`:planPicking?.twoClicks?'依次点开始、结束日期；可以跨周翻页选择':'点一天，或按住划选一段；可继续添加其它时间段';
 $$('.day-number').forEach(n=>n.classList.toggle('range-start',n.dataset.date===planPicking?.rangeStart));
}
function applyDrawnPlan(plan,pick=planPicking){
 if(!pick){openQuickCreate(plan);return;}
 const next=appendTaskPlan(pick.task,plan);if(!confirmPlan(next))return;
 change([next],{expectedHeads:pick.expectedHeads});selectedId=next.id;selectedSegment=null;
 planPicking={...pick,task:structuredClone(next),expectedHeads:structuredClone(store.view.heads),rangeStart:null};renderSelection();toast('已加入这一段，可继续选日期；完成后点“完成安排”');
}
function startPlanPicking(){
 const t=currentTask(selectedId);if(!t)return;deadlinePicking=null;document.body.classList.remove('deadline-picking');
 planPicking={task:structuredClone(t),expectedHeads:structuredClone(renderedHeads),twoClicks:false,rangeStart:null};
 document.body.classList.add('drawing');renderSelection();scrollToCalendar();
}
function pickPlanDate(date,weekOnly=false){
 if(planPicking?.twoClicks&&!weekOnly){
  if(!planPicking.rangeStart){planPicking.rangeStart=date;renderSelection();return;}
  applyDrawnPlan(planBetween(planPicking.rangeStart,date));return;
 }
 applyDrawnPlan(weekOnly?{kind:'week',start:monday(date),end:addDays(monday(date),6)}:planBetween(date,date));
}

// A gesture previews an immutable snapshot. Only pointerup commits, with the heads
// captured from the rendered frame; concurrent sync can never silently win a drag.
function hitDate(x,y){
 for(const row of $$('.week-row')){
  const r=row.getBoundingClientRect();if(x<r.left||x>=r.right||y<r.top||y>=r.bottom)continue;
  const col=Math.max(0,Math.min(6,Math.floor((x-r.left)/(r.width/7))));
  const zone=row.querySelector('.week-plan-zone'),z=zone.getBoundingClientRect();
  return {date:addDays(row.dataset.weekStart,col),week:row.dataset.weekStart,inWeek:y>=z.top&&y<=z.bottom};
 }
 return null;
}
function isInbox(x,y){const r=$('#unplanned-panel').getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;}
function clearPreview(){
 $$('.gesture-layer').forEach(n=>n.remove());$$('.drop-hover').forEach(n=>n.classList.remove('drop-hover'));$('#gesture-hint').hidden=true;
}
function preview(g){
 clearPreview();if(!g.moved)return;
 const candidate=g.candidate,p=g.kind==='create'?candidate:candidate?.plan;
 let ranges=g.kind==='deadline'?[{start:candidate?.deadline,end:candidate?.deadline}]:p?planParts(p):[];
 if(candidate&&g.segmentIndex!==undefined&&g.kind!=='deadline'){
  const unchanged=planParts(g.task.plan).filter((_,i)=>i!==g.segmentIndex);
  ranges=ranges.filter(part=>!unchanged.some(old=>JSON.stringify(old)===JSON.stringify(part)));
 }
 if(candidate){
  for(const row of $$('.week-row')){
   const from=row.dataset.weekStart,to=addDays(from,6),layer=el('div','gesture-layer');
   for(const range of ranges){
   if(range?.start&&range.start<=to&&range.end>=from){
    const start=range.start<from?from:range.start,end=range.end>to?to:range.end;
    const col=daysBetween(from,start),span=daysBetween(start,end)+1;
    const block=el('div','gesture-bar',g.kind==='create'?'新事项':candidate.title);
    block.style.gridColumn=`${col+1} / span ${span}`;layer.append(block);
    for(let i=col;i<col+span;i++){const day=el('div','gesture-day');day.style.gridColumn=String(i+1);layer.append(day);}
    row.append(layer);
   }
   }
  }
 }
 const hint=$('#gesture-hint');hint.hidden=false;
 hint.textContent=!candidate?'移到日期格内，松手安排':g.kind==='deadline'?`${compact(candidate.deadline)} 截止`:spanLabel(p);
 if(g.dropInbox){hint.textContent='移回待安排';$('#unplanned-panel').classList.add('drop-hover');}
 hint.style.left=`${Math.max(8,Math.min(innerWidth-260,g.x+12))}px`;hint.style.top=`${Math.max(8,Math.min(innerHeight-80,g.y-58))}px`;
}
function updateGesture(x,y){
 const g=gesture;if(!g)return;g.x=x;g.y=y;
 if(!g.moved&&Math.hypot(x-g.x0,y-g.y0)<6)return;
 g.moved=true;document.body.classList.add('gesture-active');g.candidate=null;g.dropInbox=false;
 const hit=hitDate(x,y);
 try{
  if(g.kind==='move'&&isInbox(x,y)){g.candidate=g.segmentIndex===undefined?unplanTask(g.task):removeTaskSegment(g.task,g.segmentIndex);g.dropInbox=true;}
  else if(hit){
   if(g.kind==='create')g.candidate=g.weekOnly?{kind:'week',start:hit.week,end:addDays(hit.week,6)}:planBetween(g.startDate,hit.date);
   else if(g.kind==='resize')g.candidate=resizeTask(g.task,g.edge,hit.date,g.segmentIndex);
   else if(g.kind==='deadline')g.candidate=deadlineAt(g.task,hit.date);
   else {
    const part=g.segmentIndex===undefined?g.task.plan:planParts(g.task.plan)[g.segmentIndex];
    g.candidate=hit.inWeek?weekTaskAt(g.task,hit.date,g.segmentIndex):part.kind==='week'?(g.segmentIndex===undefined?{...g.task,plan:planBetween(hit.date,hit.date)}:replaceTaskSegment(g.task,g.segmentIndex,planBetween(hit.date,hit.date))):moveTask(g.task,hit.date,g.offset,g.segmentIndex);
   }
  }
 }catch{/* An invalid destination cancels the candidate instead of keeping the last valid one. */}
 preview(g);
}
function autoScroll(){
 if(!gesture)return;
 const g=gesture,margin=52,top=$('.topbar').getBoundingClientRect().bottom;
 const speed=g.y>innerHeight-margin?14:g.y<top+margin?-14:0;
 if(g.moved&&speed){
  window.scrollBy(0,speed);
  updateGesture(g.x,g.y);
 }
 scrollFrame=requestAnimationFrame(autoScroll);
}
function beginGesture(event,details){
 if(gesture||event.button!==0||document.querySelector('dialog[open]'))return;
 event.preventDefault();event.stopPropagation();
 gesture={...details,id:event.pointerId,node:event.currentTarget,x0:event.clientX,y0:event.clientY,x:event.clientX,y:event.clientY,moved:false,candidate:null,expectedHeads:structuredClone(renderedHeads)};
 event.currentTarget.setPointerCapture(event.pointerId);scrollFrame=requestAnimationFrame(autoScroll);
}
function endGesture(cancel=false){
 const g=gesture;if(!g)return;gesture=null;cancelAnimationFrame(scrollFrame);clearPreview();document.body.classList.remove('gesture-active');
 if(g.node.hasPointerCapture?.(g.id))g.node.releasePointerCapture(g.id);
 // Suppress the synthetic click after pointerup, including blank-date creation.
 suppressClickUntil=Date.now()+350;
 try{
  if(cancel){render();return;}
  if(!g.moved){
   if(g.kind==='create')applyDrawnPlan(g.weekOnly?{kind:'week',start:monday(g.startDate),end:addDays(monday(g.startDate),6)}:planBetween(g.startDate,g.startDate),g.assign);
   else selectTask(g.task.id,g.segmentIndex??null);
  }else if(g.candidate){
   if(g.kind==='create')applyDrawnPlan(g.candidate,g.assign);
   else if(JSON.stringify(g.candidate)!==JSON.stringify(g.task)&&(g.kind==='deadline'||confirmPlan(g.candidate))){
    selectedId=g.task.id;selectedSegment=null;change([g.candidate],{expectedHeads:g.expectedHeads});
    toast(g.kind==='resize'?'已调整范围':g.kind==='deadline'?'已调整截止日':'已移动事项');
   }
  }
 }catch(error){toast(error.message);}finally{if(g.moved||cancel||renderPending)render();else renderSelection();}
}
function bindTask(node,t,kind='move',segmentIndex=undefined){
 node.dataset.taskId=t.id;node.tabIndex=0;node.setAttribute('role','button');
 if(segmentIndex!==undefined)node.dataset.segmentIndex=String(segmentIndex);
 node.addEventListener('pointerdown',event=>{
  if(event.target.closest('.range-handle,.bar-done,.task-complete'))return;
  const hit=hitDate(event.clientX,event.clientY);
  const part=segmentIndex===undefined?t.plan:planParts(t.plan)[segmentIndex];
  const offset=kind==='move'&&node.classList.contains('plan-bar')&&part.start&&hit&&!hit.inWeek?daysBetween(part.start,hit.date):0;
  beginGesture(event,{kind,task:structuredClone(t),offset,segmentIndex});
 });
 node.addEventListener('click',()=>{if(Date.now()>suppressClickUntil)selectTask(t.id,segmentIndex??null);});
 node.addEventListener('dblclick',()=>openEditor(t.id));
 node.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();openEditor(t.id);}if(e.key===' '){e.preventDefault();selectTask(t.id,segmentIndex??null);}});
}
function bindBlank(node,date,weekOnly=false){
 node.addEventListener('pointerdown',event=>{
  if(deadlinePicking||planPicking?.twoClicks)return;
  if(event.pointerType==='touch'&&!drawMode&&!planPicking)return;
  beginGesture(event,{kind:'create',startDate:date,weekOnly,assign:planPicking});
 });
 node.addEventListener('click',safe(()=>{
  if(Date.now()<=suppressClickUntil)return;
  if(deadlinePicking){
   const pick=deadlinePicking,t=deadlineAt(pick.task,date);change([t],{expectedHeads:pick.expectedHeads});selectTask(t.id);toast('已设置截止日');return;
  }
  pickPlanDate(date,weekOnly);
 }));
}
function taskCard(t){
 const card=el('div',`task-card${t.completed?' completed':''}`);bindTask(card,t);
 const check=el('button',`task-complete${t.completed?' checked':''}`,t.completed?'✓':'');check.type='button';check.setAttribute('aria-label',`${t.completed?'恢复':'完成'} ${t.title}`);
 check.addEventListener('click',safe(e=>{e.stopPropagation();change([{...t,completed:!t.completed}]);}));
 const content=el('div','task-copy');content.append(el('span','task-title',t.title),el('div',`task-meta ${classifyTask(t,localToday())}`,statusText(t)));card.append(check,content);return card;
}
function renderList(){
 const tasks=store.view.tasks.filter(t=>!t.deleted);$('#unplanned-count').textContent=tasks.filter(t=>!t.completed&&t.plan.kind==='none').length;
 let visible=tasks.filter(t=>(showCompleted||!t.completed)&&(!search||`${t.title} ${t.notes}`.toLowerCase().includes(search.toLowerCase())));
 if(filter==='unplanned')visible=visible.filter(t=>t.plan.kind==='none');
 if(filter==='replan')visible=visible.filter(t=>['replan','overdue'].includes(classifyTask(t,localToday())));
 visible.sort((a,b)=>Number(a.completed)-Number(b.completed)||(a.deadline??'9999').localeCompare(b.deadline??'9999'));
 $('#task-list').replaceChildren(...visible.map(taskCard));
 if(!visible.length){const box=el('div','empty-list');box.append(el('div','empty-symbol','＋'),el('div','',search?'没有找到事项':filter==='unplanned'?'先记下，稍后安排':'暂无事项'),el('div','',filter==='unplanned'&&!search?'在上方输入，也可以直接在日历上划一段。':''));$('#task-list').append(box);}
 $('#undo-button').disabled=!store.canUndo;
}
function makeBar(s){
 const t=s.task,p=s.plan,b=el('div',`plan-bar${s.continuesBefore?' continues-before':''}${s.continuesAfter?' continues-after':''}${t.completed?' completed':''}`);
 b.style.setProperty('--task-color',t.color);b.style.gridColumn=`${s.startColumn+1} / span ${s.span}`;b.style.gridRow=String(s.lane+1);
 b.title=`${t.title} · ${spanLabel(p)}${t.deadline?' · 截止 '+t.deadline:''}`;b.setAttribute('aria-label',b.title);bindTask(b,t,'move',s.segmentIndex);
 const done=el('button','bar-done',t.completed?'✓':'');done.type='button';done.setAttribute('aria-label',`${t.completed?'恢复':'完成'} ${t.title}`);done.addEventListener('click',safe(e=>{e.stopPropagation();change([{...t,completed:!t.completed}]);}));
 b.append(done,el('span','bar-title',t.title));if(s.span>2)b.append(el('span','bar-dates',`${compact(p.start)}–${compact(p.end)}`));
 for(const edge of ['start','end']){
  if(edge==='start'&&s.continuesBefore||edge==='end'&&s.continuesAfter)continue;
  const h=el('button',`range-handle ${edge}`,'');h.type='button';h.title=edge==='start'?'拖动开始日期':'拖动结束日期';h.setAttribute('aria-label',`${h.title}：${t.title}`);
  h.addEventListener('pointerdown',e=>{
   // Android may retarget a touch near a button even when its coordinates are
   // in the card centre. Keep that centre a move target, not an invisible handle.
   const r=h.getBoundingClientRect(),bar=b.getBoundingClientRect();
   const inHandle=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
   const inBar=e.clientX>=bar.left&&e.clientX<=bar.right&&e.clientY>=bar.top&&e.clientY<=bar.bottom;
   if(e.pointerType==='touch'&&!inHandle&&inBar){const hit=hitDate(e.clientX,e.clientY);beginGesture(e,{kind:'move',task:structuredClone(t),offset:hit?daysBetween(p.start,hit.date):0,segmentIndex:s.segmentIndex});}
   else beginGesture(e,{kind:'resize',task:structuredClone(t),edge,segmentIndex:s.segmentIndex});
  });h.addEventListener('click',e=>e.stopPropagation());
  h.addEventListener('keydown',safe(e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const next=resizeTask(t,edge,addDays(p[edge],e.key==='ArrowLeft'?-1:1),s.segmentIndex);if(confirmPlan(next)){selectedSegment=null;change([next]);}}}));b.append(h);
 }
 return b;
}
function renderCalendar(){
 const weeks=getWeeks(anchor,mode),first=weeks[0][0],last=weeks.at(-1)[6];
 $('#date-title').textContent=mode==='month'?`${anchor.slice(0,4)} 年 ${Number(anchor.slice(5,7))} 月`:`${compact(first)} — ${compact(last)}`;
 $('#view-caption').textContent=mode==='month'?'月计划':`${first.slice(0,4)} 年 · ${mode==='week'?'本周计划':'连续四周'}`;
 const tasks=store.view.tasks.filter(t=>!t.deleted&&(showCompleted||!t.completed));
 const header=el('div','weekdays');['周一','周二','周三','周四','周五','周六','周日'].forEach((d,i)=>header.append(el('div',i>4?'weekend':'',d)));
 $('#calendar').dataset.view=mode;$('#calendar').replaceChildren(header);
 for(const days of weeks){
  const row=el('div','week-row'),bg=el('div','day-grid'),heads=el('div','day-heads'),layer=el('div','range-layer');row.dataset.weekStart=days[0];
  for(const [i,date] of days.entries()){
   const cell=el('div',`day-bg${i>4?' weekend':''}`);cell.dataset.date=date;bindBlank(cell,date);bg.append(cell);
   const number=el('button',`day-number${date===localToday()?' today':''}${mode==='month'&&date.slice(0,7)!==anchor.slice(0,7)?' outside':''}`,Number(date.slice(8))===1?`${Number(date.slice(5,7))}/1`:String(Number(date.slice(8))));
   number.dataset.date=date;number.title=`${date} · 新建事项`;number.setAttribute('aria-label',`${date} 新建事项`);bindBlank(number,date);heads.append(number);
  }
  const {segments,weekTasks,deadlines}=layoutWeek(tasks,days[0]);segments.forEach(s=>layer.append(makeBar(s)));
  for(const {task:t,startColumn,lane} of deadlines){
   const b=el('div',`plan-bar deadline-chip${t.completed?' completed':''}`);b.append(el('span','bar-title',`截止 · ${t.title}`));b.style.gridColumn=String(startColumn+1);b.style.gridRow=String(lane+1);b.title=`${t.title} · ${t.deadline} 截止`;bindTask(b,t,'deadline');layer.append(b);
  }
  const zone=el('div','week-plan-zone');zone.dataset.week=days[0];const label=el('button','week-zone-label','这周找时间 ＋');label.type='button';bindBlank(label,days[0],true);zone.append(label);
  // Empty space in the week area is also an easy, imprecise drop/new target.
  zone.addEventListener('pointerdown',e=>{if(e.target===zone&&!(e.pointerType==='touch'&&!drawMode&&!planPicking)&&!deadlinePicking)beginGesture(e,{kind:'create',startDate:days[0],weekOnly:true,assign:planPicking});});
  weekTasks.forEach(({task:t,plan,segmentIndex})=>{const b=el('div',`week-pill${t.completed?' completed':''}`,t.title);b.title=`${t.title} · ${spanLabel(plan)}`;b.style.setProperty('--task-color',t.color);bindTask(b,t,'move',segmentIndex);zone.append(b);});
  row.append(bg,heads,layer,zone);$('#calendar').append(row);
 }
}
function renderStatus(){
 const status=$('#sync-status');
 if(native){status.classList.remove('failed');status.textContent=store.syncing?'正在同步…':store.status||'本地已保存';$('#sync-button').disabled=store.syncing;return;}
 const description=describeSyncStatus({enabled:webDavClient?.config?.enabled,status:webDavClient?.status?{...webDavClient.status,lastError:webDavError||webDavClient.status.lastError}:null,syncing,localPending:store.pending,localFailed:syncFailed,lastLocalSync:store.data.lastSync});
 status.classList.toggle('failed',description.failed);status.textContent=description.text;$('#sync-button').disabled=syncing||webDavBusy;renderWebDavSettings();
}
function render(){
 if(gesture){renderPending=true;renderStatus();return;}
 renderPending=false;
 renderedHeads=structuredClone(store.view.heads);renderList();renderCalendar();renderStatus();renderSelection();
 const conflicts=store.view.conflicts,box=$('#conflict-notice');box.hidden=!conflicts.length;box.replaceChildren();
 if(conflicts.length){box.append(document.createTextNode(`${conflicts.length} 件事项在两端分别修改过。 `));const b=el('button','','选择保留的版本');b.addEventListener('click',()=>openConflicts());box.append(b);}
}
function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync(false),650);}
async function sync(announce=true){
 if(native){try{native.requestSync(announce);store.refresh();renderStatus();}catch(e){if(announce)toast(e.message);}return;}
 if(syncing||webDavBusy)return;syncing=true;renderStatus();
 try{
  if(!transport)await loadSetup(false);if(!transport)throw new Error('服务未连接');
  const result=await exchangeWithWebDav({transport,store,client:webDavClient});syncFailed=false;
  webDavError=result.unavailable?null:result.remoteError?.message??null;webDavConfigError=result.remoteError?.localOnly?result.remoteError:null;
  $('#webdav-error').textContent=webDavError?`本地已保存。${webDavError}`:webDavConfigError?.message??'';render();
  if(announce)toast(webDavError?`本地已保存。${webDavError}`:result.remoteEnabled?(webDavClient.status?.pending?'本次 WebDAV 同步完成，仍有新修改待同步。':'WebDAV 已同步'):'已保存到本机');
 }catch{syncFailed=true;if(announce)toast('暂时无法连接本机服务，修改已保存在浏览器本地。');}finally{syncing=false;renderStatus();}
}
function openQuickCreate(plan={kind:'none',start:null,end:null}){
 selectTask(null);
 pendingCreatePlan=structuredClone(plan);$('#quick-title').value='';$('#quick-has-deadline').checked=false;$('#quick-allocate-time').checked=false;
 $('#quick-deadline').value=plan.end??localToday();$('#quick-plan-kind').value=plan.kind==='none'?'day':plan.kind;
 $('#quick-plan-start').value=plan.start??localToday();$('#quick-plan-end').value=plan.end??localToday();$('#quick-create-error').textContent='';
 quickDates();$('#quick-create').showModal();$('#quick-create').scrollTop=0;$('#quick-title').focus();
}
function quickDates(){
 const due=$('#quick-has-deadline').checked,allocated=due&&$('#quick-allocate-time').checked,kind=$('#quick-plan-kind').value;
 $('#quick-deadline-options').hidden=!due;$('#quick-deadline').disabled=!due;$('#quick-deadline').required=due;
 $('#quick-plan-fields').hidden=!allocated;$('#quick-plan-kind').disabled=!allocated;$('#quick-end-label').hidden=kind!=='range';
 $('#quick-plan-start').disabled=!allocated;$('#quick-plan-start').required=allocated;
 $('#quick-plan-end').disabled=!allocated||kind!=='range';$('#quick-plan-end').required=allocated&&kind==='range';
 $('#quick-range-label').textContent=due?($('#quick-deadline').value?`${compact($('#quick-deadline').value)} 截止`:'先设截止日，再安排处理时间'):spanLabel(pendingCreatePlan);
 $('#quick-range-label').classList.toggle('deadline-summary',due);
}
function quickDraft(){
 const hasDeadline=$('#quick-has-deadline').checked;
 const plan=hasDeadline?{kind:$('#quick-plan-kind').value,start:$('#quick-plan-start').value,end:$('#quick-plan-end').value}:pendingCreatePlan;
 return {title:$('#quick-title').value.trim(),hasDeadline,deadline:$('#quick-deadline').value,allocateTime:$('#quick-allocate-time').checked,plan};
}
function editorDates(){
 const due=$('#task-has-deadline').checked,allocated=!due||$('#task-allocate-time').checked;
 if(due&&allocated&&$('#plan-kind').value==='none')$('#plan-kind').value='day';
 const kind=$('#plan-kind').value;
 $('#task-deadline-options').hidden=!due;$('#task-deadline').disabled=!due;$('#task-deadline').required=due;
 $('#editor-plan-fields').hidden=!allocated;$('#plan-kind').disabled=!allocated;$('#plan-kind-label').textContent=due?'处理时间':'日期安排';
 $('#plan-kind option[value="none"]').disabled=due;
 $('#plan-kind-field').hidden=kind==='segments';$('#editor-segments').hidden=!allocated||kind!=='segments';
 $('#date-fields').hidden=!allocated||kind==='none'||kind==='segments';$('#end-label').hidden=kind!=='range';
 $('#plan-start').disabled=!allocated||kind==='none'||kind==='segments';$('#plan-start').required=allocated&&kind!=='none'&&kind!=='segments';
 $('#plan-end').disabled=!allocated||kind!=='range';$('#plan-end').required=allocated&&kind==='range';
}
function openEditor(id,draft=null){
 const task=id?currentTask(id):null;if(id&&!task){toast('事项已更新，请重新选择。');return;}
 selectTask(id);
 if(id&&store.view.conflicts.some(c=>c.taskId===id)){openConflicts(id);return;}
 editing=task?structuredClone(task):null;editorHeads=structuredClone(store.view.heads);$('#task-id').value=id??'';$('#task-title').value=task?.title??draft?.title??'';$('#task-notes').value=task?.notes??'';
 const p=task?.plan??draft?.plan??{kind:'none',start:null,end:null};$('#plan-kind').value=p.kind;$('#plan-start').value=p.start??localToday();$('#plan-end').value=p.end??localToday();
 editorSegments=structuredClone(planParts(p));renderEditorSegments();
 $('#task-has-deadline').checked=task?Boolean(task.deadline):Boolean(draft?.hasDeadline);$('#task-allocate-time').checked=task?task.plan.kind!=='none':draft?.allocateTime??p.kind!=='none';
 $('#task-deadline').value=task?.deadline??draft?.deadline??p.end??localToday();editColor=task?.color??colors[0];
 $('#editor-error').textContent='';$('#toggle-done').textContent=task?.completed?'恢复未完成':'标为完成';$('#toggle-done').hidden=!task;$('#delete-task').hidden=!task;editorDates();renderColors();$('#editor').showModal();$('#task-title').focus();
}
function renderEditorSegments(){
 const list=$('#editor-segments');list.replaceChildren(el('p','timing-note','每段可在日历上单独拖动或拉伸。'));
 editorSegments.forEach((part,index)=>{
  const row=el('div','editor-segment'),label=el('span','',`${index+1}. ${spanLabel(part)}`),remove=el('button','quiet','移除');remove.type='button';remove.setAttribute('aria-label',`移除第 ${index+1} 段`);
  remove.addEventListener('click',()=>{editorSegments.splice(index,1);const p=packPlan(editorSegments);$('#plan-kind').value=p.kind;$('#plan-start').value=p.start??localToday();$('#plan-end').value=p.end??localToday();if(p.kind==='none')$('#task-allocate-time').checked=false;renderEditorSegments();editorDates();});
  row.append(label,remove);list.append(row);
 });
}
function renderColors(){$('#color-row').replaceChildren(...colors.map((color,i)=>{const b=el('button',`color-choice${color===editColor?' selected':''}`);b.type='button';b.style.setProperty('--color',color);b.setAttribute('aria-label',`颜色 ${i+1}`);b.setAttribute('aria-pressed',String(color===editColor));b.addEventListener('click',()=>{editColor=color;renderColors();});return b;}));}
function readEditor(){
 const title=$('#task-title').value.trim();if(!title)throw new Error('先写下事项名称。');const task=editing?{...editing}:emptyTask(title);task.title=title;task.notes=$('#task-notes').value;task.color=editColor;
 return validateTask({...task,...taskTiming({hasDeadline:$('#task-has-deadline').checked,deadline:$('#task-deadline').value,allocateTime:$('#task-allocate-time').checked,kind:$('#plan-kind').value,start:$('#plan-start').value,end:$('#plan-end').value,segments:editorSegments})});
}
function saveEditor(transform=t=>t){try{const task=transform(readEditor());if(!confirmPlan(task))return;selectedId=task.id;change([task],{expectedHeads:editorHeads});$('#editor').close();toast('已保存');}catch(error){$('#editor-error').textContent=error.message;}}
function addText(text){const lines=text.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);if(!lines.length)return;if(lines.length>1){$('#batch-input').value=lines.join('\n');$('#batch-error').textContent='';$('#batch-dialog').showModal();return;}change([emptyTask(lines[0])]);$('#quick-input').value='';$('#quick-input').focus();}
function openConflicts(taskId){
 const expectedHeads=structuredClone(store.view.heads),conflicts=store.view.conflicts.filter(c=>!taskId||c.taskId===taskId);$('#conflict-list').replaceChildren();
 for(const c of conflicts)for(const op of c.heads){
  const card=el('div','conflict-card');card.append(el('b','',op.task.title),el('p','muted',`${planLabel(op.task)} · ${op.task.completed?'已完成':'未完成'}${op.task.deleted?' · 已删除':''}${op.task.deadline?' · 截止 '+op.task.deadline:''}`),el('p','muted',op.task.notes),el('small','muted',new Date(op.createdAt).toLocaleString('zh-CN')));
  const choose=el('button','primary','保留这个版本');choose.addEventListener('click',safe(()=>{change([op.task],{resolve:true,expectedHeads});$('#conflicts').close();toast('已保留所选版本');}));card.append(choose);$('#conflict-list').append(card);
 }$('#conflicts').showModal();
}
async function loadSetup(synchronize=true){
 try{const r=await fetch('/api/setup',{cache:'no-store'});if(!r.ok)throw new Error();const setup=await r.json();transport=new HttpSyncTransport(location.origin,setup.token);webDavClient=new WebDavClient(setup.token);$('#pair-token').value=setup.token;
  const addresses=setup.addresses?.length?setup.addresses:[location.origin];$('#server-address').replaceChildren(...addresses.map(address=>{const text=String(address),url=text.startsWith('http')?text:`http://${text}:${setup.port}`,option=el('option','',url);option.value=url;return option;}));
  $('#setup-note').textContent='同一 Wi-Fi 使用电脑局域网地址。关闭电脑后，手机仍能查看和修改已同步内容。';if(synchronize)await sync(false);
 }catch{$('#setup-note').textContent='请从电脑本机打开以获取连接信息。所有事项仍保存在浏览器本地。';}
}
function clearWebDavPassword(){$('#webdav-password').value='';$('#webdav-clear-password').checked=false;}
function applyWebDavConfig(config){
 $('#webdav-enabled').checked=config.enabled;$('#webdav-url').value=config.url;$('#webdav-username').value=config.username;
 clearWebDavPassword();webDavDraftDirty=false;$('#webdav-password').placeholder=config.hasPassword?'已保存；留空保留现有密码':'输入 WebDAV 密码';
 $('#webdav-password-note').textContent=config.hasPassword?'已保存的密码不会回传。留空可保留；更换地址或用户名后，请重新输入。':'用户名和密码均留空可匿名连接。更换地址或用户名后，请重新输入密码。';
 $('#webdav-clear-label').hidden=!config.hasPassword;renderWebDavSettings();
}
function renderWebDavSettings(){
 if(native)return;
 const config=webDavClient?.config,status=webDavClient?.status,summary=$('#webdav-status');
 const description=describeSyncStatus({enabled:config?.enabled,status:status?{...status,lastError:webDavError||status.lastError}:null,syncing,localPending:store.pending});
 summary.textContent=webDavConfigError?webDavConfigError.message:!config?'尚未读取 WebDAV 设置，请从电脑本机打开设置。':!config.enabled?'WebDAV 已关闭，事项继续保存在本地。':description.text;
 if(config?.enabled&&status?.lastSync)summary.textContent+=`。上次成功：${new Date(status.lastSync).toLocaleString('zh-CN')}`;
 summary.classList.toggle('failed',Boolean(webDavConfigError||config?.enabled&&description.failed));
 $('#webdav-fields').disabled=webDavBusy||webDavConfigError?.localOnly===true;
 $('#webdav-url').required=$('#webdav-enabled').checked;
 $('#webdav-save').textContent=webDavBusy?'正在保存…':$('#webdav-enabled').checked?'保存并同步':'保存设置';
 $('#webdav-save').disabled=syncing||webDavBusy||!webDavClient;
 $('#webdav-sync').disabled=syncing||webDavBusy||webDavDraftDirty||!config?.enabled;
}
async function openSettings(){
 $('#settings').showModal();if(native)return;
 clearWebDavPassword();webDavDraftDirty=false;$('#webdav-error').textContent='';
 if(webDavClient?.config)applyWebDavConfig(webDavClient.config);
 try{
  if(!webDavClient)await loadSetup(false);if(!webDavClient)throw new Error('无法连接本机服务，请确认随历服务仍在运行。');
  const config=await webDavClient.loadConfig();webDavConfigError=null;
  if($('#settings').open&&!webDavDraftDirty)applyWebDavConfig(config);
 }catch(error){webDavConfigError=error;$('#webdav-error').textContent=error.message;}
 renderStatus();
}
async function saveWebDavSettings(event){
 event.preventDefault();if(native||webDavBusy||syncing||!webDavClient)return;
 const draft={enabled:$('#webdav-enabled').checked,url:$('#webdav-url').value,username:$('#webdav-username').value};
 if($('#webdav-clear-password').checked)draft.password='';else if($('#webdav-password').value)draft.password=$('#webdav-password').value;
 webDavBusy=true;$('#webdav-error').textContent='';renderStatus();let saved=null;
 try{saved=await webDavClient.saveConfig(draft);webDavConfigError=null;webDavError=null;applyWebDavConfig(saved);}
 catch(error){webDavConfigError=error;$('#webdav-error').textContent=error.message;}
 finally{clearWebDavPassword();webDavBusy=false;renderStatus();}
 if(saved?.enabled)await sync(true);else if(saved)toast('WebDAV 设置已保存，同步已关闭。');
}
function previewImport(raw){
 pendingImport=null;$('#import-preview').hidden=true;$('#import-error').textContent='';
 try{if(new TextEncoder().encode(raw).length>10*1024*1024)throw new Error('备份文件超过 10 MB。');const snapshot=JSON.parse(raw);if(snapshot.schemaVersion!==1||!Array.isArray(snapshot.operations))throw new Error('文件不是随历 v1 备份。');
  const merged=mergeOperations(store.snapshot.operations,snapshot.operations),view=materialize(merged);pendingImport=snapshot;$('#import-summary').textContent=`合并后共 ${view.tasks.filter(t=>!t.deleted).length} 件事项，${view.conflicts.length} 件需要选择版本。现有内容不会直接被覆盖。`;$('#import-preview').hidden=false;
 }catch(error){$('#import-error').textContent=error.message;}
}
function applyLaunchTarget(target){
 const next=resolveLaunchTarget({anchor,mode,filter},target);({anchor,mode,filter}=next);
 $$('[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===mode));$$('[data-filter]').forEach(n=>n.classList.toggle('active',n.dataset.filter===filter));render();
 if(next.scrollTo==='unplanned')requestAnimationFrame(scrollToUnplanned);else if(next.scrollTo==='calendar')requestAnimationFrame(scrollToCalendar);
}
function installEvents(){
 installDisplayControls();
 document.addEventListener('pointerdown',()=>{suppressClickUntil=0;},true);
 $('#new-task-button').addEventListener('click',()=>openQuickCreate());
 $('#draw-mode').addEventListener('click',()=>{drawMode=!drawMode;document.body.classList.toggle('drawing',drawMode);$('#draw-mode').setAttribute('aria-pressed',String(drawMode));$('#draw-mode').textContent=drawMode?'划选中 · 点此结束':'划选日期';toast(drawMode?'在空白日期上划一段，松手写事项':'已退出划选，可正常滚动日历');});
 for(const id of ['quick-has-deadline','quick-allocate-time','quick-plan-kind','quick-deadline'])$('#'+id).addEventListener('change',quickDates);
 $('#quick-create-form').addEventListener('submit',e=>{
  e.preventDefault();$('#quick-create-error').textContent='';
  try{const draft=quickDraft();if(!draft.title)throw new Error('先写下事项名称。');const task=validateTask({...emptyTask(draft.title),...taskTiming({...draft,...draft.plan})});if(!confirmPlan(task))return;selectedId=task.id;change([task]);$('#quick-create').close();toast(task.deadline&&task.plan.kind==='none'?'已记下截止日，可再用“安排日期”分配处理时间':'已添加事项');}
  catch(error){$('#quick-create-error').textContent=error.message;}
 });
 $('#quick-details').addEventListener('click',()=>{const draft=quickDraft();$('#quick-create').close();openEditor(null,draft);});
 $('#quick-calendar').addEventListener('click',()=>{
  try{const draft=quickDraft();if(!draft.title)throw new Error('先写下事项名称。');
   const task=validateTask({...emptyTask(draft.title),...taskTiming({...draft,...draft.plan})});if(!confirmPlan(task))return;
   selectedId=task.id;selectedSegment=null;change([task]);$('#quick-create').close();startPlanPicking();
  }catch(error){$('#quick-create-error').textContent=error.message;}
 });
 $('#editor-calendar').addEventListener('click',()=>{try{const task=readEditor();if(!confirmPlan(task))return;selectedId=task.id;selectedSegment=null;change([task],{expectedHeads:editorHeads});$('#editor').close();startPlanPicking();}catch(error){$('#editor-error').textContent=error.message;}});
 $('#selection-close').addEventListener('click',()=>selectTask(null));$('#selection-edit').addEventListener('click',()=>openEditor(selectedId));
 $('#selection-plan').addEventListener('click',()=>{if(planPicking){planPicking=null;document.body.classList.toggle('drawing',drawMode);renderSelection();}else startPlanPicking();});
 $('#selection-pick-range').addEventListener('click',()=>{if(!planPicking)return;planPicking.twoClicks=!planPicking.twoClicks;planPicking.rangeStart=null;renderSelection();});
 $('#selection-remove-segment').addEventListener('click',safe(()=>{const t=currentTask(selectedId);if(!t||selectedSegment===null)return;const next=removeTaskSegment(t,selectedSegment);selectedSegment=null;change([next]);toast('已移除此段，截止日和其它安排保留');}));
 $('#selection-complete').addEventListener('click',safe(()=>{const t=currentTask(selectedId);if(t)change([{...t,completed:!t.completed}]);}));
 $('#selection-unplan').addEventListener('click',safe(()=>{const t=currentTask(selectedId);if(t){change([unplanTask(t)]);scrollToUnplanned();}}));
 $('#selection-delete').addEventListener('click',safe(()=>{const t=currentTask(selectedId);if(t&&confirm('删除这件事？可以用撤销恢复。'))change([{...t,deleted:true}]);}));
 $('#selection-deadline').addEventListener('click',()=>{const t=currentTask(selectedId);if(!t)return;planPicking=null;document.body.classList.toggle('drawing',drawMode);deadlinePicking=deadlinePicking?null:{task:structuredClone(t),expectedHeads:structuredClone(renderedHeads)};document.body.classList.toggle('deadline-picking',Boolean(deadlinePicking));renderSelection();if(deadlinePicking){scrollToCalendar();toast('在日历上点一下截止日期；按 Esc 可取消');}});
 $('#quick-form').addEventListener('submit',safe(e=>{e.preventDefault();addText($('#quick-input').value);}));$('#quick-input').addEventListener('keydown',safe(e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();addText(e.target.value);}}));
 $('#batch-confirm').addEventListener('click',()=>{try{const lines=$('#batch-input').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);if(!lines.length)throw new Error('至少写一件事。');if(lines.length>100)throw new Error('每批最多 100 件，请分批记下。');change(lines.map(t=>emptyTask(t)));$('#quick-input').value='';$('#batch-dialog').close();toast(`已记下 ${lines.length} 件事项`);}catch(error){$('#batch-error').textContent=error.message;}});
 $$('[data-close]').forEach(b=>b.addEventListener('click',()=>{const dialog=b.closest('dialog');if(dialog.id==='settings')clearWebDavPassword();dialog.close();}));
 $$('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(n=>n.classList.toggle('active',n===b));render();}));
 $$('[data-view]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.view;$$('[data-view]').forEach(n=>n.classList.toggle('active',n===b));render();}));
 $('#search').addEventListener('input',e=>{search=e.target.value;render();});$('#show-completed').addEventListener('change',e=>{showCompleted=e.target.checked;render();});
 $('#undo-button').addEventListener('click',safe(()=>{store.undo();planPicking=null;document.body.classList.toggle('drawing',drawMode);selectedSegment=null;render();scheduleSync();toast('已撤销最近一次修改');}));
 const move=direction=>{if(mode!=='month')anchor=addDays(anchor,direction*(mode==='week'?7:28));else{const d=new Date(`${anchor.slice(0,7)}-01T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+direction);anchor=d.toISOString().slice(0,10);}render();};
 $('#previous').addEventListener('click',()=>move(-1));$('#next').addEventListener('click',()=>move(1));$('#today-button').addEventListener('click',()=>{anchor=localToday();render();});
 $('#task-has-deadline').addEventListener('change',()=>{if(!$('#task-has-deadline').checked&&!$('#task-allocate-time').checked)$('#plan-kind').value='none';editorDates();});
 $('#task-allocate-time').addEventListener('change',editorDates);$('#plan-kind').addEventListener('change',editorDates);$('#editor-form').addEventListener('submit',e=>{e.preventDefault();saveEditor();});
 $('#tomorrow').addEventListener('click',()=>saveEditor(t=>t.plan.kind==='week'?{...t,plan:planBetween(addDays(localToday(),1),addDays(localToday(),1))}:shiftPlan(t,addDays(localToday(),1))));
 $('#next-week').addEventListener('click',()=>saveEditor(t=>weekTaskAt(t,addDays(monday(localToday()),7))));$('#toggle-done').addEventListener('click',()=>saveEditor(t=>({...t,completed:!t.completed})));$('#delete-task').addEventListener('click',()=>{if(confirm('删除这件事？可以用撤销恢复。'))saveEditor(t=>({...t,deleted:true}));});
 $('#sync-button').addEventListener('click',()=>sync());$('#settings-button').addEventListener('click',()=>openSettings());
 $('#webdav-form').addEventListener('submit',saveWebDavSettings);$('#webdav-sync').addEventListener('click',()=>sync());
 $('#webdav-form').addEventListener('input',()=>{webDavDraftDirty=true;renderWebDavSettings();});$('#webdav-form').addEventListener('change',()=>{webDavDraftDirty=true;renderWebDavSettings();});
 $('#settings').addEventListener('cancel',clearWebDavPassword);
 $('#show-token').addEventListener('click',()=>{const hide=$('#pair-token').type==='password';$('#pair-token').type=hide?'text':'password';$('#show-token').textContent=hide?'隐藏':'显示';});$('#settings').addEventListener('close',()=>{$('#pair-token').type='password';$('#show-token').textContent='显示';clearWebDavPassword();webDavDraftDirty=false;});
 $('#copy-token').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#pair-token').value);toast('连接码已复制');}catch{toast('请点击显示后手动复制。');}});
 $('#backup-button').addEventListener('click',()=>$('#backup').showModal());
 $('#export-button').addEventListener('click',safe(()=>{if(native){native.exportBackup();return;}const blob=new Blob([JSON.stringify(store.snapshot,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=`随历备份-${localToday()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
 $('#import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024){pendingImport=null;$('#import-preview').hidden=true;$('#import-error').textContent='备份文件超过 10 MB。';return;}previewImport(await file.text());e.target.value='';});
 $('#import-confirm').addEventListener('click',safe(()=>{if(!pendingImport)return;store.acceptRemote(pendingImport,{acknowledge:false});pendingImport=null;$('#import-preview').hidden=true;$('#backup').close();render();scheduleSync();toast('备份已合并');}));
 $('#sample-button').addEventListener('click',safe(()=>{const start=monday(localToday()),t=(title,p,deadline=null,color=colors[0])=>({...emptyTask(`示例 · ${title}`),plan:p,deadline,color});change([t('整理研究资料',{kind:'none',start:null,end:null}),t('准备课程作业',planBetween(addDays(start,4),addDays(start,10)),addDays(start,20)),t('读完两篇论文',{kind:'week',start:addDays(start,7),end:addDays(start,13)},null,colors[1]),t('修改报告',planBetween(addDays(start,9),addDays(start,16)),null,colors[3])]);toast('已添加示例，可撤销整批移除');}));
 document.addEventListener('pointermove',e=>{if(gesture&&e.pointerId===gesture.id){e.preventDefault();updateGesture(e.clientX,e.clientY);}},{passive:false});
 document.addEventListener('pointerup',e=>{if(gesture&&e.pointerId===gesture.id){updateGesture(e.clientX,e.clientY);endGesture();}});
 document.addEventListener('pointercancel',e=>{if(gesture&&e.pointerId===gesture.id)endGesture(true);});document.addEventListener('lostpointercapture',e=>{if(gesture&&e.pointerId===gesture.id)endGesture(true);});
 window.addEventListener('blur',()=>{if(gesture)endGesture(true);});
 window.addEventListener('storage',safe(e=>{if(e.key===STORAGE_KEY){store.refresh();render();}}));window.addEventListener('online',()=>sync(false));window.addEventListener('focus',()=>sync(false));
 document.addEventListener('keydown',safe(e=>{
  if(e.key==='Escape'){if(gesture)endGesture(true);selectTask(selectedId);}
  if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!/INPUT|TEXTAREA/.test(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();store.undo();render();scheduleSync();}
 }));
 if(native){
  document.body.classList.add('native-app');$('#settings-button').textContent='设置';
  for(const id of ['native-settings','native-widget','native-import-button'])$('#'+id).hidden=false;
  $('#native-settings').addEventListener('click',()=>native.openSettings());$('#native-widget').addEventListener('click',()=>native.pinWidget());$('#native-import-button').addEventListener('click',()=>native.chooseImport());
  window.addEventListener('suili-native-update',safe(()=>{store.refresh();render();}));
  window.addEventListener('suili-native-import',e=>{if(!$('#backup').open)$('#backup').showModal();previewImport(e.detail);});
  window.addEventListener('suili-native-navigate',safe(e=>applyLaunchTarget(e.detail)));
 }
}
function pausePage(message){document.querySelectorAll('body > :not(#fatal):not(script)').forEach(n=>n.inert=true);$('#fatal').hidden=false;$('#fatal').textContent=message;}
function fatal(error){pausePage(`无法开始编辑：${error.message}。已有记录没有被清空。`);}
try{
 if(native){store=new NativeStore(native);installEvents();applyLaunchTarget(store.launchTarget);}
 else{
  const session=holdEditSession(navigator.locks,owner=>{
   store=new LocalStore(localStorage,()=>owner.active);document.querySelectorAll('body > :not(#fatal):not(script)').forEach(n=>n.inert=false);$('#fatal').hidden=true;installEvents();render();loadSetup();
   setInterval(()=>{if(owner.active&&document.visibilityState==='visible')sync(false);},30000);if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  },()=>pausePage('正在等待编辑窗口。如果已打开随历，请继续使用那个标签页；关闭它后，这里会自动接续。'));
  session.done.catch(fatal);window.addEventListener('pagehide',()=>{session.stop();pausePage('此页面已暂停，请重新打开随历继续编辑。');});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 }
}catch(error){fatal(error);}
