package app.flexible.calendar;

import android.app.Activity;
import android.app.Instrumentation;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.RemoteViews;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/** Real AppWidgetHost/RemoteViews rendering in an explicitly selected disposable emulator.
 * Run with -e grantBind true only in that emulator: the temporary bind grant is revoked.
 * All fixtures and widget preferences use a private cache namespace, never the user's Store.
 */
public final class WidgetRenderInstrumentation extends Instrumentation {
    private interface Checked { void run() throws Exception; }
    private Bundle arguments;
    private File output;
    private final JSONArray cases=new JSONArray();
    private final List<String> failures=new ArrayList<>();
    private final List<String> preferenceNames=new ArrayList<>();
    private Context target;
    private String namespace;
    private int completed;
    private int deletedIdChecks;

    @Override public void onCreate(Bundle args){super.onCreate(args);arguments=args==null?new Bundle():args;start();}

    private void main(Checked action) throws Exception {
        AtomicReference<Throwable> error=new AtomicReference<>();
        runOnMainSync(()->{try{action.run();}catch(Throwable failure){error.set(failure);}});
        if(error.get()!=null)throw new AssertionError(error.get());
    }

    private static void require(boolean value,String message){if(!value)throw new AssertionError(message);}

    private static byte[] existing(File file) throws Exception {return file.exists()?Files.readAllBytes(file.toPath()):null;}

    private void bindPermission(String operation) throws Exception {
        String name=target.getPackageName();
        require(name.matches("[A-Za-z0-9_.]+"),"Unexpected test package name");
        // The caller explicitly opts in on a disposable user-0 emulator; never alter a phone grant.
        require(android.os.Process.myUid()<100000,"Widget render test requires emulator user 0");
        ParcelFileDescriptor descriptor=getUiAutomation().executeShellCommand("appwidget "+operation+" --package "+name+" --user 0");
        try(ParcelFileDescriptor.AutoCloseInputStream stream=new ParcelFileDescriptor.AutoCloseInputStream(descriptor)){
            byte[] bytes=new byte[4096];while(stream.read(bytes)!=-1){/* No command output contains test data. */}
        }
    }

    private final class IsolatedContext extends ContextWrapper {
        IsolatedContext(float fontScale){super(configured(fontScale));}
        @Override public Context getApplicationContext(){return this;}
        @Override public File getFilesDir(){return new File(output,"fixtures");}
        @Override public SharedPreferences getSharedPreferences(String name,int mode){
            String key=namespace+"_"+name;
            if(!preferenceNames.contains(key))preferenceNames.add(key);
            return target.getSharedPreferences(key,mode);
        }
        @Override public Object getSystemService(String name){
            Object service=super.getSystemService(name);
            return LAYOUT_INFLATER_SERVICE.equals(name)?((LayoutInflater)service).cloneInContext(this):service;
        }
        // ContextWrapper has this public method at runtime, but it is absent from public SDK stubs.
        // Keep the runtime signature without referencing that hidden method at a call site.
        public Context createApplicationContext(ApplicationInfo info,int flags) throws PackageManager.NameNotFoundException {
            return target.getPackageName().equals(info.packageName)?this:target.createPackageContext(info.packageName,flags);
        }
        @Override public Context createPackageContext(String name,int flags) throws PackageManager.NameNotFoundException {
            return target.getPackageName().equals(name)?this:super.createPackageContext(name,flags);
        }
    }

    private Context configured(float scale){Configuration config=new Configuration(target.getResources().getConfiguration());config.fontScale=scale;return target.createConfigurationContext(config);}

    private static final class RecordingView extends AppWidgetHostView {
        boolean failed,hasRemoteViews;
        RecordingView(Context context){super(context);}
        @Override public void updateAppWidget(RemoteViews views){if(views!=null){failed=false;hasRemoteViews=true;}super.updateAppWidget(views);}
        @Override protected View getErrorView(){failed=true;return super.getErrorView();}
    }

    private static final class RecordingHost extends AppWidgetHost {
        RecordingHost(Context context,int hostId){super(context,hostId);}
        @Override protected AppWidgetHostView onCreateView(Context context,int id,AppWidgetProviderInfo info){return new RecordingView(context);}
    }

    private void fixture() throws Exception {
        File directory=new File(output,"fixtures");require(directory.mkdir(),"Cannot create isolated fixture directory");
        Core.Task range=new Core.Task(UUID.randomUUID().toString(),"数值分析课程作业");range.kind="range";range.start="2026-11-12";range.end="2026-11-15";range.deadline="2026-11-20";
        Core.Task week=new Core.Task(UUID.randomUUID().toString(),"整理阅读笔记");week.kind="week";week.start="2026-11-09";week.end="2026-11-15";
        Core.Task day=new Core.Task(UUID.randomUUID().toString(),"电路实验");day.kind="day";day.start=day.end="2026-11-14";
        List<Core.Op> operations=new ArrayList<>();for(Core.Task task:Arrays.asList(range,week,day))operations.add(new Core.Op(UUID.randomUUID().toString(),task,new ArrayList<>(),"widget-render-test","2026-10-28T00:00:00.000Z"));
        try(FileOutputStream stream=new FileOutputStream(new File(directory,"operations.json"))){stream.write(JsonCodec.encode(operations).getBytes(StandardCharsets.UTF_8));}
    }

    private static boolean visible(View view){for(View current=view;current!=null;current=current.getParent() instanceof View?(View)current.getParent():null)if(current.getVisibility()!=View.VISIBLE)return false;return true;}

    private static void collect(View view,List<TextView> text){if(view instanceof TextView)text.add((TextView)view);if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)collect(group.getChildAt(i),text);}}

    private JSONObject inspect(RecordingView view,Context context,String name) throws Exception {
        List<TextView> all=new ArrayList<>();collect(view,all);JSONArray measurements=new JSONArray();JSONArray issues=new JSONArray();int dates=0,itemLabels=0;
        require(view.hasRemoteViews&&!view.failed,"RemoteViews did not inflate successfully");
        TextView title=view.findViewById(R.id.widget_title);require(title!=null&&title.getText().toString().contains("2026年 11月"),"Isolated six-week November fixture was not rendered");
        for(TextView text:all){
            if(!visible(text))continue;
            String id;try{id=context.getResources().getResourceEntryName(text.getId());}catch(Exception ignored){id="unknown";}
            int available=text.getHeight()-text.getCompoundPaddingTop()-text.getCompoundPaddingBottom();
            int lines=text.getLayout()==null?0:text.getLayout().getLineCount();
            int needed=text.getLayout()==null?0:text.getLayout().getHeight();
            measurements.put(new JSONObject().put("id",id).put("text",text.getText().toString()).put("heightPx",text.getHeight()).put("contentHeightPx",available).put("layoutHeightPx",needed).put("lineCount",lines).put("textSizePx",text.getTextSize()).put("resourceFontScale",text.getResources().getConfiguration().fontScale));
            if((text.getId()==R.id.day_items||text.getId()==R.id.range_bar)&&!text.getText().toString().isEmpty()&&available>0&&needed>0)itemLabels++;
            boolean date=text.getId()==R.id.day_number;
            boolean cjk=text.getId()==R.id.day_items||text.getId()==R.id.day_overflow||text.getId()==R.id.range_bar||text.getId()==R.id.range_overflow||text.getId()==R.id.week_plan||text.getId()==R.id.widget_title||text.getId()==R.id.widget_footer||text.getId()==R.id.mode||text.getText().toString().matches("[一二三四五六日]");
            if(date||cjk&&!text.getText().toString().trim().isEmpty()){
                if(available<=0||lines<1||needed>available)issues.put(id+" "+text.getText()+" clips: needs "+needed+"px, available "+available+"px, lines="+lines);
                for(View child=text;child.getParent() instanceof View;child=(View)child.getParent()){
                    View parent=(View)child.getParent();
                    if(child.getTop()<0||child.getBottom()>parent.getHeight())issues.put(id+" "+text.getText()+" exceeds ancestor "+parent.getClass().getSimpleName());
                    if(parent==view)break;
                }
            }
            if(date){
                dates++;
                if(Math.abs(text.getResources().getConfiguration().fontScale-context.getResources().getConfiguration().fontScale)>.01f)issues.put("Date resources did not use the requested test font scale");
                if(lines!=1)issues.put("Date "+text.getText()+" is not a single line");
            }
        }
        if(dates!=42)issues.put("Expected 42 visible six-week dates, got "+dates);
        Bitmap bitmap=Bitmap.createBitmap(view.getWidth(),view.getHeight(),Bitmap.Config.ARGB_8888);view.draw(new Canvas(bitmap));
        try(FileOutputStream stream=new FileOutputStream(new File(output,name+".png"))){require(bitmap.compress(Bitmap.CompressFormat.PNG,100,stream),"Cannot save render PNG");}finally{bitmap.recycle();}
        return new JSONObject().put("visibleDates",dates).put("visibleItemLabels",itemLabels).put("issues",issues).put("textViews",measurements);
    }

    private void renderCase(int width,int height,int font,float scale,int index) throws Exception {
        String name=String.format(java.util.Locale.ROOT,"case-%02d-%dx%d-font%d-scale%.1f",index,width,height,font,scale);
        JSONObject record=new JSONObject().put("name",name).put("widthDp",width).put("heightDp",height).put("dateFontSp",font).put("itemFontSp",font).put("fontScale",scale);
        cases.put(record);IsolatedContext isolated=new IsolatedContext(scale);AppWidgetManager manager=AppWidgetManager.getInstance(isolated);
        AtomicReference<RecordingHost> host=new AtomicReference<>();AtomicReference<RecordingView> view=new AtomicReference<>();int id=AppWidgetManager.INVALID_APPWIDGET_ID;
        try{
            main(()->host.set(new RecordingHost(isolated,0x40000000|((int)System.nanoTime()&0x3fffffff))));
            id=host.get().allocateAppWidgetId();final int widgetId=id;
            SharedPreferences widgets=isolated.getSharedPreferences("widgets",Context.MODE_PRIVATE);
            require(widgets.edit().putString(id+"_mode","month").putString(id+"_base","2026-11-01").commit(),"Cannot save isolated widget layout");
            SharedPreferences prefs=isolated.getSharedPreferences("widget_support",Context.MODE_PRIVATE);
            require(prefs.edit().putInt("dateFontSp",font).putInt("itemFontSp",font).commit(),"Cannot save isolated font preference");
            Bundle options=new Bundle();options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,width);options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,width);options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,height);options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,height);options.putInt(AppWidgetManager.OPTION_APPWIDGET_HOST_CATEGORY,AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN);
            require(manager.bindAppWidgetIdIfAllowed(id,new ComponentName(target,CalendarWidget.class),options),"Widget bind permission missing; use -e grantBind true only on disposable emulator");
            // Allow the framework's initial provider broadcast to settle before the isolated render.
            waitForIdleSync();
            JSONObject[] measurement=new JSONObject[1];
            main(()->{
                // Keep render, synchronous host inflation and measurement in one main-thread turn:
                // a framework initial-update broadcast must not replace our isolated fixture between them.
                CalendarWidget.render(isolated,manager,widgetId);view.set((RecordingView)host.get().createView(isolated,widgetId,manager.getAppWidgetInfo(widgetId)));host.get().startListening();
                // This is the provider's content rectangle; launcher margins/grid snapping are outside this test.
                RecordingView actual=view.get();actual.setPadding(0,0,0,0);
                int widthPx=Math.round(width*isolated.getResources().getDisplayMetrics().density),heightPx=Math.round(height*isolated.getResources().getDisplayMetrics().density);
                actual.measure(View.MeasureSpec.makeMeasureSpec(widthPx,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(heightPx,View.MeasureSpec.EXACTLY));actual.layout(0,0,widthPx,heightPx);
                measurement[0]=inspect(actual,isolated,name);
            });
            record.put("render",measurement[0]);
            require(prefs.getInt("dateFontSp",-1)==font&&prefs.getInt("itemFontSp",-1)==font,"Fit changed the saved font preference");
            require(measurement[0].getJSONArray("issues").length()==0,measurement[0].getJSONArray("issues").toString());
            if(font==6&&scale==1f&&height>=230)require(measurement[0].getInt("visibleItemLabels")>0,"Small font has space but no task text is shown");
            record.put("passed",true);completed++;
        }catch(Throwable error){record.put("passed",false).put("failure",error.getClass().getSimpleName()+": "+error.getMessage());failures.add(name+": "+error.getMessage());}
        finally{
            final int widgetId=id;
            if(host.get()!=null){
                main(()->{
                    host.get().stopListening();
                    try{
                        if(widgetId!=AppWidgetManager.INVALID_APPWIDGET_ID){
                            host.get().deleteAppWidgetId(widgetId);
                            require(manager.getAppWidgetInfo(widgetId)==null,"Deleted test ID is still bound");
                            // Exercise a delayed provider update after a real system deletion. Do not
                            // hide the production race by retaining hosts until all renders finish.
                            CalendarWidget.render(isolated,manager,widgetId);
                            new CalendarWidget().onUpdate(isolated,manager,new int[]{widgetId});
                            require(CalendarWidget.command(isolated,widgetId,"next")==null,"Deleted ID retained a command PendingIntent");
                            require(manager.getAppWidgetInfo(widgetId)==null,"Deleted-ID refresh recreated a binding");
                            deletedIdChecks++;
                        }
                    }finally{host.get().deleteHost();}
                });
                // Drain initial/update/delete broadcasts before the next independent case; a stale
                // queued broadcast still runs and must be safe, rather than crossing test cases.
                waitForIdleSync();
            }
        }
    }

    @Override public void onStart(){
        Bundle result=new Bundle();boolean granted=false;byte[] originalOperations=null,originalState=null;File operations=null,state=null;
        try{
            require(android.os.Build.HARDWARE.contains("ranchu")||android.os.Build.HARDWARE.contains("goldfish"),"Use this test only on the disposable Android emulator");
            target=getTargetContext();namespace="widget_render_"+UUID.randomUUID().toString().replace("-","");output=new File(target.getCacheDir(),namespace);require(output.mkdir(),"Cannot create widget render output directory");fixture();
            operations=new File(target.getFilesDir(),"operations.json");state=new File(target.getFilesDir(),"sync-state.json");originalOperations=existing(operations);originalState=existing(state);
            if("true".equals(arguments.getString("grantBind"))){bindPermission("grantbind");granted=true;}
            int index=0;for(int[] size:new int[][]{{210,160},{250,180},{250,230},{250,300},{250,400},{350,500}})for(int font:new int[]{6,14})for(float scale:new float[]{1f,2f})renderCase(size[0],size[1],font,scale,++index);
            require(Arrays.equals(originalOperations,existing(operations))&&Arrays.equals(originalState,existing(state)),"Target Store bytes changed during isolated rendering");
        }catch(Throwable error){failures.add(error.getClass().getSimpleName()+": "+error.getMessage());}
        finally{
            if(granted)try{bindPermission("revokebind");}catch(Exception error){failures.add("Cannot revoke temporary widget bind permission: "+error.getClass().getSimpleName());}
            if(target!=null)for(String name:preferenceNames)target.deleteSharedPreferences(name);
            try{if(output!=null){JSONObject summary=new JSONObject().put("passed",failures.isEmpty()).put("completed",completed).put("deletedIdChecks",deletedIdChecks).put("cases",cases).put("failures",new JSONArray(failures)).put("scope","Real Android host binding, RemoteViews inflation and offscreen provider content rendering. No launcher grid, Xiaomi picker or negative-screen acceptance.");try(FileOutputStream stream=new FileOutputStream(new File(output,"report.json"))){stream.write(summary.toString(2).getBytes(StandardCharsets.UTF_8));}result.putString("artifactDirectory",output.getAbsolutePath());}}
            catch(Exception error){failures.add("Cannot save render report: "+error.getClass().getSimpleName());}
            result.putInt("passed",completed);result.putInt("deletedIdChecks",deletedIdChecks);result.putInt("failed",failures.size());result.putString("summary",failures.isEmpty()?"All widget render cases passed":failures.get(0));finish(failures.isEmpty()?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
        }
    }
}
