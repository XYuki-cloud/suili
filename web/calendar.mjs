import { planParts } from '../shared/core.mjs';

const dayMs=86400000;
export function localToday(date=new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
export function addDays(iso,n) { return new Date(Date.parse(`${iso}T12:00:00Z`)+n*dayMs).toISOString().slice(0,10); }
export function monday(iso) { return addDays(iso,-((new Date(`${iso}T12:00:00Z`).getUTCDay()+6)%7)); }
export function getWeeks(anchor,mode) {
 const first=mode==='month'?`${anchor.slice(0,7)}-01`:anchor;
 const start=monday(first);
 const d=new Date(`${first}T12:00:00Z`);
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0,12)).toISOString().slice(0,10);
 const count=mode==='week'?1:mode==='four'?4:Math.ceil(((Date.parse(last)-Date.parse(start))/dayMs+1)/7);
 return Array.from({length:count},(_,w)=>Array.from({length:7},(_,i)=>addDays(start,w*7+i)));
}
export function layoutWeek(tasks,start) {
 const end=addDays(start,6), segments=[], weekTasks=[], deadlines=[], lanes=[];
 const live=tasks.filter(task=>!task.deleted);
 const candidates=live.flatMap(task=>planParts(task.plan).map((plan,segmentIndex)=>({task,plan,segmentIndex})))
  .filter(item=>item.plan.start<=end&&item.plan.end>=start);
 candidates.sort((a,b)=>a.plan.start.localeCompare(b.plan.start)||b.plan.end.localeCompare(a.plan.end)||a.task.id.localeCompare(b.task.id)||a.segmentIndex-b.segmentIndex);
 // Seven occupied-day bits per lane allow later deadlines to fill earlier holes.
 const reserve=(col,span)=>{
  const mask=((1<<span)-1)<<col;
  let lane=lanes.findIndex(occupied=>(occupied&mask)===0);
  if(lane<0)lane=lanes.length;
  lanes[lane]=(lanes[lane]??0)|mask;
  return lane;
 };
 for(const item of candidates) {
  const {plan}=item;
  if(plan.kind==='week') { weekTasks.push(item); continue; }
  const from=plan.start<start?start:plan.start, to=plan.end>end?end:plan.end;
  const col=Math.round((Date.parse(from)-Date.parse(start))/dayMs), span=Math.round((Date.parse(to)-Date.parse(from))/dayMs)+1;
  const lane=reserve(col,span);
  segments.push({...item,startColumn:col,span,lane,continuesBefore:plan.start<start,continuesAfter:plan.end>end});
 }
 const due=live.filter(task=>task.deadline&&task.deadline>=start&&task.deadline<=end)
  .sort((a,b)=>a.deadline.localeCompare(b.deadline)||a.id.localeCompare(b.id));
 for(const task of due) {
  const startColumn=Math.round((Date.parse(task.deadline)-Date.parse(start))/dayMs);
  deadlines.push({task,startColumn,span:1,lane:reserve(startColumn,1)});
 }
 return {segments,weekTasks,deadlines,laneCount:lanes.length};
}
export function classifyTask(task,today) {
 if(task.completed)return 'completed';
 if(task.deadline&&task.deadline<today)return 'overdue';
 if(task.deadline===today)return 'due';
 if(task.plan.kind!=='none'&&task.plan.end<today)return 'replan';
 return task.plan.kind==='none'?'unplanned':'planned';
}
export function planLabel(task) {
 const parts=planParts(task.plan);
 if(!parts.length)return '待安排';
 const compact=date=>`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`;
 return parts.map(p=>p.kind==='day'?compact(p.start):`${compact(p.start)} – ${compact(p.end)}${p.kind==='week'?' · 这周找时间':''}`).join('；');
}
