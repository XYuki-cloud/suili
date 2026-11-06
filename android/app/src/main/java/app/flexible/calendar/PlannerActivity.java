package app.flexible.calendar;

import android.app.*;
import android.appwidget.AppWidgetManager;
import android.content.*;
import android.content.pm.ApplicationInfo;
import android.os.*;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Offline shared planner with a fixed local HTTPS origin and native durable storage. */
public final class PlannerActivity extends Activity {
    private static final int EXPORT=41,IMPORT=42;
    private static final String CSP="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
    private Store store;
    private WidgetSupport widgets;
    private WebView web;
    private boolean pageReady,registered;
    private volatile boolean active=true;
    private volatile String launchTarget="{}";
    private String pendingImport;
    private final ExecutorService documents=Executors.newSingleThreadExecutor();
    private final BroadcastReceiver updates=new BroadcastReceiver(){@Override public void onReceive(Context c,Intent i){emitUpdate();}};

    @Override public void onCreate(Bundle state){
        super.onCreate(state);store=new Store(this);widgets=new WidgetSupport(this);readIntent();
        FrameLayout container=new FrameLayout(this);container.setTag("planner_container");container.setBackgroundColor(0xfff4f6f2);
        container.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
        web=new WebView(this);web.setTag("planner_web");web.setBackgroundColor(0xfff4f6f2);
        container.addView(web,new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(container);container.requestApplyInsets();
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setBlockNetworkLoads(true);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setSupportMultipleWindows(false);settings.setGeolocationEnabled(false);settings.setSafeBrowsingEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        if((getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)!=0)WebView.setWebContentsDebuggingEnabled(true);
        web.addJavascriptInterface(new NativeBridge(),"SuiliNative");
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return resource(request.getUrl().toString(),request.getMethod());}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,String url){return resource(url,"GET");}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !request.isForMainFrame()||!PlannerAssets.isMainDocument(request.getUrl().toString());}
            @Override public boolean shouldOverrideUrlLoading(WebView view,String url){return !PlannerAssets.isMainDocument(url);}
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){pageReady=false;}
            @Override public void onPageFinished(WebView view,String url){if(PlannerAssets.isMainDocument(url)){pageReady=true;emitUpdate();dispatchImport();}}
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){pageReady=false;view.removeJavascriptInterface("SuiliNative");view.destroy();web=null;TextView message=new TextView(PlannerActivity.this);message.setText("规划界面已停止，已保存的事项仍在。请关闭后重新打开随历。");message.setPadding(32,64,32,32);setContentView(message);return true;}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onPermissionRequest(PermissionRequest request){request.deny();}
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result){new AlertDialog.Builder(PlannerActivity.this).setMessage(message).setPositiveButton("知道了",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();return true;}
            @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result){new AlertDialog.Builder(PlannerActivity.this).setMessage(message).setPositiveButton("确认",(d,w)->result.confirm()).setNegativeButton("取消",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;}
        });
        web.setDownloadListener((url,agent,disposition,mime,size)->Toast.makeText(this,"请使用备份中的导出按钮保存文件",Toast.LENGTH_LONG).show());
        web.loadUrl(PlannerAssets.HOME);
    }

    private WebResourceResponse resource(String url,String method){
        String asset="GET".equals(method)?PlannerAssets.assetPath(url):null;
        if(asset==null)return response("text/plain",403,"Forbidden",new ByteArrayInputStream(new byte[0]));
        try{String mime=asset.endsWith(".html")?"text/html":asset.endsWith(".css")?"text/css":"text/javascript";return response(mime,200,"OK",getAssets().open(asset));}
        catch(IOException e){return response("text/plain",404,"Not Found",new ByteArrayInputStream("离线界面资源缺失".getBytes(StandardCharsets.UTF_8)));}
    }
    private WebResourceResponse response(String mime,int code,String reason,InputStream body){
        Map<String,String> headers=new HashMap<>();headers.put("Content-Security-Policy",CSP);headers.put("X-Content-Type-Options","nosniff");headers.put("Cache-Control","no-store");headers.put("Referrer-Policy","no-referrer");
        return new WebResourceResponse(mime,"UTF-8",code,reason,headers,body);
    }
    private void readIntent(){
        JSONObject target=new JSONObject();try{
            String date=getIntent().getStringExtra("date"),week=getIntent().getStringExtra("week"),filter=getIntent().getStringExtra("filter");
            target.put("date",date==null?JSONObject.NULL:Core.date(date).toString());target.put("week",week==null?JSONObject.NULL:Core.startOfWeek(week));
            target.put("filter",Arrays.asList("all","unplanned","replan").contains(filter)?filter:JSONObject.NULL);
        }catch(Exception ignored){}launchTarget=target.toString();
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);readIntent();emitUpdate();if(pageReady)evaluate("window.dispatchEvent(new CustomEvent('suili-native-navigate',{detail:"+launchTarget+"}));");}
    @Override protected void onResume(){super.onResume();active=true;if(Build.VERSION.SDK_INT>=33)registerReceiver(updates,new IntentFilter(SyncCoordinator.UPDATED),Context.RECEIVER_NOT_EXPORTED);else registerReceiver(updates,new IntentFilter(SyncCoordinator.UPDATED));registered=true;emitUpdate();widgets.refresh();SyncCoordinator.ensureScheduled(this);SyncCoordinator.request(this,false,null);}
    @Override protected void onPause(){if(registered){unregisterReceiver(updates);registered=false;}super.onPause();}
    @Override protected void onDestroy(){active=false;documents.shutdown();if(web!=null){web.removeJavascriptInterface("SuiliNative");web.destroy();web=null;}super.onDestroy();}
    private void evaluate(String javascript){if(web!=null&&pageReady&&!isFinishing())web.evaluateJavascript(javascript,null);}
    private void emitUpdate(){runOnUiThread(()->evaluate("window.dispatchEvent(new Event('suili-native-update'));"));}
    private void dispatchImport(){if(pageReady&&pendingImport!=null){String raw=pendingImport;pendingImport=null;evaluate("window.dispatchEvent(new CustomEvent('suili-native-import',{detail:"+JSONObject.quote(raw)+"}));");}}
    private String envelope(JSONObject data) throws JSONException{return new JSONObject().put("ok",true).put("data",data).put("status",store.status()).put("syncing",SyncCoordinator.isRunning()).put("launchTarget",new JSONObject(launchTarget)).toString();}
    private static String failure(Exception error){try{return new JSONObject().put("ok",false).put("error",error.getMessage()==null?"操作未完成，已保存的事项仍保留":error.getMessage()).toString();}catch(JSONException impossible){return "{\"ok\":false,\"error\":\"操作未完成\"}";}}
    private void error(Exception error){if(active&&!isFinishing())new AlertDialog.Builder(this).setTitle("操作未完成").setMessage(error.getMessage()).setPositiveButton("知道了",null).show();}
    private void ui(Runnable action){runOnUiThread(()->{if(active&&!isFinishing())try{action.run();}catch(Exception e){error(e);}});}

    public final class NativeBridge {
        @JavascriptInterface public String readState(){try{if(!active)throw new IllegalStateException("界面已关闭");return envelope(store.nativeState());}catch(Exception e){return failure(e);}}
        @JavascriptInterface public String saveSnapshot(String snapshot,String expectedHeads){try{if(!active)throw new IllegalStateException("界面已关闭");return envelope(store.saveNativeSnapshot(snapshot,expectedHeads));}catch(Exception e){return failure(e);}}
        @JavascriptInterface public void requestSync(boolean interactive){ui(()->{if(!SyncCoordinator.configured(store)){if(interactive)openSettings();}else SyncCoordinator.request(PlannerActivity.this,interactive,null);});}
        @JavascriptInterface public void openSettings(){ui(()->startActivity(new Intent(PlannerActivity.this,MainActivity.class).putExtra("openSettings",true)));}
        @JavascriptInterface public void pinWidget(){ui(widgets::show);}
        @JavascriptInterface public void exportBackup(){ui(()->startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,"随历-"+LocalDate.now()+".json"),EXPORT));}
        @JavascriptInterface public void chooseImport(){ui(()->startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE),IMPORT));}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);if(result!=RESULT_OK||data==null||data.getData()==null||(request!=EXPORT&&request!=IMPORT))return;
        final android.net.Uri uri=data.getData();documents.execute(()->{try{
            if(request==EXPORT){byte[] snapshot=store.snapshot().getBytes(StandardCharsets.UTF_8);try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException("无法打开导出文件");out.write(snapshot);out.flush();}ui(()->Toast.makeText(this,"已导出操作历史，未包含配对令牌",Toast.LENGTH_LONG).show());}
            else{String raw;try(InputStream in=getContentResolver().openInputStream(uri);ByteArrayOutputStream out=new ByteArrayOutputStream()){if(in==null)throw new IOException("无法读取备份文件");byte[] bytes=new byte[8192];int count;while((count=in.read(bytes))!=-1){out.write(bytes,0,count);if(out.size()>10*1024*1024)throw new IOException("文件超过 10 MB");}raw=out.toString(StandardCharsets.UTF_8.name());}ui(()->{pendingImport=raw;dispatchImport();});}
        }catch(Exception e){ui(()->error(e));}});
    }
}
