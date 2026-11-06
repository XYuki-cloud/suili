package app.flexible.calendar;

import android.appwidget.*;
import android.content.*;
import android.os.Bundle;

/** Registered only by the explicit miuiExperimental build, never ordinary APKs. */
public class MiuiCalendarWidget extends CalendarWidget {
    @Override public void onReceive(Context context,Intent intent){
        if(intent==null)return;
        if(ACTION.equals(intent.getAction())){
            int id=intent.getIntExtra("widgetId",AppWidgetManager.INVALID_APPWIDGET_ID);
            if(!owns(context,AppWidgetManager.getInstance(context),id))return;
            String verb=intent.getStringExtra("verb");
            if(!java.util.Arrays.asList("refresh","mode","today","prev","next").contains(verb))return;
        }
        if("miui.appwidget.action.APPWIDGET_UPDATE".equals(intent.getAction())){AppWidgetManager manager=AppWidgetManager.getInstance(context);int[] ids=intent.getIntArrayExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS);if(ids==null)ids=manager.getAppWidgetIds(new ComponentName(context,MiuiCalendarWidget.class));onUpdate(context,manager,ids);}else super.onReceive(context,intent);
    }
    private boolean owns(Context c,AppWidgetManager manager,int id){AppWidgetProviderInfo info=manager.getAppWidgetInfo(id);return info!=null&&new ComponentName(c,MiuiCalendarWidget.class).equals(info.provider);}
    @Override public void onUpdate(Context c,AppWidgetManager manager,int[] ids){if(ids!=null)for(int id:ids)if(owns(c,manager,id))render(c,manager,id);}
    @Override public void onRestored(Context c,int[] oldIds,int[] newIds){remap(c,oldIds,newIds,null);}
    @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager manager,int id,Bundle options){if(!owns(c,manager,id))return;if(options.getBoolean("miuiIdChanged")&&!options.getBoolean("miuiIdChangedComplete")){remap(c,options.getIntArray("miuiOldIds"),options.getIntArray("miuiNewIds"),options);}render(c,manager,id);}
    private void remap(Context c,int[] oldIds,int[] newIds,Bundle options){if(oldIds==null||newIds==null||oldIds.length!=newIds.length)return;SharedPreferences p=c.getSharedPreferences("widgets",Context.MODE_MULTI_PROCESS);SharedPreferences.Editor editor=p.edit();for(int i=0;i<oldIds.length;i++){editor.putString(newIds[i]+"_mode",p.getString(oldIds[i]+"_mode","month"));if(p.contains(oldIds[i]+"_base"))editor.putString(newIds[i]+"_base",p.getString(oldIds[i]+"_base",""));}editor.commit();AppWidgetManager manager=AppWidgetManager.getInstance(c);for(int id:newIds){if(options!=null){options.putBoolean("miuiIdChangedComplete",true);manager.updateAppWidgetOptions(id,options);}render(c,manager,id);}}
}
