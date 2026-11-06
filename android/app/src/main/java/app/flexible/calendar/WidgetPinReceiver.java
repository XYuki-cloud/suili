package app.flexible.calendar;

import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Private, explicit, one-shot PendingIntent callback supplied to the launcher. */
public final class WidgetPinReceiver extends BroadcastReceiver {
    static final String ACTION="app.flexible.calendar.WIDGET_PIN_CONFIRMED";
    @Override public void onReceive(Context context,Intent intent){
        if(intent==null||!ACTION.equals(intent.getAction()))return;
        int id=intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,AppWidgetManager.INVALID_APPWIDGET_ID);
        WidgetSupport.preferences(context).edit().putString("requestState","callback").putInt("callbackId",id).apply();
        // The callback is evidence of creation. The panel independently re-queries current bindings.
    }
}
