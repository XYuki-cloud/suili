package app.flexible.calendar;

import android.app.Instrumentation;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.os.Bundle;
import org.json.*;
import java.io.File;
import java.util.*;

/** Runs Android's real JSON implementation and atomic file path, without touching calendar data. */
public final class ProtocolInstrumentation extends Instrumentation {
    interface Checked { void run() throws Exception; }
    private int count;
    private final StringBuilder report=new StringBuilder();
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    void check(String name,Checked test) throws Exception {test.run();count++;report.append("PASS ").append(name).append('\n');}
    static void truth(boolean ok){if(!ok)throw new AssertionError("Assertion failed");}
    static void rejected(Checked action) throws Exception {try{action.run();}catch(IllegalArgumentException|JSONException expected){return;}throw new AssertionError("Expected rejection");}
    @Override public void onStart(){Bundle result=new Bundle();try{
        Core.Task task=new Core.Task("11111111-1111-4111-8111-111111111111","仅测试 · 原子文件");task.notes="汉字\nnew line";task.kind="range";task.start="2026-10-26";task.end="2026-11-01";task.deadline="2026-11-08";
        Core.Op root=new Core.Op("root",task,Collections.emptyList(),"test","2026-10-23T12:00:00.000Z");
        String wire=JsonCodec.encode(Collections.singletonList(root));
        check("JSON round trip preserves Chinese, dates and all task fields",()->truth(JsonCodec.decode(wire).get(0).equals(root)));
        check("boolean string is rejected without coercion",()->{JSONObject o=new JSONObject(wire);o.getJSONArray("operations").getJSONObject(0).getJSONObject("task").put("completed","false");rejected(()->JsonCodec.decode(o.toString()));});
        check("unknown task field is rejected",()->{JSONObject o=new JSONObject(wire);o.getJSONArray("operations").getJSONObject(0).getJSONObject("task").put("unknown",1);rejected(()->JsonCodec.decode(o.toString()));});
        check("unknown operation field is rejected",()->{JSONObject o=new JSONObject(wire);o.getJSONArray("operations").getJSONObject(0).put("unknown",1);rejected(()->JsonCodec.decode(o.toString()));});
        check("missing task field is rejected",()->{JSONObject o=new JSONObject(wire);o.getJSONArray("operations").getJSONObject(0).getJSONObject("task").remove("notes");rejected(()->JsonCodec.decode(o.toString()));});
        check("snapshot contains no credentials",()->truth(!wire.contains("token")&&!wire.contains("serverUrl")));
        String namespace="protocol_test_"+UUID.randomUUID();
        File directory=new File(getTargetContext().getCacheDir(),namespace);truth(directory.mkdir());
        Context isolated=new ContextWrapper(getTargetContext()){
            @Override public Context getApplicationContext(){return this;}
            @Override public File getFilesDir(){return directory;}
            @Override public SharedPreferences getSharedPreferences(String name,int mode){return super.getSharedPreferences(namespace+"_"+name,mode);}
        };
        Store store=new Store(isolated);
        check("imported foreign operation counts as pending",()->{store.merge(Collections.singletonList(root),false);truth(store.pending(store.load())==1);});
        check("atomic persisted snapshot is readable in a new Store",()->truth(new Store(isolated).load().get(0).equals(root)));
        Core.Task edit=task.copy();edit.completed=true;
        Core.Op changed=store.change(edit,Collections.singletonList("root"));
        check("stale draft rejected and file bytes remain equivalent",()->{String before=store.snapshot();rejected(()->store.change(task,Collections.singletonList("root")));truth(before.equals(store.snapshot()));});
        check("invalid incoming batch leaves persisted data unchanged",()->{String before=store.snapshot();Core.Op bad=new Core.Op("bad",task,Collections.singletonList("absent"),"test","2026-10-23T13:00:00Z");rejected(()->store.merge(Collections.singletonList(bad),false));truth(before.equals(store.snapshot()));});
        check("acknowledgment clears pending and preserves final completion",()->{List<Core.Op> all=store.load();store.merge(all,true);truth(store.pending(store.load())==0);truth(Core.tasks(store.load()).get(0).completed);});
        check("sync response preserves a local edit made during exchange",()->{
            SyncCoordinator.exchange(isolated,outgoing->{Core.Task concurrent=Core.tasks(store.load()).get(0);concurrent.title="网络返回前的本地修改";List<String> parents=new ArrayList<>();for(Core.Op o:Core.heads(store.load(),concurrent.id))parents.add(o.id);store.change(concurrent,parents);return outgoing;});
            truth(Core.tasks(store.load()).get(0).title.equals("网络返回前的本地修改"));truth(store.pending(store.load())==1);
        });
        check("transport failure keeps local history and pending queue",()->{String before=store.snapshot();try{SyncCoordinator.exchange(isolated,outgoing->{throw new java.io.IOException("expected offline test");});throw new AssertionError("Should fail");}catch(java.io.IOException expected){}truth(before.equals(store.snapshot()));truth(store.pending(store.load())==1);});
        check("unconfigured automatic sync is a no-op with completion callback",()->{java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);SyncCoordinator.request(isolated,false,done::countDown);truth(done.await(3,java.util.concurrent.TimeUnit.SECONDS));});
        check("native read exposes consistent operations, device and native acknowledgments without credentials",()->{
            JSONObject nativeState=store.nativeState();truth(nativeState.getInt("schemaVersion")==1);truth(nativeState.getString("deviceId").startsWith("android-"));truth(nativeState.getJSONArray("operations").length()==store.load().size());truth(nativeState.getJSONArray("ackIds").length()>0);truth(!nativeState.has("token")&&!nativeState.has("serverUrl"));
        });
        check("native batch CAS rejects one stale item without saving any other item",()->{
            List<Core.Op> base=store.load();Core.Task first=Core.tasks(base).get(0);Core.Task added=new Core.Task(UUID.randomUUID().toString(),"批量新增");Core.Op a=Core.makeOp(first,base,"android-test"),b=Core.makeOp(added,base,"android-test");
            List<Core.Op> batch=Core.merge(base,Arrays.asList(a,b));JSONObject expected=new JSONObject().put(first.id,new JSONArray(Arrays.asList("outdated"))).put(added.id,new JSONArray());String before=store.snapshot();rejected(()->store.saveNativeSnapshot(JsonCodec.encode(batch),expected.toString()));truth(before.equals(store.snapshot()));
        });
        check("native batch requires an expected head for every changed item",()->{
            List<Core.Op> base=store.load();Core.Task first=Core.tasks(base).get(0);String before=store.snapshot();Core.Op op=Core.makeOp(first,base,"android-test");rejected(()->store.saveNativeSnapshot(JsonCodec.encode(Core.merge(base,Collections.singletonList(op))),"{}"));truth(before.equals(store.snapshot()));
        });
        check("native snapshot preserves omitted existing operations and cannot write acknowledgment state",()->{
            String before=store.snapshot();JSONObject foreign=new JSONObject().put("schemaVersion",1).put("operations",new JSONArray()).put("ackIds",new JSONArray().put("forged"));rejected(()->store.saveNativeSnapshot(foreign.toString(),"null"));truth(before.equals(store.snapshot()));
            int pending=store.pending(store.load());store.saveNativeSnapshot("{\"schemaVersion\":1,\"operations\":[]}","null");truth(before.equals(store.snapshot()));truth(store.pending(store.load())==pending);
        });
        check("native snapshot applies the same 10 MB UTF-8 byte limit without changing saved data",()->{
            char[] chars=new char[3_500_000];Arrays.fill(chars,'中');String before=store.snapshot();
            try{store.saveNativeSnapshot(new String(chars),"null");throw new AssertionError("Oversized input was accepted");}
            catch(IllegalArgumentException expected){truth(expected.getMessage().contains("10 MB"));}
            truth(before.equals(store.snapshot()));
        });
        check("native conflict resolution checks all seen heads and commits the whole batch",()->{
            List<Core.Op> beforeConflict=store.load();Core.Task first=Core.tasks(beforeConflict).get(0);Core.Op local=Core.makeOp(first,beforeConflict,"local-test"),remote=Core.makeOp(first,beforeConflict,"remote-test");store.merge(Core.merge(beforeConflict,Arrays.asList(local,remote)),false);
            List<Core.Op> base=store.load();Core.Task added=new Core.Task(UUID.randomUUID().toString(),"批量新增");Core.Op a=Core.makeOp(first,base,"android-test"),b=Core.makeOp(added,base,"android-test");List<Core.Op> batch=Core.merge(base,Arrays.asList(a,b));
            JSONObject expected=new JSONObject().put(first.id,new JSONArray(Collections.singletonList(local.id))).put(added.id,new JSONArray());String before=store.snapshot();rejected(()->store.saveNativeSnapshot(JsonCodec.encode(batch),expected.toString()));truth(before.equals(store.snapshot()));
            expected.put(first.id,new JSONArray(a.parents));int pending=store.pending(base);store.saveNativeSnapshot(JsonCodec.encode(batch),expected.toString());truth(store.load().size()==base.size()+2);truth(store.pending(store.load())==pending+2);truth(Core.heads(store.load(),first.id).size()==1);
        });
        check("quick entry draft survives render and saved instance state",()->{
            MainActivity activity=(MainActivity)startActivitySync(new android.content.Intent(getTargetContext(),MainActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
            java.util.concurrent.atomic.AtomicReference<String> failure=new java.util.concurrent.atomic.AtomicReference<>();
            runOnMainSync(()->{try{android.widget.EditText quick=activity.getWindow().getDecorView().findViewWithTag("quick_entry");quick.setText("未提交的测试草稿");quick.setSelection(4);activity.render();android.widget.EditText restored=activity.getWindow().getDecorView().findViewWithTag("quick_entry");if(!restored.getText().toString().equals("未提交的测试草稿"))throw new AssertionError("draft="+restored.getText());if(restored.getSelectionStart()!=4)throw new AssertionError("cursor="+restored.getSelectionStart());Bundle state=new Bundle();activity.onSaveInstanceState(state);truth(state.getString("quickDraft").equals("未提交的测试草稿"));restored.setText("");}catch(Throwable error){failure.set(error.getMessage());}finally{activity.finish();}});
            if(failure.get()!=null)throw new AssertionError(failure.get());
        });
        check("shared planner loads bundled HTTPS UI and a readable native bridge with file access disabled",()->{
            PlannerActivity activity=(PlannerActivity)startActivitySync(new android.content.Intent(getTargetContext(),PlannerActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
            java.util.concurrent.atomic.AtomicReference<String> resultJson=new java.util.concurrent.atomic.AtomicReference<>();
            try{
                for(int attempt=0;attempt<30;attempt++){
                    java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);
                    runOnMainSync(()->{
                        android.webkit.WebView view=activity.getWindow().getDecorView().findViewWithTag("planner_web");truth(view!=null);truth(!view.getSettings().getAllowFileAccess());truth(!view.getSettings().getAllowContentAccess());truth(view.getSettings().getBlockNetworkLoads());truth(view.getSettings().getMixedContentMode()==android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
                        view.evaluateJavascript("JSON.stringify({origin:location.origin,ready:document.readyState,bridge:typeof SuiliNative,ok:typeof SuiliNative==='object'&&JSON.parse(SuiliNative.readState()).ok,calendar:!!document.getElementById('calendar')})",value->{resultJson.set(value);done.countDown();});
                    });
                    truth(done.await(3,java.util.concurrent.TimeUnit.SECONDS));
                    if(resultJson.get()!=null&&!resultJson.get().equals("null")){
                        Object decoded=new JSONTokener(resultJson.get()).nextValue();
                        if(decoded instanceof String){JSONObject state=new JSONObject((String)decoded);if(state.optBoolean("calendar")&&state.optString("ready").equals("complete")){truth(state.getString("origin").equals("https://appassets.androidplatform.net"));truth(state.getBoolean("ok"));return;}}
                    }
                    Thread.sleep(200);
                }
                throw new AssertionError("Shared planner did not finish loading: "+resultJson.get());
            }finally{runOnMainSync(activity::finish);}
        });
        check("unconfigured automatic planner sync does not open pairing settings",()->{
            PlannerActivity activity=(PlannerActivity)startActivitySync(new android.content.Intent(getTargetContext(),PlannerActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
            java.lang.reflect.Field field=PlannerActivity.class.getDeclaredField("store");field.setAccessible(true);
            ActivityMonitor monitor=addMonitor(MainActivity.class.getName(),null,false);
            try{
                runOnMainSync(()->{try{field.set(activity,store);activity.new NativeBridge().requestSync(false);}catch(IllegalAccessException e){throw new AssertionError(e);}});
                android.app.Activity unexpected=waitForMonitorWithTimeout(monitor,700);
                if(unexpected!=null){runOnMainSync(unexpected::finish);throw new AssertionError("Automatic sync opened pairing");}
            }finally{removeMonitor(monitor);runOnMainSync(activity::finish);}
        });
        check("planner container insets constrain the WebView viewport instead of padding web content",()->{
            PlannerActivity activity=(PlannerActivity)startActivitySync(new android.content.Intent(getTargetContext(),PlannerActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
            try{runOnMainSync(()->{
                android.view.View container=activity.getWindow().getDecorView().findViewWithTag("planner_container");
                android.webkit.WebView view=activity.getWindow().getDecorView().findViewWithTag("planner_web");
                truth(container instanceof android.widget.FrameLayout);truth(view.getParent()==container);
                android.view.WindowInsets actual=container.getRootWindowInsets();truth(actual!=null);
                android.view.WindowInsets simulated=actual.replaceSystemWindowInsets(11,29,13,31);container.dispatchApplyWindowInsets(simulated);
                truth(container.getPaddingLeft()==11&&container.getPaddingTop()==29&&container.getPaddingRight()==13&&container.getPaddingBottom()==31);
                int exact=android.view.View.MeasureSpec.EXACTLY;container.measure(android.view.View.MeasureSpec.makeMeasureSpec(600,exact),android.view.View.MeasureSpec.makeMeasureSpec(1000,exact));container.layout(0,0,600,1000);
                truth(view.getLeft()==11&&view.getTop()==29);truth(view.getWidth()==576&&view.getHeight()==940);
                truth(view.getPaddingTop()==0&&view.getPaddingBottom()==0);
                truth((activity.getWindow().getAttributes().softInputMode&android.view.WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST)==android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            });}finally{runOnMainSync(activity::finish);}
        });
        result.putString("stream",report+"Android protocol tests passed: "+count+"\n");finish(-1,result);
    }catch(Throwable failure){result.putString("stream",report+"FAIL "+failure.getClass().getSimpleName()+": "+failure.getMessage()+"\n");finish(0,result);}}
}
