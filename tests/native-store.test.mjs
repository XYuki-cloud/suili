import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeStore } from '../web/native-store.mjs';
import { emptyTask, makeOperation, mergeOperations, materialize } from '../shared/core.mjs';

// The bridge substitute models durable state and an edit occurring between JS read and native save.
function nativeBridge() {
 let data={schemaVersion:1,deviceId:'android-test',operations:[],ackIds:[],lastSync:null};
 const calls=[];
 const bridge={calls,beforeSave:null,fail:null,
  readState:()=>JSON.stringify({ok:true,data,status:'离线',syncing:false,launchTarget:{date:null,week:null,filter:null}}),
  saveSnapshot(raw,expectedRaw){
   const snapshot=JSON.parse(raw), expected=JSON.parse(expectedRaw);calls.push({snapshot,expected});
   bridge.beforeSave?.();bridge.beforeSave=null;
   if(bridge.fail)return JSON.stringify({ok:false,error:bridge.fail});
   const heads=materialize(data.operations).heads;
   if(expected)for(const [id,seen] of Object.entries(expected))if(JSON.stringify([...(heads[id]??[])].sort())!==JSON.stringify([...seen].sort()))return JSON.stringify({ok:false,error:'事项已有新的更新'});
   data={...data,operations:mergeOperations(data.operations,snapshot.operations)};
   return bridge.readState();
  },
  remote(task){data.operations=mergeOperations(data.operations,[makeOperation(task,data.operations,'remote')]);},
  acknowledge(){data.ackIds=data.operations.map(op=>op.id);data.lastSync='2026-10-23T12:00:00.000Z';}
 };return bridge;
}
test('native state is the only data source; batch commit and undo preserve native device and acknowledgment',()=>{
 const bridge=nativeBridge(),store=new NativeStore(bridge),tasks=[emptyTask('A'),emptyTask('B')];
 store.commit(tasks);assert.equal(store.view.tasks.length,2);assert.equal(bridge.calls.length,1);
 assert.deepEqual(bridge.calls[0].expected,Object.fromEntries(tasks.map(t=>[t.id,[]])));
 assert.equal(store.data.operations.every(op=>op.deviceId==='android-test'),true);
 bridge.acknowledge();store.refresh();assert.equal(store.pending,0);
 store.undo();assert.equal(store.view.tasks.every(t=>t.deleted),true);assert.equal(store.pending,2);
 assert.equal(store.canUndo,false);assert.equal(store.data.lastSync,'2026-10-23T12:00:00.000Z');
});
test('native CAS rejects a concurrent edit after JS refresh without adding undo history',()=>{
 const bridge=nativeBridge(),store=new NativeStore(bridge),task=emptyTask('A');store.commit([task]);
 bridge.beforeSave=()=>bridge.remote({...task,title:'remote'});
 assert.throws(()=>store.commit([{...task,title:'stale'}]),/更新/);
 store.refresh();assert.equal(store.view.tasks[0].title,'remote');assert.equal(store.history.length,1);
});
test('an explicit draft head is never replaced by a refreshed head',()=>{
 const bridge=nativeBridge(),store=new NativeStore(bridge),task=emptyTask('A');store.commit([task]);
 const expectedHeads=structuredClone(store.view.heads);bridge.remote({...task,title:'remote'});
 assert.throws(()=>store.commit([{...task,title:'stale'}],{expectedHeads}),/更新/);
});
test('a task read before a remote update cannot overwrite it through an ordinary commit',()=>{
 const bridge=nativeBridge(),store=new NativeStore(bridge),task=emptyTask('A');store.commit([task]);
 const draft=structuredClone(store.view.tasks[0]);bridge.remote({...task,title:'remote'});
 assert.throws(()=>store.commit([{...draft,title:'stale'}]),/更新/);
 assert.equal(store.view.tasks[0].title,'remote');assert.equal(store.history.length,1);
});
test('native failures keep saved state and history; imports merge without claiming acknowledgment',()=>{
 const bridge=nativeBridge(),store=new NativeStore(bridge),task=emptyTask('import');
 bridge.fail='disk full';assert.throws(()=>store.commit([task]),/disk full/);assert.equal(store.view.tasks.length,0);assert.equal(store.canUndo,false);
 bridge.fail=null;const snapshot={schemaVersion:1,operations:[makeOperation(task,[],'backup')]};
 assert.throws(()=>store.acceptRemote(snapshot),/原生|确认/);
 store.acceptRemote(snapshot,{acknowledge:false});assert.equal(store.pending,1);assert.equal(store.data.lastSync,null);assert.equal(bridge.calls.at(-1).expected,null);
 assert.deepEqual(Object.keys(bridge.calls.at(-1).snapshot).sort(),['operations','schemaVersion']);
});
test('a failed or malformed initial native read never falls back to empty browser storage',()=>{
 assert.throws(()=>new NativeStore({readState:()=>JSON.stringify({ok:false,error:'corrupt store'})}),/corrupt/);
 assert.throws(()=>new NativeStore({readState:()=>'{bad'}));
});
