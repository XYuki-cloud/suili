import { LocalStore } from './local-store.mjs';
import { mergeOperations } from '../shared/core.mjs';

function stateFrom(raw) {
 const state=JSON.parse(raw);
 if(!state?.ok)throw new Error(state?.error||'原生存储没有返回可用数据，已有记录未清空。');
 const data=state.data;
 if(data?.schemaVersion!==1||typeof data.deviceId!=='string'||!data.deviceId||!Array.isArray(data.ackIds)||data.ackIds.some(id=>typeof id!=='string'))throw new Error('原生数据格式异常，请先保留备份。');
 data.operations=mergeOperations([],data.operations);
 return state;
}

/** Shares the native operation log; no second browser copy or browser sync credentials. */
export class NativeStore extends LocalStore {
 constructor(bridge=globalThis.SuiliNative) {
  let initial;
  super({getItem(){initial=stateFrom(bridge.readState());return JSON.stringify(initial.data);},setItem(){throw new Error('手机数据只能写入原生存储');}});
  this.bridge=bridge;this.expectedHeads=null;this.undoExpectedHeads=null;this.applyNative(initial);
 }
 applyNative(state){this.data=state.data;this.status=state.status||'';this.syncing=Boolean(state.syncing);this.launchTarget=state.launchTarget||{};}
 refresh(){this.applyNative(stateFrom(this.bridge.readState()));}
 save(next){
  if(!this.canWrite())throw new Error('当前界面不能保存，请重新打开应用。');
  const result=stateFrom(this.bridge.saveSnapshot(JSON.stringify({schemaVersion:1,operations:next.operations}),JSON.stringify(this.expectedHeads)));
  this.applyNative(result);
 }
 commit(tasks,options={}) {
  const seen=options.expectedHeads??this.undoExpectedHeads??this.view.heads;
  this.refresh();
  this.expectedHeads=Object.fromEntries(tasks.map(task=>[task.id,[...(seen[task.id]??[])]]));
  try{return super.commit(tasks,{...options,expectedHeads:this.expectedHeads});}
  finally{this.expectedHeads=null;}
 }
 undo(){
  const entry=this.history.at(-1);if(!entry)return;
  this.undoExpectedHeads=Object.fromEntries(Object.entries(entry.newIds).map(([id,op])=>[id,[op]]));
  try{return super.undo();}finally{this.undoExpectedHeads=null;}
 }
 acceptRemote(snapshot,{acknowledge=true}={}) {
  if(acknowledge!==false)throw new Error('同步确认只能由原生同步器更新；备份导入需明确 acknowledge:false。');
  return super.acceptRemote(snapshot,{acknowledge:false});
 }
}
