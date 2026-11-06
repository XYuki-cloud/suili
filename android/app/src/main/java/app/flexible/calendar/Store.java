package app.flexible.calendar;

import android.content.*;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.util.*;
import org.json.*;

/** One lock protects read/merge/atomic write, including UI edits during a sync request. */
public final class Store {
    private static final Object LOCK=new Object();
    private final AtomicFile file;
    private final AtomicFile stateFile;
    private final File lockFile;
    final SharedPreferences prefs;
    private final Context context;
    public Store(Context context){this.context=context.getApplicationContext();file=new AtomicFile(new File(context.getFilesDir(),"operations.json"));stateFile=new AtomicFile(new File(context.getFilesDir(),"sync-state.json"));lockFile=new File(context.getFilesDir(),"operations.lock");prefs=context.getSharedPreferences("private_settings",Context.MODE_MULTI_PROCESS);}
    private List<Core.Op> loadUnlocked() throws Exception {if(!file.getBaseFile().exists()&&!new File(file.getBaseFile()+".bak").exists())return new ArrayList<>();return JsonCodec.decode(new String(file.readFully(),StandardCharsets.UTF_8));}
    public List<Core.Op> load() throws Exception {synchronized(LOCK){try(RandomAccessFile f=new RandomAccessFile(lockFile,"rw");FileChannel channel=f.getChannel();FileLock ignored=channel.lock()){return loadUnlocked();}}}
    private void saveBytes(AtomicFile target,byte[] bytes) throws Exception {FileOutputStream output=null;try{output=target.startWrite();output.write(bytes);target.finishWrite(output);}catch(Exception e){if(output!=null)target.failWrite(output);throw e;}}
    private void save(List<Core.Op> ops) throws Exception {saveBytes(file,JsonCodec.encode(ops).getBytes(StandardCharsets.UTF_8));}
    private JSONObject stateUnlocked() throws Exception {if(!stateFile.getBaseFile().exists()&&!new File(stateFile.getBaseFile()+".bak").exists())return new JSONObject();return new JSONObject(new String(stateFile.readFully(),StandardCharsets.UTF_8));}
    private void saveState(JSONObject state) throws Exception {saveBytes(stateFile,state.toString().getBytes(StandardCharsets.UTF_8));}
    private JSONObject state() throws Exception {synchronized(LOCK){try(RandomAccessFile f=new RandomAccessFile(lockFile,"rw");FileChannel channel=f.getChannel();FileLock ignored=channel.lock()){return stateUnlocked();}}}
    private SyncConfig configUnlocked(JSONObject state) throws Exception {
        JSONObject settings=state.optJSONObject("syncConfig");
        if(settings==null)settings=new JSONObject().put("mode",SyncConfig.LOCAL).put("serverUrl",prefs.getString("serverUrl","")).put("token",prefs.getString("token",""));
        return SyncConfig.read(settings,state.optString("syncGeneration","legacy"));
    }
    SyncConfig syncConfig() throws Exception {synchronized(LOCK){try(RandomAccessFile f=new RandomAccessFile(lockFile,"rw");FileChannel channel=f.getChannel();FileLock ignored=channel.lock()){return configUnlocked(stateUnlocked());}}}
    private SyncConfig saveConfigUnlocked(JSONObject state,SyncConfig previous,SyncConfig next) throws Exception {
        if(previous.sameSettings(next))return previous;
        state.put("syncConfig",next.json());state.put("syncGeneration",UUID.randomUUID().toString());
        state.put("acknowledged",new JSONArray());state.put("lastSync",0);state.put("syncStatus",next.configured()?"同步设置已保存，全部历史等待确认":"同步凭据已清除，离线修改仍保留");
        saveState(state);return configUnlocked(state);
    }
    SyncConfig saveLocalConfig(String serverUrl,String token) throws Exception {
        String url=serverUrl.trim(),key=token.trim();new HttpSyncTransport(url,key);SyncConfig saved;
        synchronized(LOCK){try(RandomAccessFile f=new RandomAccessFile(lockFile,"rw");FileChannel channel=f.getChannel();FileLock ignored=channel.lock()){
            JSONObject state=stateUnlocked();SyncConfig old=configUnlocked(state);saved=saveConfigUnlocked(state,old,new SyncConfig(SyncConfig.LOCAL,url,key,old.fileUrl,old.username,old.passwordCipher,old.webdavEnabled,old.generation));
        }}refresh();SyncCoordinator.configurationChanged(context);return saved;
    }
    SyncConfig saveWebDavConfig(String fileUrl,String username,String password) throws Exception {
        String url=WebDavTransport.validateUrl(fileUrl),user=username.trim();SyncConfig saved;
        synchronized(LOCK){try(RandomAccessFile f=new RandomAccessFile(lockFile,"rw");FileChannel channel=f.getChannel();FileLock ignored=channel.lock()){
            JSONObject state=stateUnlocked();SyncConfig old=configUnlocked(state);String plain=webDavPasswordFor(old,url,user,password);
            new WebDavTransport(url,user,plain);String encrypted=plain.isEmpty()?"":password.isEmpty()?old.passwordCipher:PasswordVault.encrypt(password);
            saved=saveConfigUnlocked(state,old,new SyncConfig(SyncConfig.WEBDAV,old.serverUrl,old.token,url,user,encrypted,old.generation));
        }}refresh();SyncCoordinator.configurationChanged(context);return saved;
    }
    private static String webDavPasswordFor(SyncConfig saved,String url,String username,String entered) throws Exception {
        if(!entered.isEmpty()||username.isEmpty())return entered;
        if(!saved.fileUrl.equals(url)||!saved.username.equals(username))throw new IllegalArgumentException("修改 WebDAV 地址或用户名后，请重新输入密码");
        return saved.password();
    }
    String webDavPasswordFor(String url,String username,String entered) throws Exception {return webDavPasswordFor(syncConfig(),WebDavTransport.validateUrl(url),username,entered);}
    void clearWebDavCredentials() throws Exception {
        synchronized(LOCK){try(RandomAccessFile f=new RandomAccessFile(lockFile,"rw");FileChannel channel=f.getChannel();FileLock ignored=channel.lock()){
            JSONObject state=stateUnlocked();SyncConfig old=configUnlocked(state);saveConfigUnlocked(state,old,new SyncConfig(old.mode,old.serverUrl,old.token,old.fileUrl,"","",false,old.generation));
        }}refresh();SyncCoordinator.configurationChanged(context);
    }
    /** Configuration, status and acknowledgments share this lock in every Android process. */
    boolean setStatus(SyncConfig expected,String message) throws Exception {
        synchronized(LOCK){try(RandomAccessFile f=new RandomAccessFile(lockFile,"rw");FileChannel channel=f.getChannel();FileLock ignored=channel.lock()){
            JSONObject state=stateUnlocked();if(!configUnlocked(state).generation.equals(expected.generation))return false;state.put("syncStatus",message);saveState(state);return true;
        }}
    }
    boolean completeSync(SyncConfig expected,List<Core.Op> incoming) throws Exception {
        synchronized(LOCK){try(RandomAccessFile f=new RandomAccessFile(lockFile,"rw");FileChannel channel=f.getChannel();FileLock ignored=channel.lock()){
            JSONObject state=stateUnlocked();if(!configUnlocked(state).generation.equals(expected.generation))return false;
            List<Core.Op> merged=Core.merge(loadUnlocked(),incoming);save(merged);acknowledgeUnlocked(state,incoming);state.put("syncStatus","同步成功");saveState(state);
        }}refresh();return true;
    }
    private void acknowledgeUnlocked(JSONObject state,List<Core.Op> incoming) throws Exception {
        Set<String> ids=new HashSet<>();JSONArray old=state.optJSONArray("acknowledged");if(old!=null)for(int i=0;i<old.length();i++)ids.add(old.getString(i));for(Core.Op operation:incoming)ids.add(operation.id);
        state.put("acknowledged",new JSONArray(ids));state.put("lastSync",System.currentTimeMillis());
    }
    public long lastSync(){try{return state().optLong("lastSync",0);}catch(Exception e){return 0;}}
    public String status(){try{return state().optString("syncStatus","");}catch(Exception e){return "同步状态读取失败，事项数据仍保留";}}
    public void setStatus(String message){synchronized(LOCK){try(RandomAccessFile f=new RandomAccessFile(lockFile,"rw");FileChannel channel=f.getChannel();FileLock ignored=channel.lock()){JSONObject state=stateUnlocked();state.put("syncStatus",message);saveState(state);}catch(Exception e){android.util.Log.w("CalendarSync","Cannot save sync status: "+e.getClass().getSimpleName());}}}
    public Core.Op change(Core.Task task,List<String> expectedHeads) throws Exception {Core.Op op;synchronized(LOCK){try(RandomAccessFile f=new RandomAccessFile(lockFile,"rw");FileChannel channel=f.getChannel();FileLock ignored=channel.lock()){List<Core.Op> ops=loadUnlocked();Core.requireHeads(ops,task.id,expectedHeads);String device=prefs.getString("deviceId",null);if(device==null){device="android-"+UUID.randomUUID();prefs.edit().putString("deviceId",device).commit();}op=Core.makeOp(task,ops,device);save(Core.merge(ops,Collections.singletonList(op)));}}refresh();SyncCoordinator.request(context,false,null);return op;}
    public void merge(List<Core.Op> incoming,boolean acknowledged) throws Exception {synchronized(LOCK){try(RandomAccessFile f=new RandomAccessFile(lockFile,"rw");FileChannel channel=f.getChannel();FileLock ignored=channel.lock()){save(Core.merge(loadUnlocked(),incoming));if(acknowledged){JSONObject state=stateUnlocked();Set<String> ids=new HashSet<>();JSONArray old=state.optJSONArray("acknowledged");if(old!=null)for(int i=0;i<old.length();i++)ids.add(old.getString(i));for(Core.Op o:incoming)ids.add(o.id);state.put("acknowledged",new JSONArray(ids));state.put("lastSync",System.currentTimeMillis());saveState(state);}}}refresh();}
    public int pending(List<Core.Op> ops) throws Exception {Set<String> ack=new HashSet<>();JSONArray saved=state().optJSONArray("acknowledged");if(saved!=null)for(int i=0;i<saved.length();i++)ack.add(saved.getString(i));int n=0;for(Core.Op op:ops)if(!ack.contains(op.id))n++;return n;}
    private void refresh(){try{CalendarWidget.updateAll(context);}catch(RuntimeException e){android.util.Log.w("CalendarWidget","Refresh deferred: "+e.getClass().getSimpleName());}}
    public String snapshot() throws Exception {return JsonCodec.encode(load());}

    private String deviceUnlocked() throws IOException {
        String id=prefs.getString("deviceId",null);
        if(id==null){id="android-"+UUID.randomUUID();if(!prefs.edit().putString("deviceId",id).commit())throw new IOException("设备标识保存失败，事项尚未写入");}
        return id;
    }
    private JSONObject nativeStateUnlocked(List<Core.Op> operations) throws Exception {
        JSONObject data=new JSONObject(JsonCodec.encode(operations)),state=stateUnlocked();
        JSONArray acknowledged=state.optJSONArray("acknowledged");long last=state.optLong("lastSync",0);
        data.put("deviceId",deviceUnlocked());data.put("ackIds",acknowledged==null?new JSONArray():acknowledged);
        data.put("lastSync",last==0?JSONObject.NULL:java.time.Instant.ofEpochMilli(last).toString());return data;
    }
    /** The shared planner reads data and acknowledgment metadata under the same file lock. */
    public JSONObject nativeState() throws Exception {
        synchronized(LOCK){try(RandomAccessFile f=new RandomAccessFile(lockFile,"rw");FileChannel channel=f.getChannel();FileLock ignored=channel.lock()){
            return nativeStateUnlocked(loadUnlocked());
        }}
    }
    /** A complete JS snapshot is merged, never substituted. Null heads are reserved for backup merge. */
    public JSONObject saveNativeSnapshot(String raw,String expectedRaw) throws Exception {
        if(raw==null||raw.getBytes(StandardCharsets.UTF_8).length>10*1024*1024)throw new IllegalArgumentException("备份超过 10 MB 或内容为空");
        JSONObject snapshot=new JSONObject(raw);JsonCodec.keys(snapshot,"schemaVersion","operations");
        List<Core.Op> incoming=JsonCodec.decode(raw);
        Object expectedValue=new JSONTokener(expectedRaw).nextValue();
        if(expectedValue!=JSONObject.NULL&&!(expectedValue instanceof JSONObject))throw new IllegalArgumentException("缺少有效的事项版本检查");
        JSONObject expected=expectedValue==JSONObject.NULL?null:(JSONObject)expectedValue,result;
        synchronized(LOCK){try(RandomAccessFile f=new RandomAccessFile(lockFile,"rw");FileChannel channel=f.getChannel();FileLock ignored=channel.lock()){
            List<Core.Op> existing=loadUnlocked();Set<String> oldIds=new HashSet<>();for(Core.Op op:existing)oldIds.add(op.id);
            if(expected!=null){
                Set<String> changed=new HashSet<>();for(Core.Op op:incoming)if(!oldIds.contains(op.id))changed.add(op.taskId);
                for(String id:changed)if(!expected.has(id))throw new IllegalArgumentException("缺少事项的旧版本，未保存任何修改");
                Iterator<String> ids=expected.keys();while(ids.hasNext()){
                    String id=ids.next();JSONArray array=expected.getJSONArray(id);List<String> seen=new ArrayList<>();
                    for(int i=0;i<array.length();i++){Object value=array.get(i);if(!(value instanceof String)||!Core.nonempty((String)value))throw new IllegalArgumentException("旧版本 ID 无效");seen.add((String)value);}
                    if(new HashSet<>(seen).size()!=seen.size())throw new IllegalArgumentException("重复的旧版本 ID");Core.requireHeads(existing,id,seen);
                }
            }
            List<Core.Op> merged=Core.merge(existing,incoming);
            // Read metadata and ensure the device is durable before changing the operations file.
            result=nativeStateUnlocked(merged);save(merged);
        }}
        refresh();SyncCoordinator.request(context,false,null);return result;
    }
}
