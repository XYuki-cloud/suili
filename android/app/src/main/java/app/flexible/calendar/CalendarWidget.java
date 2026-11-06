package app.flexible.calendar;

import android.app.*;
import android.appwidget.*;
import android.content.*;
import android.os.Bundle;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.util.TypedValue;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.Layout;
import android.view.View;
import android.widget.RemoteViews;
import java.time.*;
import java.util.*;

/** Real AppWidget: every visible day and week has an offline detail deep link. */
public class CalendarWidget extends AppWidgetProvider {
    static final String ACTION="app.flexible.calendar.WIDGET_ACTION", MIDNIGHT="app.flexible.calendar.MIDNIGHT";
    @Override public void onUpdate(Context c,AppWidgetManager manager,int[] ids){for(int id:ids)render(c,manager,id);scheduleMidnight(c);}
    @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager manager,int id,Bundle options){render(c,manager,id);}
    @Override public void onReceive(Context c,Intent intent){super.onReceive(c,intent);String action=intent.getAction();if(ACTION.equals(action)){int id=intent.getIntExtra("widgetId",0);if(AppWidgetManager.getInstance(c).getAppWidgetInfo(id)==null)return;if("refresh".equals(intent.getStringExtra("verb"))){SyncCoordinator.refreshFromWidget(c);return;}SharedPreferences p=c.getSharedPreferences("widgets",Context.MODE_MULTI_PROCESS);String mode=p.getString(id+"_mode","month"),base=p.getString(id+"_base",LocalDate.now().toString());String verb=intent.getStringExtra("verb");if("mode".equals(verb)){mode=mode.equals("month")?"four":"month";base=LocalDate.now().toString();}else if("today".equals(verb)){base=LocalDate.now().toString();}else{int step="prev".equals(verb)?-1:1;base=(mode.equals("month")?Core.date(base).plusMonths(step):Core.date(base).plusWeeks(4L*step)).toString();}p.edit().putString(id+"_mode",mode).putString(id+"_base",base).apply();render(c,AppWidgetManager.getInstance(c),id);}else if(!AppWidgetManager.ACTION_APPWIDGET_UPDATE.equals(action)&&!AppWidgetManager.ACTION_APPWIDGET_OPTIONS_CHANGED.equals(action)){updateAll(c);} }
    @Override public void onDeleted(Context c,int[] ids){SharedPreferences.Editor e=c.getSharedPreferences("widgets",Context.MODE_MULTI_PROCESS).edit();for(int id:ids)e.remove(id+"_mode").remove(id+"_base");e.apply();}
    public static void updateAll(Context c){AppWidgetManager m=AppWidgetManager.getInstance(c);for(Class<?> provider:new Class<?>[]{CalendarWidget.class,MiuiCalendarWidget.class})for(int id:m.getAppWidgetIds(new ComponentName(c,provider)))render(c,m,id);scheduleMidnight(c);}
    static PendingIntent command(Context c,int id,String verb){
        AppWidgetProviderInfo info=AppWidgetManager.getInstance(c).getAppWidgetInfo(id);
        if(info==null)return null; // The host can delete a widget while an update is queued.
        Intent i=new Intent().setComponent(info.provider).setAction(ACTION).putExtra("widgetId",id).putExtra("verb",verb).setData(android.net.Uri.parse("flexible://widget/"+id+"/"+verb));return PendingIntent.getBroadcast(c,(id+verb).hashCode(),i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static PendingIntent detail(Context c,String key,String value){Intent i=new Intent(c,PlannerActivity.class).putExtra(key,value).setData(android.net.Uri.parse("flexible://detail/"+key+"/"+value)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);return PendingIntent.getActivity(c,(key+value).hashCode(),i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    static int fontLineDp(Context c,float sp,boolean bold){
        TextPaint paint=new TextPaint(fontPaint(c,sp,bold));String sample="事项Ag31•";
        StaticLayout.Builder line=StaticLayout.Builder.obtain(sample,0,sample.length(),paint,1000).setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(false).setLineSpacing(0,1).setMaxLines(1);
        if(android.os.Build.VERSION.SDK_INT>=28)line.setUseLineSpacingFromFallbacks(true);
        return (int)Math.ceil(line.build().getHeight()/c.getResources().getDisplayMetrics().density);
    }
    private static Paint fontPaint(Context c,float sp,boolean bold){Paint paint=new Paint();paint.setTypeface(bold?Typeface.DEFAULT_BOLD:Typeface.DEFAULT);paint.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP,sp,c.getResources().getDisplayMetrics()));return paint;}
    private static String fitTitle(Context c,String title,float sp,int widthDp){
        Paint paint=fontPaint(c,sp,false);float width=Math.max(1,widthDp)*c.getResources().getDisplayMetrics().density;
        if(paint.measureText(title)<=width)return title;
        int end=title.length();while(end>0&&paint.measureText(title.substring(0,end)+"…")>width)end=title.offsetByCodePoints(end,-1);
        return title.substring(0,end)+"…";
    }
    static float fitFontSp(Context c,float requested,int maxLineDp,int maxWidthDp,String sample,boolean bold){
        float fitted=requested;float widthPx=Math.max(1,maxWidthDp)*c.getResources().getDisplayMetrics().density;
        while(fitted>1&&(fontLineDp(c,fitted,bold)>Math.max(1,maxLineDp)||fontPaint(c,fitted,bold).measureText(sample)>widthPx))fitted-=0.25f;
        return Math.max(1,fitted);
    }
    private static void textSize(RemoteViews view,int id,float sp){view.setTextViewTextSize(id,TypedValue.COMPLEX_UNIT_SP,sp);}
    static void render(Context c,AppWidgetManager manager,int id){
        if(manager.getAppWidgetInfo(id)==null)return;
        SharedPreferences p=c.getSharedPreferences("widgets",Context.MODE_MULTI_PROCESS);String mode=p.getString(id+"_mode","month");String today=LocalDate.now().toString();LocalDate base=Core.date(p.getString(id+"_base",today));LocalDate first=mode.equals("four")?Core.date(Core.startOfWeek(base.toString())):Core.date(Core.startOfWeek(base.withDayOfMonth(1).toString()));int rows=mode.equals("four")?4:(int)Math.ceil((java.time.temporal.ChronoUnit.DAYS.between(first,base.withDayOfMonth(base.lengthOfMonth()))+1)/7.0);
        Bundle options=manager.getAppWidgetOptions(id);
        // Launcher reports a portrait/landscape size pair, not one current rectangle.
        boolean portrait=c.getResources().getConfiguration().orientation!=android.content.res.Configuration.ORIENTATION_LANDSCAPE;
        int height=options.getInt(portrait?AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT:AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,180);
        int width=options.getInt(portrait?AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH:AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,250);
        int dateSize=WidgetSupport.dateFontSize(c),itemSize=WidgetSupport.itemFontSize(c);
        WidgetLayoutPolicy layout=new WidgetLayoutPolicy(height,rows,fontLineDp(c,dateSize,true),fontLineDp(c,itemSize,false));
        boolean compact=layout.compact;
        int maxItems=layout.maxItems,maxRanges=layout.maxRanges;
        int cellWidth=Math.max(1,(width-(layout.compactRoot?6:18))/7-(layout.compactRoot?4:6));
        boolean monthMarker=!compact&&cellWidth>=35;
        float fittedDate=fitFontSp(c,dateSize,layout.maxDateLineDp,cellWidth,monthMarker?"12/1":"31•",true);
        RemoteViews root=new RemoteViews(c.getPackageName(),layout.compactRoot?R.layout.widget_compact:R.layout.widget);
        int headerLine=layout.compactRoot?20:32;
        textSize(root,R.id.widget_title,fitFontSp(c,layout.compactRoot?12:15,headerLine,1000,"",true));
        textSize(root,R.id.mode,fitFontSp(c,layout.compactRoot?10:12,headerLine,layout.compactRoot?34:40,"四周",false));
        for(int control:new int[]{R.id.previous,R.id.next,R.id.refresh})textSize(root,control,fitFontSp(c,layout.compactRoot?16:22,headerLine,layout.compactRoot?24:28,"↻",false));
        for(int weekday:new int[]{R.id.widget_monday,R.id.widget_tuesday,R.id.widget_wednesday,R.id.widget_thursday,R.id.widget_friday,R.id.widget_saturday,R.id.widget_sunday})textSize(root,weekday,fitFontSp(c,8,layout.compactRoot?12:19,cellWidth,"一",false));
        textSize(root,R.id.widget_footer,fitFontSp(c,10,19,1000,"",false));
        root.setTextViewText(R.id.widget_title,mode.equals("four")?first.getMonthValue()+"/"+first.getDayOfMonth()+" 起 · 四周":base.getYear()+"年 "+base.getMonthValue()+"月");root.setTextViewText(R.id.mode,mode.equals("four")?"月历":"四周");root.setOnClickPendingIntent(R.id.previous,command(c,id,"prev"));root.setOnClickPendingIntent(R.id.next,command(c,id,"next"));root.setOnClickPendingIntent(R.id.mode,command(c,id,"mode"));root.setOnClickPendingIntent(R.id.refresh,command(c,id,"refresh"));root.setOnClickPendingIntent(R.id.widget_title,command(c,id,"today"));root.setOnClickPendingIntent(R.id.widget_footer,detail(c,"filter","all"));root.removeAllViews(R.id.weeks);
        try{
            Store store=new Store(c);
            List<Core.Op> ops=store.load();
            List<Core.Task> tasks=Core.tasks(ops);
            tasks.removeIf(t->t.deleted||t.completed);
            tasks.sort(Comparator.comparing((Core.Task t)->t.deadline==null?"9999-12-31":t.deadline).thenComparing(t->t.title));
            List<Core.Task> planParts=new ArrayList<>();for(Core.Task t:tasks)planParts.addAll(Core.renderParts(t));
            if(compact)root.setTextViewText(R.id.widget_footer,"• 有事项 · 点击日期查看详情");
            for(int row=0;row<rows;row++){
                String monday=first.plusWeeks(row).toString();
                RemoteViews week=new RemoteViews(c.getPackageName(),compact?R.layout.widget_week_compact:R.layout.widget_week);
                if(!layout.showWeekBar)week.setViewVisibility(R.id.week_plan,View.GONE);
                textSize(week,R.id.week_plan,itemSize);
                List<Core.Task> weekTasks=new ArrayList<>(),ranges=new ArrayList<>();
                for(Core.Task t:planParts){
                    if(t.kind.equals("week")&&t.start.equals(monday))weekTasks.add(t);
                    if(Core.rangeSpan(t,monday)[1]>0)ranges.add(t);
                }
                String weekText="本周事项 · 暂无";
                if(!weekTasks.isEmpty()){
                    String overflow=weekTasks.size()>1?" · 另有"+(weekTasks.size()-1)+"项":"";
                    weekText="本周 · "+weekTasks.get(0).title+overflow;
                }
                if(maxRanges==0&&!ranges.isEmpty())weekText="本周 "+weekTasks.size()+" 项 · 另有 "+ranges.size()+" 项日期范围";
                week.setTextViewText(R.id.week_plan,fitTitle(c,weekText,itemSize,width-(layout.compactRoot?6:18)-4));
                week.setContentDescription(R.id.week_plan,monday+" 本周计划 "+weekTasks.size()+" 项，日期范围 "+ranges.size()+" 项；点击查看完整列表");
                week.setOnClickPendingIntent(R.id.week_plan,detail(c,"week",monday));
                for(int col=0;col<7;col++){
                    String day=first.plusDays(row*7L+col).toString();
                    LocalDate d=Core.date(day);
                    RemoteViews cell=new RemoteViews(c.getPackageName(),R.layout.widget_day);
                    String number=monthMarker&&d.getDayOfMonth()==1?d.getMonthValue()+"/1":String.valueOf(d.getDayOfMonth());
                    cell.setTextColor(R.id.day_number,d.getMonth()==base.getMonth()||mode.equals("four")?Color.rgb(35,59,49):Color.rgb(140,155,145));
                    if(day.equals(today))cell.setInt(R.id.day_cell,"setBackgroundResource",R.drawable.today_background);
                    List<Core.Task> visible=Core.dayTasks(tasks,day,maxRanges==0);
                    visible.sort(Comparator.comparing((Core.Task t)->!day.equals(t.deadline)).thenComparing(t->t.title));
                    cell.setTextViewText(R.id.day_number,number+(!layout.showDayOverflow&&visible.size()>maxItems?"•":""));
                    textSize(cell,R.id.day_number,fittedDate);textSize(cell,R.id.day_items,itemSize);textSize(cell,R.id.day_overflow,Math.max(6,itemSize-1));
                    float density=c.getResources().getDisplayMetrics().density;
                    int horizontalPadding=Math.round((layout.compactRoot?1:2)*density),verticalPadding=Math.round(layout.dayVerticalPaddingDp*density);
                    cell.setViewPadding(R.id.day_cell,horizontalPadding,verticalPadding,horizontalPadding,verticalPadding);
                    if(compact){
                        cell.setViewVisibility(R.id.day_items,View.GONE);
                    }
                    StringBuilder labels=new StringBuilder();
                    for(int n=0;n<Math.min(maxItems,visible.size());n++){
                        Core.Task t=visible.get(n);if(n>0)labels.append('\n');
                        labels.append(fitTitle(c,(day.equals(t.deadline)?"!":"")+t.title,itemSize,cellWidth));
                    }
                    cell.setTextViewText(R.id.day_items,labels.toString());
                    int overflow=Math.max(0,visible.size()-maxItems);
                    cell.setTextViewText(R.id.day_overflow,overflow>0?"另有"+overflow+"项":"");
                    cell.setViewVisibility(R.id.day_overflow,layout.showDayOverflow&&overflow>0?View.VISIBLE:View.GONE);
                    cell.setOnClickPendingIntent(R.id.day_cell,detail(c,"date",day));
                    cell.setContentDescription(R.id.day_cell,day+"；"+(compact?visible.size()+" 项事项；":"")+"点击查看完整事项与截止提醒");
                    week.addView(R.id.days,cell);
                }
                // A range is a single weighted bar spanning its actual inclusive columns.
                // It is repeated only when crossing a week boundary, never once per day.
                for(int lane=0;lane<Math.min(maxRanges,ranges.size());lane++){
                    Core.Task task=ranges.get(lane);int[] span=Core.rangeSpan(task,monday);
                    RemoteViews track=new RemoteViews(c.getPackageName(),R.layout.widget_range_row);
                    for(int before=0;before<span[0];before++)track.addView(R.id.range_segments,new RemoteViews(c.getPackageName(),R.layout.widget_range_spacer));
                    int resource=c.getResources().getIdentifier("widget_range_bar_"+span[1],"layout",c.getPackageName());
                    RemoteViews bar=new RemoteViews(c.getPackageName(),resource);
                    textSize(bar,R.id.range_bar,fitFontSp(c,itemSize,16,1000,"",true));
                    String arrow=task.start.compareTo(monday)<0?"← ":"↔ ";
                    String label=arrow+task.title+(span[1]>=5?"  "+task.start.substring(5)+"—"+task.end.substring(5):"");
                    bar.setTextViewText(R.id.range_bar,label);
                    bar.setContentDescription(R.id.range_bar,task.title+"；日期范围 "+task.start+" 至 "+task.end+(task.deadline==null?"":"；截止 "+task.deadline));
                    bar.setOnClickPendingIntent(R.id.range_bar,detail(c,"date",Core.dateAdd(monday,span[0])));
                    track.addView(R.id.range_segments,bar);
                    for(int after=span[0]+span[1];after<7;after++)track.addView(R.id.range_segments,new RemoteViews(c.getPackageName(),R.layout.widget_range_spacer));
                    week.addView(R.id.range_lanes,track);
                }
                if(maxRanges>0&&ranges.size()>maxRanges){
                    RemoteViews overflow=new RemoteViews(c.getPackageName(),R.layout.widget_range_overflow);
                    textSize(overflow,R.id.range_overflow,fitFontSp(c,itemSize,14,1000,"",false));
                    overflow.setTextViewText(R.id.range_overflow,"另有 "+(ranges.size()-maxRanges)+" 项日期范围 · 点击本周查看");
                    overflow.setOnClickPendingIntent(R.id.range_overflow,detail(c,"week",monday));week.addView(R.id.range_lanes,overflow);
                }
                root.addView(R.id.weeks,week);
            }
            int conflicts=0;for(Core.Task t:Core.tasks(ops))if(Core.heads(ops,t.id).size()>1)conflicts++;
            int pending=store.pending(ops);
            root.setTextViewText(R.id.widget_footer,"本地日历 · "+(pending>0?pending+" 项操作待同步 · ":"")+(conflicts>0?conflicts+" 项冲突 · ":"")+(SyncCoordinator.isRunning()?"同步中…":"! 截止  ↔ 范围"));
        }catch(Exception e){root.setTextViewText(R.id.widget_footer,"本地数据读取失败，请打开应用检查");}
        manager.updateAppWidget(id,root);
    }
    static void scheduleMidnight(Context c){AlarmManager alarm=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);Intent i=new Intent(c,CalendarWidget.class).setAction(MIDNIGHT);PendingIntent pending=PendingIntent.getBroadcast(c,7001,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);long at=LocalDate.now().plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()+1000;alarm.setAndAllowWhileIdle(AlarmManager.RTC,at,pending);}
}
