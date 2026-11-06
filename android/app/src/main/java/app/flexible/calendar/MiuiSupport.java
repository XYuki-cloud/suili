package app.flexible.calendar;

import android.app.*;
import android.net.Uri;
import android.os.Bundle;
import android.content.ComponentName;
import android.content.pm.PackageManager;

/** Uses only Xiaomi's documented, read-only feature probes; never claims store approval. */
public final class MiuiSupport {
    public static void detect(Activity activity){new Thread(()->{
        boolean widget=false,details=false,experimental=false;Uri uri=Uri.parse("content://com.miui.personalassistant.widget.external");
        try{Bundle b=activity.getContentResolver().call(uri,"isMiuiWidgetSupported",null,null);widget=b!=null&&b.getBoolean("isMiuiWidgetSupported");Bundle d=activity.getContentResolver().call(uri,"isMiuiWidgetDetailPageSupported",null,null);details=d!=null&&d.getBoolean("isMiuiWidgetDetailPageSupported");}catch(Exception ignored){/* Missing or restricted probes remain unconfirmed. */}
        try{activity.getPackageManager().getReceiverInfo(new ComponentName(activity,MiuiCalendarWidget.class),0);experimental=true;}catch(PackageManager.NameNotFoundException ignored){}
        String result="小米 Widget 能力："+(widget?"系统报告支持":"未确认（接口不可用、拒绝访问或未报告支持）")+"\n小米详情页能力："+(details?"系统报告支持":"未确认")+"\n当前安装包："+(experimental?"小米实验构建":"标准 Android 小部件构建")+"\n\n系统能力检测不代表审核通过或已经添加。当前应用尚未通过小米小部件中心审核，不能保证负一屏可添加。普通桌面请从随历的“桌面小部件”查看系统绑定；小米桌面请查找“搜索 → 安卓小部件”入口。";
        activity.runOnUiThread(()->{if(!activity.isFinishing())new AlertDialog.Builder(activity).setTitle("小米负一屏支持状态").setMessage(result).setPositiveButton("知道了",null).show();});
    },"miui-widget-probe").start();}
}
