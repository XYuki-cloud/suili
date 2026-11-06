package app.flexible.calendar;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RemoteViews;
import android.widget.SeekBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Standard Android widget entry point; Xiaomi store integration is a separate build. */
final class WidgetSupport {
    static final String DATE_FONT_SP="dateFontSp",ITEM_FONT_SP="itemFontSp";
    private static final ExecutorService WIDGET_UPDATES=Executors.newSingleThreadExecutor();
    private final Activity activity;
    private AlertDialog panel;
    private TextView diagnostics;
    private final SharedPreferences.OnSharedPreferenceChangeListener changes;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final Runnable redraw=this::flushAppearance;
    private boolean appearancePending;
    WidgetSupport(Activity activity){this.activity=activity;changes=(prefs,key)->{if(!DATE_FONT_SP.equals(key)&&!ITEM_FONT_SP.equals(key))activity.runOnUiThread(this::refresh);};}
    static SharedPreferences preferences(Context context){return context.getSharedPreferences("widget_support",Context.MODE_PRIVATE);}
    static int dateFontSize(Context context){return fontSize(context,DATE_FONT_SP,9);}
    static int itemFontSize(Context context){return fontSize(context,ITEM_FONT_SP,8);}
    private static int fontSize(Context context,String key,int fallback){
        // The scheduled widget refresh also runs in :widgetProvider. Re-check its cached file.
        try{return WidgetLayoutPolicy.clampFontSize(context.getSharedPreferences("widget_support",Context.MODE_MULTI_PROCESS).getInt(key,fallback));}catch(ClassCastException ignored){return fallback;}
    }
    private ComponentName provider(){return new ComponentName(activity,CalendarWidget.class);}
    private AppWidgetManager manager(){return AppWidgetManager.getInstance(activity);}
    private int dp(int value){return Math.round(value*activity.getResources().getDisplayMetrics().density);}
    void show(){
        if(panel!=null&&panel.isShowing()){refresh();return;}
        LinearLayout body=new LinearLayout(activity);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(dp(22),dp(8),dp(22),dp(14));
        TextView intro=new TextView(activity);intro.setText("默认约 4×3，添加后长按小部件边框可调整宽度和高度；实际网格由桌面决定。下方可核对系统添加与绑定状态。");intro.setTextSize(14);body.addView(intro);
        addFontSlider(body,"日期字号",DATE_FONT_SP,dateFontSize(activity));
        addFontSlider(body,"事项字号",ITEM_FONT_SP,itemFontSize(activity));
        TextView fontHint=new TextView(activity);fontHint.setText("仅调整全部桌面小部件，拖动后自动保存并刷新。小尺寸先隐藏周栏和底栏，尽量保留事项；日期字号过大时自动缩小，正文仍放不下时以圆点提示。");fontHint.setTextSize(12);fontHint.setPadding(0,0,0,dp(10));body.addView(fontHint);
        addButton(body,"添加普通桌面小部件",this::requestPin);
        addButton(body,"查看系统添加方法",this::showInstructions);
        addButton(body,"刷新绑定与小部件",()->{CalendarWidget.updateAll(activity);refresh();});
        diagnostics=new TextView(activity);diagnostics.setTextSize(12);diagnostics.setTextIsSelectable(true);diagnostics.setPadding(0,dp(12),0,dp(8));body.addView(diagnostics);
        ScrollView scroll=new ScrollView(activity);scroll.addView(body);
        panel=new AlertDialog.Builder(activity).setTitle("桌面小部件").setView(scroll).setPositiveButton("关闭",null).create();
        panel.setOnDismissListener(ignored->{flushAppearance();preferences(activity).unregisterOnSharedPreferenceChangeListener(changes);panel=null;diagnostics=null;});
        preferences(activity).registerOnSharedPreferenceChangeListener(changes);panel.show();refresh();
    }
    private void addButton(LinearLayout parent,String label,Runnable action){Button button=new Button(activity);button.setText(label);button.setAllCaps(false);button.setOnClickListener(ignored->action.run());parent.addView(button,new LinearLayout.LayoutParams(-1,-2));}
    private void addFontSlider(LinearLayout parent,String label,String key,int value){
        TextView current=new TextView(activity);current.setText(label+"："+value+" sp");current.setTextSize(13);current.setPadding(0,dp(10),0,0);parent.addView(current);
        SeekBar slider=new SeekBar(activity);slider.setMax(8);slider.setProgress(value-6);slider.setContentDescription(label+"，当前 "+value+" sp，范围 6 到 14 sp");
        slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){
            @Override public void onProgressChanged(SeekBar bar,int progress,boolean fromUser){if(!fromUser)return;int size=WidgetLayoutPolicy.clampFontSize(progress+6);preferences(activity).edit().putInt(key,size).apply();current.setText(label+"："+size+" sp");bar.setContentDescription(label+"，当前 "+size+" sp，范围 6 到 14 sp");appearancePending=true;handler.removeCallbacks(redraw);handler.postDelayed(redraw,150);}
            @Override public void onStartTrackingTouch(SeekBar bar){}
            @Override public void onStopTrackingTouch(SeekBar bar){flushAppearance();}
        });parent.addView(slider,new LinearLayout.LayoutParams(-1,dp(44)));
    }
    private void flushAppearance(){
        handler.removeCallbacks(redraw);if(!appearancePending)return;appearancePending=false;
        Context app=activity.getApplicationContext();
        WIDGET_UPDATES.execute(()->{try{CalendarWidget.updateAll(app);}catch(RuntimeException ignored){activity.runOnUiThread(()->{if(!activity.isFinishing())Toast.makeText(activity,"字号已保存，刷新未完成；可稍后点刷新重试",Toast.LENGTH_LONG).show();});}});
    }
    void refresh(){
        if(diagnostics==null)return;
        try{
            AppWidgetManager manager=manager();List<AppWidgetProviderInfo> providers=manager.getInstalledProvidersForPackage(activity.getPackageName(),null);
            boolean installed=false;for(AppWidgetProviderInfo info:providers)if(provider().equals(info.provider))installed=true;
            int[] ids=manager.getAppWidgetIds(provider());SharedPreferences prefs=preferences(activity);
            String text="普通组件注册："+(installed?"系统已识别":"系统未识别")+"\n本应用系统可见 Provider："+providers.size()+" 个\n桌面应用内添加："+(manager.isRequestPinAppWidgetSupported()?"支持":"不支持")+"\n当前普通组件绑定："+ids.length+" 个"+(ids.length==0?"":"，ID "+Arrays.toString(ids))+"\n\n"+WidgetPinStatus.message(prefs.getString("requestState",""),prefs.getInt("callbackId",AppWidgetManager.INVALID_APPWIDGET_ID),ids)+"\n\n当前桌面："+launcher()+"\n系统："+Build.MANUFACTURER+" / Android "+Build.VERSION.RELEASE+"（API "+Build.VERSION.SDK_INT+"）\n系统版本："+Build.DISPLAY+"\n版本增量："+Build.VERSION.INCREMENTAL+"\n\n这些信息只显示在本机，未包含事项、同步地址或凭据。绑定 ID 不能证明桌面画面已正常渲染。\n\n小米小部件中心／负一屏需要平台支持与审核；普通版未接入已审核的小米组件。请先使用“安卓小部件”入口。";
            diagnostics.setText(text);
        }catch(RuntimeException error){diagnostics.setText("系统暂未返回组件状态。请使用“查看系统添加方法”手动添加；可稍后刷新重试。");}
    }
    private String launcher(){
        Intent home=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        ResolveInfo resolved=activity.getPackageManager().resolveActivity(home,PackageManager.MATCH_DEFAULT_ONLY);
        if(resolved==null||resolved.activityInfo==null||"android".equals(resolved.activityInfo.packageName))return "未查询到已选定的默认桌面";
        return resolved.loadLabel(activity.getPackageManager())+"（"+resolved.activityInfo.packageName+"）";
    }
    private void requestPin(){
        SharedPreferences prefs=preferences(activity);
        try{
            AppWidgetManager manager=manager();
            if(!manager.isRequestPinAppWidgetSupported()){prefs.edit().putString("requestState","unsupported").putInt("callbackId",AppWidgetManager.INVALID_APPWIDGET_ID).apply();refresh();showInstructions();return;}
            Bundle extras=new Bundle();extras.putParcelable(AppWidgetManager.EXTRA_APPWIDGET_PREVIEW,new RemoteViews(activity.getPackageName(),R.layout.widget_preview));
            int request=(int)(System.nanoTime()&0x7fffffff);
            Intent callback=new Intent(activity,WidgetPinReceiver.class).setAction(WidgetPinReceiver.ACTION).setData(Uri.parse("suili://widget-pin/"+request));
            // The launcher fills EXTRA_APPWIDGET_ID into this explicit, private callback.
            int flags=PendingIntent.FLAG_ONE_SHOT|PendingIntent.FLAG_UPDATE_CURRENT;
            if(Build.VERSION.SDK_INT>=31)flags|=PendingIntent.FLAG_MUTABLE;
            PendingIntent success=PendingIntent.getBroadcast(activity,request,callback,flags);
            prefs.edit().putString("requestState","requested").putInt("callbackId",AppWidgetManager.INVALID_APPWIDGET_ID).apply();
            if(!manager.requestPinAppWidget(provider(),extras,success)){success.cancel();prefs.edit().putString("requestState","rejected").apply();}
            refresh();
        }catch(RuntimeException error){prefs.edit().putString("requestState","error").apply();refresh();}
    }
    private void showInstructions(){
        new AlertDialog.Builder(activity).setTitle("系统添加方法").setMessage("小米澎湃／MIUI：\n1. 返回桌面，在空白处双指捏合，选择“添加小部件”。\n2. 打开搜索，找到“安卓小部件”入口。不同桌面版本也可能在“全部”或页面底部。\n3. 找到“随历 · 月历与四周”，长按拖到有足够空位的桌面。\n4. 返回随历点“刷新绑定与小部件”核对系统绑定。\n\n其他桌面：长按桌面空白处 → 小部件 → 随历。默认约 4×3，添加后长按边框调整宽高；具体网格由桌面决定。\n\n若系统应用锁限制添加，请检查随历的应用锁状态。没有系统确认回调不会被当作添加成功。\n\n小米小部件中心搜索结果和“安卓小部件”列表是不同入口。负一屏组件需按小米流程审核，侧载 APK 不能保证进入该列表。")
            .setNeutralButton("返回桌面",(dialog,which)->{
                Intent home=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if(home.resolveActivity(activity.getPackageManager())!=null)try{activity.startActivity(home);}catch(RuntimeException ignored){/* The user can still return home using system navigation. */}
            }).setPositiveButton("知道了",null).show();
    }
}
