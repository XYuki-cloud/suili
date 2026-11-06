package app.flexible.calendar;

import android.app.Instrumentation;
import android.content.*;
import android.os.Bundle;
import java.io.*;
import java.util.*;
import org.json.*;

/** Isolated native storage/Keystore checks, plus optional external DAV interoperability. */
public final class WebDavInstrumentation extends Instrumentation {
    interface Checked {void run() throws Exception;}
    private int count;
    private Bundle arguments;
    private final StringBuilder report=new StringBuilder();
    @Override public void onCreate(Bundle args){super.onCreate(args);arguments=args;start();}
    private void check(String name,Checked action)throws Exception{action.run();count++;report.append("PASS ").append(name).append('\n');}
    private static void truth(boolean value){if(!value)throw new AssertionError("Assertion failed");}
    private static Core.Op operation(String id){return new Core.Op(id,new Core.Task(UUID.randomUUID().toString(),"WebDAV 测试"),Collections.emptyList(),"android-dav-test","2026-10-25T10:00:00Z");}
    @Override public void onStart(){Bundle result=new Bundle();try{
        String namespace="dav_test_"+UUID.randomUUID();File directory=new File(getTargetContext().getCacheDir(),namespace);truth(directory.mkdir());
        Context isolated=new ContextWrapper(getTargetContext()){
            @Override public Context getApplicationContext(){return this;}
            @Override public File getFilesDir(){return directory;}
            @Override public SharedPreferences getSharedPreferences(String name,int mode){return super.getSharedPreferences(namespace+"_"+name,mode);}
        };
        Store store=new Store(isolated);store.prefs.edit().putBoolean("autoSync",false).commit();
        Core.Op a=operation("android-dav-root-"+UUID.randomUUID());store.merge(Collections.singletonList(a),false);
        String secret="native-test-secret-汉字-"+UUID.randomUUID();
        check("WebDAV password is encrypted with Android Keystore and never exported",()->{
            store.saveWebDavConfig("https://example.com/dav/calendar.json","native-user",secret);
            String settings=new String(java.nio.file.Files.readAllBytes(new File(directory,"sync-state.json").toPath()),java.nio.charset.StandardCharsets.UTF_8);
            truth(!settings.contains(secret));truth(!settings.contains("native-test-secret"));truth(store.syncConfig().password().equals(secret));truth(!store.snapshot().contains(secret));truth(!store.nativeState().toString().contains(secret));
        });
        check("blank password keeps encrypted credential across settings saves",()->{
            String cipher=store.syncConfig().passwordCipher;store.saveWebDavConfig("https://example.com/dav/calendar.json","native-user","");truth(cipher.equals(store.syncConfig().passwordCipher));truth(store.syncConfig().password().equals(secret));
        });
        check("new destination resets acknowledgments and lastSync while retaining history",()->{
            store.merge(store.load(),true);truth(store.pending(store.load())==0&&store.lastSync()>0);String before=store.snapshot();store.saveWebDavConfig("https://example.com/dav/another.json","native-user",secret);truth(store.pending(store.load())==1&&store.lastSync()==0);truth(before.equals(store.snapshot()));
        });
        check("old in-flight destination cannot merge, acknowledge or replace status",()->{
            SyncConfig previous=store.syncConfig();String before=store.snapshot();store.saveLocalConfig("http://127.0.0.1:4317","local-test-token");String status=store.status();truth(!store.completeSync(previous,Arrays.asList(a,operation("old-target-operation"))));truth(!store.setStatus(previous,"stale success"));truth(before.equals(store.snapshot()));truth(store.pending(store.load())==1&&store.lastSync()==0&&store.status().equals(status));
        });
        check("current destination confirms only returned operations and preserves a concurrent edit",()->{
            SyncConfig current=store.syncConfig();Core.Op concurrent=operation("local-during-dav");store.merge(Collections.singletonList(concurrent),false);truth(store.completeSync(current,Collections.singletonList(a)));truth(store.pending(store.load())==1);truth(store.load().size()==2);
        });
        check("clearing DAV credentials preserves operations and disables selected DAV destination",()->{
            store.saveWebDavConfig("https://example.com/dav/calendar.json","native-user",secret);String before=store.snapshot();store.clearWebDavCredentials();truth(!store.syncConfig().configured());truth(store.syncConfig().passwordCipher.isEmpty());truth(before.equals(store.snapshot()));truth(store.lastSync()==0&&store.pending(store.load())==2);
        });
        // Configure test credentials through a private fixture-config file, never adb intent extras.
        String fixture=arguments==null?null:arguments.getString("fixtureConfig");
        if(fixture!=null){
            File configFile=new File(getTargetContext().getFilesDir(),fixture);String path=configFile.getCanonicalPath();truth(path.startsWith(getTargetContext().getFilesDir().getCanonicalPath()+File.separator));
            JSONObject config=new JSONObject(new String(java.nio.file.Files.readAllBytes(configFile.toPath()),java.nio.charset.StandardCharsets.UTF_8));
            check("external DAV fixture confirms Android JSON and native acknowledgment",()->{
                store.saveWebDavConfig(config.getString("url"),config.getString("username"),config.getString("password"));SyncConfig active=store.syncConfig();List<Core.Op> confirmed=active.transport().exchange(store.load());truth(store.completeSync(active,confirmed));truth(store.pending(store.load())==0&&store.lastSync()>0);truth(confirmed.stream().anyMatch(op->op.id.equals(a.id)));
                String exported=store.snapshot();truth(!exported.contains(config.getString("password")));result.putString("fixtureOperationId",a.id);result.putInt("fixtureOperationCount",confirmed.size());
            });
            truth(configFile.delete());
        }
        result.putString("stream",report+"WebDAV native checks passed: "+count+"\n");finish(-1,result);
    }catch(Throwable failure){result.putString("stream",report+"FAILED "+failure.getClass().getSimpleName()+"\n");finish(1,result);}}
}
