package app.flexible.calendar;

import android.app.AlertDialog;
import android.content.Intent;
import android.text.InputType;
import android.view.*;
import android.widget.*;
import java.time.LocalDate;
import java.util.concurrent.*;

/** Native credentials never enter the shared planner, intents, snapshots or displayed status. */
final class SyncSettingsDialog {
    private static final int MUTED=0xff697a70,INK=0xff233b31;
    static void show(MainActivity activity,Store store){
        final SyncConfig saved;
        try{saved=store.syncConfig();}catch(Exception failure){activity.error(new Exception("无法读取同步设置，事项数据仍保留"));return;}
        LinearLayout form=activity.column();form.setPadding(activity.dp(20),activity.dp(8),activity.dp(20),0);
        form.addView(activity.text("同步方式",13,INK));Spinner mode=new Spinner(activity);mode.setTag("sync_mode");mode.setAdapter(new ArrayAdapter<>(activity,android.R.layout.simple_spinner_dropdown_item,new String[]{"本地电脑","WebDAV"}));form.addView(mode);
        LinearLayout local=activity.column(),dav=activity.column();form.addView(local);form.addView(dav);
        local.addView(activity.text("电脑运行随历服务，在配对页取得地址与令牌。HTTP 仅用于可信网络。",12,MUTED));
        EditText localUrl=activity.field(local,"电脑服务地址",saved.serverUrl,InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);localUrl.setTag("local_url");localUrl.setHint("http://192.168.1.10:4317");
        EditText token=activity.field(local,"配对令牌（只保存在本机）",saved.token,InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);token.setTag("local_token");token.setSaveEnabled(false);
        dav.addView(activity.text("填写专用 JSON 文件的完整地址。父文件夹须先在网盘中创建；以 / 结尾的文件夹地址会补上 calendar.json。建议使用 HTTPS。",12,MUTED));
        EditText fileUrl=activity.field(dav,"WebDAV JSON 文件地址",saved.fileUrl,InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);fileUrl.setTag("webdav_url");fileUrl.setHint("https://dav.example.com/随历/calendar.json");
        EditText username=activity.field(dav,"用户名（匿名服务可与密码同时留空）",saved.username,InputType.TYPE_CLASS_TEXT);username.setTag("webdav_username");username.setSingleLine(true);
        EditText password=activity.field(dav,"密码（留空保留已保存密码）","",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);password.setTag("webdav_password");password.setSaveEnabled(false);password.setSingleLine(true);password.setHint(saved.passwordCipher.isEmpty()?"尚未保存密码":"已安全保存，留空保持");
        mode.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onNothingSelected(AdapterView<?> parent){}public void onItemSelected(AdapterView<?> parent,View view,int position,long id){local.setVisibility(position==0?View.VISIBLE:View.GONE);dav.setVisibility(position==1?View.VISIBLE:View.GONE);}});
        mode.setSelection(SyncConfig.WEBDAV.equals(saved.mode)?1:0);
        Switch auto=new Switch(activity);auto.setText("自动同步（前台、修改后及系统后台调度）");auto.setTextSize(12);auto.setTextColor(INK);auto.setChecked(store.prefs.getBoolean("autoSync",true));form.addView(auto);
        auto.setOnCheckedChangeListener((view,enabled)->{store.prefs.edit().putBoolean("autoSync",enabled).commit();if(!enabled)SyncCoordinator.cancelBackgroundWork();SyncCoordinator.ensureScheduled(activity);if(enabled)SyncCoordinator.request(activity,false,null);});
        form.addView(activity.text("后台约每 30 分钟申请同步，受网络和系统省电限制。离线可继续修改，手动同步不受自动开关影响。",12,MUTED));
        TextView feedback=activity.text("",12,MUTED);feedback.setTag("sync_settings_feedback");form.addView(feedback);
        ExecutorService worker=Executors.newSingleThreadExecutor();final SyncTransport[] testing={null};
        Button test=activity.button("测试连接",()->{
            try{
                SyncTransport transport;
                if(mode.getSelectedItemPosition()==1){String url=fileUrl.getText().toString().trim();if(url.endsWith("/"))url+="calendar.json";fileUrl.setText(url);String user=username.getText().toString().trim();String plain=store.webDavPasswordFor(url,user,password.getText().toString());transport=new WebDavTransport(url,user,plain);}
                else transport=new HttpSyncTransport(localUrl.getText().toString().trim(),token.getText().toString().trim());
                if(testing[0]!=null)testing[0].cancel();testing[0]=transport;feedback.setText("正在测试连接…");
                worker.execute(()->{String message;try{if(transport instanceof WebDavTransport){boolean exists=((WebDavTransport)transport).testConnection();message=exists?"连接成功，远程日志有效；首次同步仍会检查写入与回读":"连接成功，文件尚不存在；首次同步将创建文件，父文件夹须已存在";}else{((HttpSyncTransport)transport).testConnection();message="电脑连接成功，远程日志有效";}}catch(Exception failure){message=SyncCoordinator.safeMessage(failure);}final String outcome=message;activity.runOnUiThread(()->{if(testing[0]==transport&&!activity.isFinishing())feedback.setText(outcome);});});
            }catch(Exception invalid){feedback.setText(invalid.getMessage());}
        });form.addView(test);
        form.addView(activity.button("立即同步已保存配置",()->{if(!SyncCoordinator.configured(store)){feedback.setText("请先保存所选同步方式的地址与凭据");return;}SyncCoordinator.request(activity,true,()->{if(!activity.isFinishing())feedback.setText(store.status());});feedback.setText("已请求同步已保存的配置");}));
        form.addView(activity.button("清除 WebDAV 凭据",()->{try{store.clearWebDavCredentials();username.setText("");password.setText("");password.setHint("尚未保存密码");feedback.setText("WebDAV 凭据已清除，事项与历史仍保留");}catch(Exception failure){feedback.setText("清除凭据未完成，事项数据仍保留");}}));
        form.addView(activity.button("小米负一屏（检测系统支持）",()->MiuiSupport.detect(activity)));
        form.addView(activity.button("导出完整数据（不含同步凭据）",()->activity.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,"随历-"+LocalDate.now()+".json"),10)));
        form.addView(activity.button("导入数据（先预览，再合并）",()->activity.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE),11)));
        ScrollView scroll=new ScrollView(activity);scroll.addView(form);AlertDialog dialog=new AlertDialog.Builder(activity).setTitle("同步与数据").setView(scroll).setNegativeButton("关闭",null).setPositiveButton("保存设置",null).create();
        dialog.setOnDismissListener(ignored->{if(testing[0]!=null)testing[0].cancel();testing[0]=null;worker.shutdownNow();password.setText("");});
        dialog.setOnShowListener(ignored->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view->{try{
            if(mode.getSelectedItemPosition()==1){String url=fileUrl.getText().toString().trim();if(url.endsWith("/"))url+="calendar.json";store.saveWebDavConfig(url,username.getText().toString(),password.getText().toString());fileUrl.setText(url);password.setText("");password.setHint("已安全保存，留空保持");}
            else store.saveLocalConfig(localUrl.getText().toString(),token.getText().toString());
            feedback.setText("同步设置已保存");activity.render();SyncCoordinator.request(activity,false,null);
        }catch(Exception failure){feedback.setText(failure.getMessage()==null?"保存设置未完成，原配置仍保留":failure.getMessage());}}));dialog.show();
    }
}
