package app.flexible.calendar;

import android.app.job.*;
import android.content.*;
import android.os.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** One exchange per process; destination generations fence cross-process responses in Store. */
public final class SyncCoordinator {
    public static final String UPDATED="app.flexible.calendar.SYNC_UPDATED";
    static final int PERIODIC_JOB=4317, REFRESH_JOB=4318;
    private static final ExecutorService WORKER=Executors.newSingleThreadExecutor();
    private static final Object LOCK=new Object();
    public interface Completion {void complete(boolean success,boolean retryable);}
    private static final List<Completion> callbacks=new ArrayList<>();
    private static boolean running,rerun,cancelled;
    private static SyncTransport activeTransport;
    public static boolean isRunning(){synchronized(LOCK){return running;}}
    static boolean configured(Store store){try{return store.syncConfig().configured();}catch(Exception failure){return false;}}
    static void deliver(Runnable callback){if(callback!=null)new Handler(Looper.getMainLooper()).post(callback);}
    private static void announce(Context context){context.sendBroadcast(new Intent(UPDATED).setPackage(context.getPackageName()));}
    static String safeMessage(Exception error){
        if(error instanceof WebDavTransport.Failure||error instanceof HttpSyncTransport.HttpFailure)return error.getMessage();
        if(error instanceof InterruptedIOException&&!(error instanceof java.net.SocketTimeoutException))return "同步已暂停，离线修改已保留";
        if(error.getMessage()!=null&&error.getMessage().startsWith("无法读取已保存的 WebDAV 密码"))return "无法读取已保存的 WebDAV 密码，请在设置中重新输入";
        return "连接或数据校验未完成，请检查同步设置与网络；离线修改已保留";
    }
    private static boolean retryable(Exception error){return error instanceof IOException&&(!(error instanceof HttpSyncTransport.HttpFailure)||((HttpSyncTransport.HttpFailure)error).retryable)&&(!(error instanceof WebDavTransport.Failure)||((WebDavTransport.Failure)error).retryable);}
    public static void request(Context original,boolean manual,Runnable completed){requestWithResult(original,manual,completed==null?null:(success,retryable)->completed.run());}
    public static void requestWithResult(Context original,boolean manual,Completion completed){
        Context context=original.getApplicationContext();Store store=new Store(context);
        if(!configured(store)||(!manual&&!store.prefs.getBoolean("autoSync",true))){if(completed!=null)deliver(()->completed.complete(true,false));return;}
        synchronized(LOCK){if(completed!=null)callbacks.add(completed);cancelled=false;if(running){rerun=true;return;}running=true;}
        WORKER.execute(()->{
            List<Completion> listeners;boolean success=false,retry=false;
            while(true){
                synchronized(LOCK){rerun=false;}
                SyncConfig config=null;
                try{
                    config=store.syncConfig();
                    if(!config.configured()){success=false;retry=false;}
                    else {
                        SyncTransport transport=config.transport();
                        synchronized(LOCK){if(cancelled)throw new InterruptedIOException();activeTransport=transport;}
                        if(store.setStatus(config,"正在同步…")){announce(context);success=store.completeSync(config,transport.exchange(store.load()));retry=false;}
                        else {success=false;retry=false;}
                    }
                }catch(Exception failure){success=false;retry=retryable(failure);if(config!=null)try{store.setStatus(config,"同步失败："+safeMessage(failure));}catch(Exception ignored){}}
                finally{synchronized(LOCK){activeTransport=null;}}
                synchronized(LOCK){if(rerun&&!cancelled)continue;running=false;listeners=new ArrayList<>(callbacks);callbacks.clear();break;}
            }
            final boolean finalSuccess=success,finalRetry=retry;
            try{CalendarWidget.updateAll(context);}finally{announce(context);for(Completion listener:listeners)deliver(()->listener.complete(finalSuccess,finalRetry));}
        });
    }
    /** Saving settings cancels the old exchange; Store generation checks also cover other processes. */
    static void configurationChanged(Context context){
        boolean automatic=new Store(context).prefs.getBoolean("autoSync",true);
        SyncTransport transport;synchronized(LOCK){transport=activeTransport;if(running)rerun=automatic;}
        if(transport!=null)transport.cancel();ensureScheduled(context);announce(context);
    }
    public static void cancelBackgroundWork(){SyncTransport transport;synchronized(LOCK){cancelled=true;rerun=false;transport=activeTransport;}if(transport!=null)transport.cancel();}
    /** Used by isolated protocol tests; production exchanges always carry a destination generation. */
    static void exchange(Context context,SyncTransport transport) throws Exception {Store store=new Store(context);SyncConfig config=store.syncConfig();store.completeSync(config,transport.exchange(store.load()));}
    public static void ensureScheduled(Context context){
        Store store=new Store(context);JobScheduler jobs=(JobScheduler)context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if(!configured(store)||!store.prefs.getBoolean("autoSync",true)){jobs.cancel(PERIODIC_JOB);return;}
        if(jobs.getPendingJob(PERIODIC_JOB)==null)jobs.schedule(new JobInfo.Builder(PERIODIC_JOB,new ComponentName(context,SyncJobService.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(30*60*1000L).setBackoffCriteria(30_000,JobInfo.BACKOFF_POLICY_EXPONENTIAL).setPersisted(true).build());
    }
    public static void refreshFromWidget(Context context){
        Store store=new Store(context);if(!configured(store)){store.setStatus("请打开应用设置同步地址与凭据");CalendarWidget.updateAll(context);return;}
        PersistableBundle extras=new PersistableBundle();extras.putBoolean("manual",true);
        JobInfo info=new JobInfo.Builder(REFRESH_JOB,new ComponentName(context,SyncJobService.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(0).setBackoffCriteria(30_000,JobInfo.BACKOFF_POLICY_EXPONENTIAL).setExtras(extras).build();
        int result=((JobScheduler)context.getSystemService(Context.JOB_SCHEDULER_SERVICE)).schedule(info);
        store.setStatus(result==JobScheduler.RESULT_SUCCESS?"已请求刷新，等待网络与系统调度":"系统未接受刷新任务，请在应用内同步");CalendarWidget.updateAll(context);announce(context);
    }
}
