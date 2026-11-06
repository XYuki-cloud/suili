import { makeOperation, mergeOperations, materialize } from '../shared/core.mjs';
export const STORAGE_KEY='flexible-calendar-v1';
const copy=value=>JSON.parse(JSON.stringify(value));
export class LocalStore {
 constructor(storage=localStorage,canWrite=()=>true) {
  this.storage=storage;this.canWrite=canWrite;this.history=[];
  const raw=storage.getItem(STORAGE_KEY);
  this.data=raw?JSON.parse(raw):{schemaVersion:1,deviceId:crypto.randomUUID(),operations:[],ackIds:[],lastSync:null};
  if(this.data.schemaVersion!==1||typeof this.data.deviceId!=='string'||!Array.isArray(this.data.ackIds))throw new Error('本地数据格式异常，请先保留备份，不能自动清空。');
  this.data.operations=mergeOperations([],this.data.operations);
 }
 get view(){return materialize(this.data.operations);}
 get snapshot(){return {schemaVersion:1,operations:copy(this.data.operations)};}
 get pending(){const ack=new Set(this.data.ackIds);return this.data.operations.filter(op=>!ack.has(op.id)).length;}
 get canUndo(){return this.history.length>0;}
 save(next){if(!this.canWrite())throw new Error('编辑已转交给另一个标签页，请重新打开此页面。');this.storage.setItem(STORAGE_KEY,JSON.stringify(next));this.data=next;}
 refresh(){
  const raw=this.storage.getItem(STORAGE_KEY);if(!raw)return;
  const incoming=JSON.parse(raw);if(incoming.schemaVersion!==1)throw new Error('不支持的本地数据版本');
  const operations=mergeOperations(this.data.operations,incoming.operations);
  this.data={...this.data,operations,ackIds:[...new Set([...this.data.ackIds,...incoming.ackIds])],lastSync:incoming.lastSync||this.data.lastSync};
 }
 commit(tasks,{resolve=false,recordUndo=true,expectedHeads=null}={}) {
  this.refresh();const view=this.view, conflicts=new Set(view.conflicts.map(c=>c.taskId));
  if(expectedHeads)for(const task of tasks)if(JSON.stringify([...(view.heads[task.id]??[])].sort())!==JSON.stringify([...(expectedHeads[task.id]??[])].sort()))throw new Error('事项已有新的更新，请先复制你的草稿，再关闭并重新打开这件事。');
  if(!resolve&&tasks.some(t=>conflicts.has(t.id)))throw new Error('这件事有同步冲突，请先选择要保留的版本。');
  let operations=this.data.operations;const previous=[],newIds={};
  for(const task of tasks){
   previous.push(copy(view.tasks.find(t=>t.id===task.id)??{...task,deleted:true}));
   const op=makeOperation(task,operations,this.data.deviceId);operations=mergeOperations(operations,[op]);newIds[task.id]=op.id;
  }
  this.save({...this.data,operations});
  if(recordUndo){this.history.push({previous,newIds,previousHeads:copy(view.heads)});if(this.history.length>30)this.history.shift();}
 }
 undo(){
  this.refresh();const entry=this.history.at(-1);if(!entry)return;
  const heads=this.view.heads;
  for(const [id,opId] of Object.entries(entry.newIds))if(heads[id]?.length!==1||heads[id][0]!==opId)throw new Error('事项已有新的更新，为避免覆盖，不能撤销这一步。');
  this.commit(entry.previous,{recordUndo:false});this.history.pop();
  const afterHeads=this.view.heads;
  for(const id of Object.keys(entry.newIds)){
   const previous=this.history.findLast(h=>h.newIds[id]);
   if(previous&&entry.previousHeads[id]?.length===1&&previous.newIds[id]===entry.previousHeads[id][0])previous.newIds[id]=afterHeads[id][0];
  }
 }
 acceptRemote(snapshot,{acknowledge=true}={}) {
  if(snapshot.schemaVersion!==1||!Array.isArray(snapshot.operations))throw new Error('不支持的备份格式');
  this.refresh();const operations=mergeOperations(this.data.operations,snapshot.operations);
  const ackIds=acknowledge?[...new Set([...this.data.ackIds,...snapshot.operations.map(op=>op.id)])]:this.data.ackIds;
  this.save({...this.data,operations,ackIds,lastSync:acknowledge?new Date().toISOString():this.data.lastSync});
 }
}
