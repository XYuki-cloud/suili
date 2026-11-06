package app.flexible.calendar;

import android.app.*;
import android.appwidget.AppWidgetManager;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.*;
import android.view.inputmethod.EditorInfo;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

/** Keyboard-friendly native list with lightweight editing; no network is needed to render. */
public class MainActivity extends Activity {
    private static final int GREEN=Color.rgb(71,119,102), INK=Color.rgb(35,59,49), MUTED=Color.rgb(105,122,112), BG=Color.rgb(244,246,242), RED=Color.rgb(165,67,53);
    private Store store;
    private WidgetSupport widgets;
    private LinearLayout root,content;
    private TextView status;
    private String filter="all", selectedDate, selectedWeek;
    private List<Core.Op> operations=new ArrayList<>();
    private Core.Task undoTask;
    private String undoOperation;
    private boolean syncing;
    private String syncMessage="";
    private EditText quickInput;
    private String quickDraft="";
    private int quickCursor;
    private boolean quickFocused;
    private final BroadcastReceiver syncUpdates=new BroadcastReceiver(){@Override public void onReceive(Context c,Intent i){render();}};
    @Override public void onCreate(Bundle state){super.onCreate(state);store=new Store(this);widgets=new WidgetSupport(this);if(state!=null){quickDraft=state.getString("quickDraft","");quickCursor=state.getInt("quickCursor",quickDraft.length());quickFocused=state.getBoolean("quickFocused",false);}readIntent();render();if(getIntent().getBooleanExtra("openSettings",false))settings();}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);readIntent();render();}
    @Override protected void onResume(){super.onResume();if(android.os.Build.VERSION.SDK_INT>=33)registerReceiver(syncUpdates,new IntentFilter(SyncCoordinator.UPDATED),Context.RECEIVER_NOT_EXPORTED);else registerReceiver(syncUpdates,new IntentFilter(SyncCoordinator.UPDATED));if(store!=null){render();widgets.refresh();SyncCoordinator.ensureScheduled(this);SyncCoordinator.request(this,false,null);}}
    @Override protected void onPause(){captureQuickDraft();unregisterReceiver(syncUpdates);super.onPause();}
    @Override protected void onSaveInstanceState(Bundle state){captureQuickDraft();state.putString("quickDraft",quickDraft);state.putInt("quickCursor",quickCursor);state.putBoolean("quickFocused",quickFocused);super.onSaveInstanceState(state);}
    private void captureQuickDraft(){if(quickInput!=null){quickDraft=quickInput.getText().toString();quickCursor=Math.max(0,quickInput.getSelectionStart());quickFocused=quickInput.hasFocus();}}
    private void readIntent(){selectedDate=getIntent().getStringExtra("date");selectedWeek=getIntent().getStringExtra("week");String f=getIntent().getStringExtra("filter");if(f!=null)filter=f;}
    int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    TextView text(String value,int size,int color){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);return t;}
    LinearLayout column(){LinearLayout v=new LinearLayout(this);v.setOrientation(LinearLayout.VERTICAL);return v;}
    Button button(String label,Runnable action){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextColor(GREEN);b.setTextSize(12);b.setMinWidth(0);b.setMinimumWidth(0);b.setPadding(dp(6),0,dp(6),0);b.setOnClickListener(v->action.run());return b;}
    void error(Exception e){new AlertDialog.Builder(this).setTitle("操作未完成").setMessage(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage()).setPositiveButton("知道了",null).show();}
    void render(){
        captureQuickDraft();syncing=SyncCoordinator.isRunning();syncMessage=store.status();
        root=column();root.setBackgroundColor(BG);root.setPadding(dp(16),dp(14),dp(16),0);root.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(dp(16)+insets.getSystemWindowInsetLeft(),dp(14)+insets.getSystemWindowInsetTop(),dp(16)+insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});setContentView(root);
        LinearLayout titleBar=new LinearLayout(this);TextView title=text("随历",25,INK);title.setTypeface(null,Typeface.BOLD);titleBar.addView(title,new LinearLayout.LayoutParams(0,-2,1));titleBar.addView(button("设置",this::settings));root.addView(titleBar);
        status=text("",11,MUTED);status.setPadding(0,dp(4),0,dp(5));root.addView(status);
        LinearLayout tools=new LinearLayout(this);tools.addView(button(syncing?"同步中…":"立即同步",this::sync),new LinearLayout.LayoutParams(0,dp(45),1));tools.addView(button("桌面小部件",this::pinWidget),new LinearLayout.LayoutParams(0,dp(45),1));Button undo=button("撤销",this::undo);undo.setEnabled(undoTask!=null);tools.addView(undo,new LinearLayout.LayoutParams(0,dp(45),1));root.addView(tools);
        LinearLayout inputRow=new LinearLayout(this);EditText quick=new EditText(this);quickInput=quick;quick.setTag("quick_entry");quick.setSingleLine(true);quick.setTextSize(15);quick.setHint("先记下来，回车添加…");quick.setImeOptions(EditorInfo.IME_ACTION_DONE);quick.setText(quickDraft);if(quickFocused)quick.requestFocus();quick.setSelection(Math.min(quickCursor,quickDraft.length()));inputRow.addView(quick,new LinearLayout.LayoutParams(0,dp(52),1));Runnable add=()->{String value=Core.trimInput(quick.getText().toString());if(value.isEmpty())return;Core.Task task=new Core.Task(UUID.randomUUID().toString(),value);if(selectedDate!=null){task.kind="day";task.start=task.end=selectedDate;}else if(selectedWeek!=null){task.kind="week";task.start=selectedWeek;task.end=Core.dateAdd(selectedWeek,6);}if(change(task,null,headIds(task.id))){quickDraft="";quickCursor=0;quickInput.setText("");quickInput.requestFocus();}};inputRow.addView(button("添加",add));quick.setOnEditorActionListener((v,action,event)->{if(action==EditorInfo.IME_ACTION_DONE||(event!=null&&event.getKeyCode()==KeyEvent.KEYCODE_ENTER)){add.run();return true;}return false;});root.addView(inputRow);
        HorizontalScrollView tabs=new HorizontalScrollView(this);tabs.setHorizontalScrollBarEnabled(false);LinearLayout tabrow=new LinearLayout(this);String[][] choices={{"all","全部"},{"today","今天"},{"none","待安排"},{"replan","待重排"},{"completed","已完成"},{"conflicts","冲突"}};for(String[] choice:choices){Button b=button(choice[1],()->{selectedDate=null;selectedWeek=null;filter=choice[0];render();});if(filter.equals(choice[0])&&selectedDate==null&&selectedWeek==null)b.setTypeface(null,Typeface.BOLD);tabrow.addView(b);}tabs.addView(tabrow);root.addView(tabs);
        ScrollView scroll=new ScrollView(this);content=column();scroll.addView(content);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        try{operations=store.load();int pending=store.pending(operations);long last=store.lastSync();String time=last==0?"尚未同步":Instant.ofEpochMilli(last).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("MM-dd HH:mm"));status.setText("本地保存 · "+pending+" 项操作待同步 · "+time+(syncMessage.isEmpty()?"":"\n"+syncMessage));List<Core.Task> tasks=Core.tasks(operations);String today=LocalDate.now().toString();if(selectedDate!=null)content.addView(text(selectedDate+" · 当日完整事项",19,INK));else if(selectedWeek!=null)content.addView(text(selectedWeek+" 起 · 本周事项",19,INK));int count=0;tasks.sort(Comparator.comparing((Core.Task t)->t.deadline==null?"9999-12-31":t.deadline).thenComparing(t->t.title));for(Core.Task t:tasks){List<Core.Op> heads=Core.heads(operations,t.id);boolean conflict=heads.size()>1;if(t.deleted&&!conflict)continue;boolean visible;if(selectedDate!=null)visible=Core.onDay(t,selectedDate);else if(selectedWeek!=null)visible=Core.onWeek(t,selectedWeek);else switch(filter){case "today":visible=Core.onDay(t,today)&&!t.completed;break;case "none":visible=t.kind.equals("none")&&!t.completed;break;case "replan":visible=!t.completed&&t.end!=null&&t.end.compareTo(today)<0;break;case "completed":visible=t.completed;break;case "conflicts":visible=conflict;break;default:visible=!t.completed;}if(!visible)continue;count++;LinearLayout card=column();GradientDrawable bg=new GradientDrawable();bg.setColor(Color.WHITE);bg.setCornerRadius(dp(12));card.setBackground(bg);card.setPadding(dp(14),dp(12),dp(14),dp(12));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.setMargins(0,dp(6),0,dp(4));TextView name=text((t.completed?"✓ ":"")+(t.deleted?"[删除版本] ":"")+t.title,17,INK);card.addView(name);card.addView(text(Core.planLabel(t),12,MUTED));if(t.deadline!=null)card.addView(text("! 截止 "+t.deadline+(!t.completed&&t.deadline.compareTo(today)<0?" · 已逾期":""),12,RED));if(conflict)card.addView(text("存在 "+heads.size()+" 个并发版本 · 点击选择",12,RED));if(!t.notes.isEmpty()){TextView notes=text(t.notes,12,MUTED);notes.setMaxLines(2);card.addView(notes);}card.setOnClickListener(v->{if(conflict)resolve(t.id);else actions(t);});content.addView(card,lp);}if(count==0){TextView empty=text("这里暂时没有事项\n在上方记下一条，或与电脑同步。",16,MUTED);empty.setPadding(dp(8),dp(32),dp(8),dp(20));content.addView(empty);}}catch(Exception e){status.setText("读取失败；已保留本地原文件");content.addView(text("本地数据无法读取："+e.getMessage(),15,RED));}
    }
    List<String> headIds(String taskId){return ids(Core.heads(operations,taskId));}
    List<String> ids(List<Core.Op> heads){List<String> ids=new ArrayList<>();for(Core.Op h:heads)ids.add(h.id);return ids;}
    void change(Core.Task task,Core.Task before){change(task,before,headIds(task.id));}
    boolean change(Core.Task task,Core.Task before,List<String> expected){
        try{Core.Op op=store.change(task,expected);undoTask=before==null?task.copy():before.copy();if(before==null)undoTask.deleted=true;undoOperation=op.id;render();Toast.makeText(this,"已保存到本机，可撤销",Toast.LENGTH_SHORT).show();return true;}
        catch(Exception e){error(e);return false;}
    }
    void undo(){if(undoTask==null)return;try{store.change(undoTask,Collections.singletonList(undoOperation));undoTask=null;undoOperation=null;render();}catch(Exception e){error(e);}}
    void actions(Core.Task original){
        List<String> expected=headIds(original.id);
        String[] choices={original.completed?"恢复为未完成":"标为完成",original.kind.equals("segments")?"整体移到明天（含周计划按周平移）":"移到明天",original.kind.equals("segments")?"整体移到下周":"移到下周","改标题、计划或截止日","删除事项"};
        new AlertDialog.Builder(this).setTitle(original.title).setItems(choices,(d,which)->{
            Core.Task task=original.copy();
            switch(which){
                case 0:task.completed=!task.completed;change(task,original,expected);break;
                case 1:confirmPlan(Core.toTomorrow(task,LocalDate.now().toString()),original,expected,()->{});break;
                case 2:confirmPlan(Core.toNextWeek(task,LocalDate.now().toString()),original,expected,()->{});break;
                case 3:edit(original,expected);break;
                case 4:new AlertDialog.Builder(this).setTitle("删除这条事项？").setMessage("删除会参与同步，并保留历史。可在本次操作后撤销。").setNegativeButton("取消",null).setPositiveButton("删除",(x,y)->{task.deleted=true;change(task,original,expected);}).show();
            }
        }).show();
    }
    void confirmPlan(Core.Task task,Core.Task before,List<String> expected,Runnable saved){
        Runnable commit=()->{if(change(task,before,expected))saved.run();};
        if(task.deadline!=null&&task.end!=null&&task.end.compareTo(task.deadline)>0)new AlertDialog.Builder(this).setTitle("计划超出截止日").setMessage("计划结束于 "+task.end+"，硬截止仍为 "+task.deadline+"。是否保留这次调整？").setNegativeButton("取消",null).setPositiveButton("保留调整",(d,w)->commit.run()).show();else commit.run();
    }
    EditText field(LinearLayout form,String label,String value,int type){form.addView(text(label,12,MUTED));EditText input=new EditText(this);input.setText(value==null?"":value);input.setTextSize(15);input.setInputType(type);form.addView(input);return input;}
    EditText dateField(LinearLayout form,String label,String value){EditText input=field(form,label,value,InputType.TYPE_CLASS_DATETIME|InputType.TYPE_DATETIME_VARIATION_DATE);input.setHint("YYYY-MM-DD，可手动输入");LinearLayout row=new LinearLayout(this);row.addView(button("选择日期",()->{LocalDate d;try{d=Core.date(input.getText().toString());}catch(Exception e){d=LocalDate.now();}new DatePickerDialog(this,(view,y,m,day)->input.setText(LocalDate.of(y,m+1,day).toString()),d.getYear(),d.getMonthValue()-1,d.getDayOfMonth()).show();}),new LinearLayout.LayoutParams(0,dp(38),1));row.addView(button("清空",()->input.setText("")),new LinearLayout.LayoutParams(0,dp(38),1));form.addView(row);return input;}
    String nullable(EditText input){String s=input.getText().toString().trim();return s.isEmpty()?null:s;}
    void editMultiple(Core.Task original,List<String> expected){
        LinearLayout form=column();form.setPadding(dp(20),dp(8),dp(20),0);
        EditText title=field(form,"标题",original.title,InputType.TYPE_CLASS_TEXT);
        EditText notes=field(form,"描述（可选）",original.notes,InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        form.addView(text("已有 "+original.segments.size()+" 段安排",14,INK));
        for(Core.PlanPart part:Core.planParts(original))form.addView(text(Core.partLabel(part),13,MUTED));
        form.addView(text("保存会保留以上所有安排。需要增加、移动或移除某一段，请在日历中选择该事项后调整。",12,MUTED));
        form.addView(button("在日历中调整各段",()->startActivity(new Intent(this,PlannerActivity.class).putExtra("date",original.start))));
        EditText deadline=dateField(form,"独立硬截止（留空表示无截止）",original.deadline);
        ScrollView scroll=new ScrollView(this);scroll.addView(form);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("编辑多段事项").setView(scroll).setNegativeButton("取消",null).setPositiveButton("保存",null).create();
        dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{try{
            Core.Task task=original.copy();task.title=Core.trimInput(title.getText().toString());task.notes=notes.getText().toString();task.deadline=nullable(deadline);
            Core.validateTask(task);confirmPlan(task,original,expected,dialog::dismiss);
        }catch(Exception e){error(e);}}));dialog.show();
    }
    void edit(Core.Task original,List<String> expected){if(original.kind.equals("segments")){editMultiple(original,expected);return;}LinearLayout form=column();form.setPadding(dp(20),dp(8),dp(20),0);EditText title=field(form,"标题",original.title,InputType.TYPE_CLASS_TEXT);EditText notes=field(form,"描述（可选）",original.notes,InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE);Spinner kind=new Spinner(this);String[] kinds={"none","day","week","range"};kind.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"待安排","某一天","某一周（周一至周日）","日期范围（含首尾）"}));kind.setSelection(Arrays.asList(kinds).indexOf(original.kind));form.addView(kind);EditText start=dateField(form,"计划开始（周计划会归整为所在周）",original.start),end=dateField(form,"计划结束（仅日期范围使用）",original.end),deadline=dateField(form,"独立硬截止（留空表示无截止）",original.deadline);ScrollView scroll=new ScrollView(this);scroll.addView(form);AlertDialog dialog=new AlertDialog.Builder(this).setTitle("编辑事项").setView(scroll).setNegativeButton("取消",null).setPositiveButton("保存",null).create();dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{try{Core.Task t=original.copy();t.title=title.getText().toString().trim();t.notes=notes.getText().toString();t.kind=kinds[kind.getSelectedItemPosition()];t.deadline=nullable(deadline);if(t.kind.equals("none")){t.start=t.end=null;}else{t.start=nullable(start);Core.date(t.start);if(t.kind.equals("week")){t.start=Core.startOfWeek(t.start);t.end=Core.dateAdd(t.start,6);}else if(t.kind.equals("day")){t.end=t.start;}else{t.end=nullable(end);}}Core.validateTask(t);confirmPlan(t,original,expected,dialog::dismiss);}catch(Exception e){error(e);}}));dialog.show();}
    void resolve(String taskId){try{List<Core.Op> heads=Core.heads(store.load(),taskId);String[] choices=new String[heads.size()];for(int i=0;i<heads.size();i++){Core.Op o=heads.get(i);choices[i]=o.task.title+"\n"+(o.task.deleted?"已删除 · ":o.task.completed?"已完成 · ":"")+Core.planLabel(o.task)+(o.task.deadline==null?"":"\n截止 "+o.task.deadline)+"\n"+o.deviceId+" · "+o.createdAt+(o.task.notes.isEmpty()?"":"\n描述："+o.task.notes);}new AlertDialog.Builder(this).setTitle("保留哪个版本？双方历史均保留").setItems(choices,(d,which)->new AlertDialog.Builder(this).setTitle("确认采用这个版本？").setMessage(choices[which]+"\n\n会建立继承全部当前版本的新操作。").setNegativeButton("取消",null).setPositiveButton("采用",(x,y)->change(heads.get(which).task,heads.get(heads.size()-1).task,ids(heads))).show()).setNegativeButton("稍后",null).show();}catch(Exception e){error(e);}}
    void sync(){if(!SyncCoordinator.configured(store)){settings();return;}SyncCoordinator.request(this,true,null);render();}
    void pinWidget(){widgets.show();}
    void settings(){SyncSettingsDialog.show(this,store);}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(result!=RESULT_OK||data==null||data.getData()==null)return;try{if(request==10){try(OutputStream out=getContentResolver().openOutputStream(data.getData())){out.write(store.snapshot().getBytes(StandardCharsets.UTF_8));}Toast.makeText(this,"已导出操作历史，未包含配对令牌",Toast.LENGTH_LONG).show();}else if(request==11){String raw;try(InputStream in=getContentResolver().openInputStream(data.getData());ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] bytes=new byte[8192];int n;while((n=in.read(bytes))!=-1){out.write(bytes,0,n);if(out.size()>10*1024*1024)throw new IOException("文件超过 10 MB");}raw=out.toString(StandardCharsets.UTF_8.name());}List<Core.Op> incoming=JsonCodec.decode(raw),merged=Core.merge(store.load(),incoming);int conflicts=0;for(Core.Task t:Core.tasks(merged))if(Core.heads(merged,t.id).size()>1)conflicts++;new AlertDialog.Builder(this).setTitle("导入预览").setMessage("文件含 "+incoming.size()+" 条操作、"+Core.tasks(incoming).size()+" 个事项。合并后共有 "+merged.size()+" 条操作、"+conflicts+" 个冲突。已有历史会保留。").setNegativeButton("取消",null).setPositiveButton("合并导入",(d,w)->{try{store.merge(incoming,false);render();}catch(Exception e){error(e);}}).show();}}catch(Exception e){error(e);}}
}
