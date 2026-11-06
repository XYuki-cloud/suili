package app.flexible.calendar;

import java.util.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;

public final class Core {
    public static final class PlanPart {
        public final String kind,start,end;
        public PlanPart(String kind,String start,String end) {this.kind=kind;this.start=start;this.end=end;}
        @Override public boolean equals(Object obj) {if(!(obj instanceof PlanPart))return false;PlanPart p=(PlanPart)obj;return Objects.equals(kind,p.kind)&&Objects.equals(start,p.start)&&Objects.equals(end,p.end);}
        @Override public int hashCode() {return Objects.hash(kind,start,end);}
    }
    public static final class Task {
        public String id, title, notes = "", kind = "none", start, end, deadline, color = "#477766";
        /** Present only for kind=segments; legacy wire plans retain exactly their old fields. */
        public List<PlanPart> segments;
        public boolean completed, deleted;
        public Task(String id, String title) { this.id=id; this.title=title; }
        public Task copy() { Task t=new Task(id,title);t.notes=notes;t.kind=kind;t.start=start;t.end=end;t.segments=segments==null?null:new ArrayList<>(segments);t.deadline=deadline;t.color=color;t.completed=completed;t.deleted=deleted;return t; }
        @Override public boolean equals(Object obj) { if (!(obj instanceof Task)) return false;Task t=(Task)obj;return Objects.equals(id,t.id)&&Objects.equals(title,t.title)&&Objects.equals(notes,t.notes)&&Objects.equals(kind,t.kind)&&Objects.equals(start,t.start)&&Objects.equals(end,t.end)&&Objects.equals(segments,t.segments)&&Objects.equals(deadline,t.deadline)&&Objects.equals(color,t.color)&&completed==t.completed&&deleted==t.deleted; }
        @Override public int hashCode() { return Objects.hash(id,title,notes,kind,start,end,segments,deadline,color,completed,deleted); }
    }
    public static final class Op {
        public String id, taskId, deviceId, createdAt;
        public List<String> parents;
        public Task task;
        public Op(String id, Task task, List<String> parents, String deviceId, String createdAt) { this.id=id; this.taskId=task.id; this.task=task; this.parents=parents; this.deviceId=deviceId; this.createdAt=createdAt; }
        @Override public boolean equals(Object obj) { if (!(obj instanceof Op)) return false;Op o=(Op)obj;return Objects.equals(id,o.id)&&Objects.equals(taskId,o.taskId)&&Objects.equals(deviceId,o.deviceId)&&Objects.equals(createdAt,o.createdAt)&&Objects.equals(parents,o.parents)&&Objects.equals(task,o.task); }
        @Override public int hashCode() { return Objects.hash(id,taskId,deviceId,createdAt,parents,task); }
    }
    public static LocalDate date(String value) { try { if(value==null||!value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))throw new IllegalArgumentException("日期格式应为 YYYY-MM-DD");LocalDate parsed=LocalDate.parse(value);if(parsed.getYear()<1||parsed.getYear()>9999)throw new IllegalArgumentException("日期年份应为 0001–9999");return parsed; } catch (java.time.DateTimeException e) { throw new IllegalArgumentException("无效日期："+value); } }
    public static String dateAdd(String value, int days) { String result=date(value).plusDays(days).toString();date(result);return result; }
    public static String startOfWeek(String value) { return date(value).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).toString(); }
    public static List<PlanPart> planParts(Task t) {if("none".equals(t.kind))return Collections.emptyList();if("segments".equals(t.kind))return new ArrayList<>(t.segments);return Collections.singletonList(new PlanPart(t.kind,t.start,t.end));}
    public static Task shiftPlan(Task t, String target) {
        validateTask(t);date(target);Task s=t.copy();
        if(t.kind.equals("segments")){
            boolean hasWeek=false;for(PlanPart part:t.segments)if(part.kind.equals("week"))hasWeek=true;
            int days=(int)ChronoUnit.DAYS.between(date(hasWeek?startOfWeek(t.start):t.start),date(hasWeek?startOfWeek(target):target));
            s.segments=new ArrayList<>();for(PlanPart part:t.segments)s.segments.add(new PlanPart(part.kind,dateAdd(part.start,days),dateAdd(part.end,days)));
            s.start=s.segments.get(0).start;s.end=s.segments.get(s.segments.size()-1).end;
        }else if(t.kind.equals("week")){s.start=startOfWeek(target);s.end=dateAdd(s.start,6);}
        else{long days=t.kind.equals("range")?ChronoUnit.DAYS.between(date(t.start),date(t.end)):0;s.kind=t.kind.equals("range")?"range":"day";s.start=target;s.end=dateAdd(target,(int)days);}
        validateTask(s);return s;
    }
    public static Task toTomorrow(Task t,String today) {Task moved=shiftPlan(t,dateAdd(today,1));if(t.kind.equals("week")){moved.kind="day";moved.start=moved.end=dateAdd(today,1);}return moved;}
    public static Task toNextWeek(Task t,String today) {validateTask(t);String nextMonday=dateAdd(startOfWeek(today),7);if(t.kind.equals("segments")){int days=(int)ChronoUnit.DAYS.between(date(startOfWeek(t.start)),date(nextMonday));return shiftPlan(t,dateAdd(t.start,days));}Task moved=t.copy();moved.kind="week";moved.start=nextMonday;moved.end=dateAdd(moved.start,6);return moved;}
    public static int[] rangeSpan(Task t,String monday) {if(!t.kind.equals("range"))return new int[]{-1,0};String sunday=dateAdd(monday,6);if(t.end.compareTo(monday)<0||t.start.compareTo(sunday)>0)return new int[]{-1,0};String a=t.start.compareTo(monday)<0?monday:t.start,b=t.end.compareTo(sunday)>0?sunday:t.end;return new int[]{(int)ChronoUnit.DAYS.between(date(monday),date(a)),(int)ChronoUnit.DAYS.between(date(a),date(b))+1};}
    /** Display copies keep the original task identity; never write these projections to the store. */
    public static List<Task> renderParts(Task t) {List<Task> result=new ArrayList<>();for(PlanPart part:planParts(t)){Task shown=t.copy();shown.kind=part.kind;shown.start=part.start;shown.end=part.end;shown.segments=null;result.add(shown);}return result;}
    public static boolean onWeek(Task t,String monday) {if(t.deleted)return false;String sunday=dateAdd(monday,6);for(PlanPart part:planParts(t))if((part.kind.equals("week")&&part.start.equals(monday))||(part.kind.equals("range")&&part.start.compareTo(sunday)<=0&&part.end.compareTo(monday)>=0))return true;return false;}
    /** Use original tasks for daily counts so their one deadline is not duplicated by plan projections. */
    public static List<Task> dayTasks(List<Task> tasks,String day,boolean includeRanges) {List<Task> visible=new ArrayList<>();for(Task t:tasks){if(t.deleted)continue;boolean present=day.equals(t.deadline);if(!present)for(PlanPart part:planParts(t))if((part.kind.equals("day")||(includeRanges&&part.kind.equals("range")))&&day.compareTo(part.start)>=0&&day.compareTo(part.end)<=0){present=true;break;}if(present)visible.add(t);}return visible;}
    static void require(boolean ok,String message) { if(!ok)throw new IllegalArgumentException(message); }
    static boolean jsSpace(char ch){return (ch>=0x09&&ch<=0x0d)||ch==0x20||ch==0xa0||ch==0x1680||(ch>=0x2000&&ch<=0x200a)||ch==0x2028||ch==0x2029||ch==0x202f||ch==0x205f||ch==0x3000||ch==0xfeff;}
    public static String trimInput(String value){if(value==null)return "";int a=0,b=value.length();while(a<b&&jsSpace(value.charAt(a)))a++;while(b>a&&jsSpace(value.charAt(b-1)))b--;return value.substring(a,b);}
    static boolean nonempty(String value){return value!=null&&!trimInput(value).isEmpty();}
    public static void requireHeads(List<Op> ops,String taskId,List<String> expected) {Set<String> current=new HashSet<>();for(Op head:heads(ops,taskId))current.add(head.id);require(current.equals(new HashSet<>(expected)),"该事项在编辑期间收到新版本，草稿未写入。请保留所需文字，关闭编辑框后查看最新版本／冲突再修改。");}
    static Instant timestamp(String stamp) {require(stamp!=null&&stamp.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,9})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])"),"操作时间格式无效");date(stamp.substring(0,10));int cut=stamp.endsWith("Z")?stamp.length()-1:stamp.length()-6;Instant base=LocalDateTime.parse(stamp.substring(0,cut)).toInstant(ZoneOffset.UTC);if(stamp.endsWith("Z"))return base;int seconds=Integer.parseInt(stamp.substring(cut+1,cut+3))*3600+Integer.parseInt(stamp.substring(cut+4))*60;return base.minusSeconds(stamp.charAt(cut)=='+'?seconds:-seconds);}
    static void validatePart(PlanPart p) {require(p!=null&&Arrays.asList("day","week","range").contains(p.kind),"计划段类型无效");LocalDate a=date(p.start),b=date(p.end);require(!b.isBefore(a),"结束日期早于开始日期");if(p.kind.equals("day"))require(a.equals(b),"单日首尾应相同");if(p.kind.equals("week"))require(a.getDayOfWeek()==DayOfWeek.MONDAY&&a.plusDays(6).equals(b),"周计划应为周一至周日");}
    public static void validateTask(Task t) {
        require(t!=null,"缺少事项");require(t.id!=null&&t.id.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"),"事项 ID 无效");
        require(nonempty(t.title)&&t.title.length()<=300,"标题需为 1–300 字");require(t.notes!=null,"描述无效");require(t.color!=null&&t.color.matches("#[0-9A-Fa-f]{6}"),"颜色无效");require(Arrays.asList("none","day","week","range","segments").contains(t.kind),"计划类型无效");
        if(t.kind.equals("segments")){
            require(t.segments!=null&&t.segments.size()>=2,"多段计划至少需要两段");String previousEnd=null;
            for(PlanPart part:t.segments){validatePart(part);require(previousEnd==null||part.start.compareTo(previousEnd)>0,"计划段应按日期排序且不重叠");previousEnd=part.end;}
            require(Objects.equals(t.start,t.segments.get(0).start)&&Objects.equals(t.end,previousEnd),"多段计划边界不一致");
        }else{require(t.segments==null,"单段计划不应包含 segments");if(t.kind.equals("none"))require(t.start==null&&t.end==null,"待安排事项不应有计划日期");else validatePart(new PlanPart(t.kind,t.start,t.end));}
        if(t.deadline!=null)date(t.deadline);
    }
    public static void validateOp(Op op) { require(op!=null,"操作为空");validateTask(op.task);require(nonempty(op.id),"操作 ID 无效");require(op.task.id.equals(op.taskId),"操作事项 ID 不一致");require(nonempty(op.deviceId),"设备 ID 无效");require(op.parents!=null,"缺少 parents");for(String p:op.parents)require(nonempty(p),"parent ID 无效");require(new HashSet<>(op.parents).size()==op.parents.size(),"重复 parent");try{timestamp(op.createdAt);}catch(Exception e){throw new IllegalArgumentException("操作时间无效");} }
    public static List<Op> merge(List<Op> a, List<Op> b) {
        Map<String,Op> all=new LinkedHashMap<>();List<Op> together=new ArrayList<>(a);together.addAll(b);
        for(Op op:together){validateOp(op);Op prior=all.get(op.id);require(prior==null||prior.equals(op),"相同操作 ID 内容不一致");all.put(op.id,op);}
        for(Op op:all.values())for(String p:op.parents){require(all.containsKey(p),"缺少父操作："+p);require(all.get(p).taskId.equals(op.taskId),"父操作属于另一事项");}
        // Kahn's algorithm avoids stack exhaustion on a long editing history.
        Map<String,Integer> degrees=new HashMap<>();Map<String,List<String>> children=new HashMap<>();ArrayDeque<String> ready=new ArrayDeque<>();
        for(Op op:all.values()){degrees.put(op.id,op.parents.size());if(op.parents.isEmpty())ready.add(op.id);for(String p:op.parents)children.computeIfAbsent(p,k->new ArrayList<>()).add(op.id);}
        int visited=0;while(!ready.isEmpty()){String id=ready.remove();visited++;for(String child:children.getOrDefault(id,Collections.emptyList())){int n=degrees.get(child)-1;degrees.put(child,n);if(n==0)ready.add(child);}}
        require(visited==all.size(),"操作历史存在循环");List<Op> sorted=new ArrayList<>(all.values());sorted.sort(Comparator.comparing(o->o.id));return sorted;
    }
    public static List<Op> heads(List<Op> ops, String taskId) {Set<String> parents=new HashSet<>();for(Op o:ops)if(o.taskId.equals(taskId))parents.addAll(o.parents);List<Op> result=new ArrayList<>();for(Op o:ops)if(o.taskId.equals(taskId)&&!parents.contains(o.id))result.add(o);result.sort(Comparator.comparing((Op o)->timestamp(o.createdAt).toEpochMilli()).thenComparing(o->o.id));return result;}
    public static List<Task> tasks(List<Op> ops) {Set<String> ids=new LinkedHashSet<>();for(Op o:ops)ids.add(o.taskId);List<Task> tasks=new ArrayList<>();for(String id:ids){List<Op> h=heads(ops,id);tasks.add(h.get(h.size()-1).task.copy());}return tasks;}
    public static Op makeOp(Task task,List<Op> ops,String deviceId) {validateTask(task);List<String> parents=new ArrayList<>();for(Op o:heads(ops,task.id))parents.add(o.id);Collections.sort(parents);return new Op(UUID.randomUUID().toString(),task.copy(),parents,deviceId,Instant.now().truncatedTo(ChronoUnit.MILLIS).toString());}
    public static boolean onDay(Task t, String day) {if(t.deleted)return false;if(day.equals(t.deadline))return true;for(PlanPart part:planParts(t))if((part.kind.equals("day")||part.kind.equals("range"))&&day.compareTo(part.start)>=0&&day.compareTo(part.end)<=0)return true;return false;}
    static String partLabel(PlanPart part) {return part.kind.equals("day")?part.start:(part.kind.equals("week")?"本周事项 · ":"")+part.start+" — "+part.end;}
    public static String planLabel(Task t) {List<PlanPart> parts=planParts(t);if(parts.isEmpty())return "待安排";StringBuilder label=new StringBuilder();for(PlanPart part:parts){if(label.length()>0)label.append("；");label.append(partLabel(part));}return label.toString();}
}
