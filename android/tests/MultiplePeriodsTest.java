package app.flexible.calendar;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.json.*;

/** Shared source fixture is also consumable by the JavaScript protocol tests. */
public final class MultiplePeriodsTest {
    private static int passed;
    interface Check { void run() throws Exception; }
    static void check(String name, Check fn) throws Exception { fn.run(); passed++; System.out.println("PASS "+name); }
    static void eq(Object actual,Object expected) { if(!Objects.equals(actual,expected))throw new AssertionError("Expected "+expected+" but got "+actual); }
    static void truth(boolean value) { if(!value)throw new AssertionError("Expected true"); }
    static void reject(Check fn) throws Exception { try{fn.run();}catch(IllegalArgumentException|JSONException expected){return;}throw new AssertionError("Expected rejection"); }
    static JSONObject plan(Core.Task task) throws Exception {return JsonCodec.task(task).getJSONObject("plan");}
    static Core.Task task(JSONObject fixture,int index) throws Exception { return JsonCodec.task(fixture.getJSONArray("operations").getJSONObject(index).getJSONObject("task")); }
    public static void main(String[] args) throws Exception {
        String raw=Files.readString(Path.of(args[0]),StandardCharsets.UTF_8);
        JSONObject fixture=new JSONObject(raw);
        check("mixed old and multi-period source fixture roundtrips without rewriting content",()->{
            List<Core.Op> ops=JsonCodec.decode(raw);
            truth(new JSONObject(JsonCodec.encode(ops)).similar(fixture));
            eq(JsonCodec.decode(JsonCodec.encode(ops)),ops);
            eq(ops.get(0).task.title,"  保留旧标题  ");
            truth(!plan(ops.get(0).task).has("segments"));
        });
        check("multiple periods leave gaps empty and preserve independent deadline",()->{
            Core.Task t=task(fixture,1);
            eq(Core.onDay(t,"2026-11-02"),true);eq(Core.onDay(t,"2026-11-03"),false);
            eq(Core.onDay(t,"2026-11-04"),true);eq(Core.onDay(t,"2026-11-06"),true);
            eq(Core.onDay(t,"2026-11-07"),false);eq(Core.onDay(t,"2026-11-13"),true);
            t.deleted=true;eq(Core.onDay(t,"2026-11-13"),false);
        });
        check("whole move retains durations gaps and deadline without mutating source",()->{
            Core.Task t=task(fixture,1),m=Core.shiftPlan(t,"2026-11-09");
            eq(m.kind,"segments");eq(m.start,"2026-11-09");eq(m.end,"2026-11-13");eq(m.deadline,t.deadline);
            eq(plan(m).getJSONArray("segments").getJSONObject(1).getString("start"),"2026-11-11");
            eq(Core.onDay(m,"2026-11-10"),false);eq(t.start,"2026-11-02");
        });
        check("mixed week move rounds to whole weeks and never expands week to daily tasks",()->{
            Core.Task t=task(fixture,2),m=Core.shiftPlan(t,"2026-11-12");
            eq(m.start,"2026-11-09");eq(m.end,"2026-11-19");eq(m.deadline,t.deadline);
            eq(Core.onDay(t,"2026-11-04"),false);eq(Core.onDay(t,"2026-11-10"),false);eq(Core.onDay(t,"2026-11-11"),true);
            eq(plan(m).getJSONArray("segments").getJSONObject(0).getString("end"),"2026-11-15");
        });
        check("multi-period shortcuts retain every period",()->{
            Core.Task t=task(fixture,1),tomorrow=Core.toTomorrow(t,"2026-11-04"),next=Core.toNextWeek(t,"2026-11-04");
            eq(tomorrow.kind,"segments");eq(tomorrow.start,"2026-11-05");eq(tomorrow.end,"2026-11-09");
            eq(next.kind,"segments");eq(next.start,"2026-11-09");eq(next.end,"2026-11-13");eq(next.deadline,t.deadline);
        });
        check("next week retains weekdays when the first period starts midweek",()->{
            Core.Task t=task(fixture,1);t.start="2026-11-04";t.end="2026-11-06";
            t.segments=new ArrayList<>(List.of(new Core.PlanPart("day","2026-11-04","2026-11-04"),new Core.PlanPart("day","2026-11-06","2026-11-06")));
            Core.Task next=Core.toNextWeek(t,"2026-11-04");
            eq(next.start,"2026-11-11");eq(next.end,"2026-11-13");eq(next.deadline,t.deadline);
            eq(next.segments.get(0).start,"2026-11-11");eq(next.segments.get(1).start,"2026-11-13");
            eq(t.start,"2026-11-04");
        });
        check("copy equality and operation identity include every inner period",()->{
            Core.Task t=task(fixture,1),copy=t.copy();eq(copy,t);eq(copy.hashCode(),t.hashCode());
            truth(copy.segments!=t.segments);copy.segments.set(1,new Core.PlanPart("range","2026-11-05","2026-11-06"));
            Core.validateTask(copy);truth(!copy.equals(t));truth(copy.hashCode()!=t.hashCode());eq(t.segments.get(1).start,"2026-11-04");
            Core.Op first=new Core.Op("same",t,List.of(),"test","2026-10-30T12:00:00Z"),second=new Core.Op("same",copy,List.of(),"test","2026-10-30T12:00:00Z");
            reject(()->Core.merge(List.of(first),List.of(second)));
        });
        check("editing metadata preserves all periods and labels show the real gaps",()->{
            Core.Task t=task(fixture,1),copy=t.copy();copy.title="新标题";copy.notes="新备注";copy.deadline="2026-11-15";Core.validateTask(copy);
            truth(plan(t).similar(plan(copy)));eq(Core.planLabel(t),"2026-11-02；2026-11-04 — 2026-11-06");
            JSONObject unchanged=JsonCodec.task(t);Core.validateTask(t);truth(JsonCodec.task(t).similar(unchanged));
        });
        check("week filter observes actual range and week periods but excludes empty weeks",()->{
            Core.Task t=task(fixture,2);
            eq(Core.onWeek(t,"2026-11-02"),true);
            eq(Core.onWeek(t,"2026-11-09"),true);
            eq(Core.onWeek(t,"2026-11-16"),false);
            t.segments.set(1,new Core.PlanPart("range","2026-11-18","2026-11-19"));t.end="2026-11-19";
            eq(Core.onWeek(t,"2026-11-09"),false);
        });
        check("range projection renders independent spans with original IDs",()->{
            Core.Task t=task(fixture,1);t.segments.set(0,new Core.PlanPart("range","2026-11-02","2026-11-02"));
            List<Core.Task> parts=Core.renderParts(t);
            eq(parts.size(),2);eq(parts.get(0).id,t.id);eq(parts.get(1).id,t.id);
            eq(Arrays.toString(Core.rangeSpan(parts.get(0),"2026-11-02")),"[0, 1]");
            eq(Arrays.toString(Core.rangeSpan(parts.get(1),"2026-11-02")),"[2, 3]");
            truth(parts.get(0).segments==null);eq(parts.get(1).deadline,t.deadline);
        });
        check("widget daily list counts a shared deadline once and respects range lanes",()->{
            Core.Task t=task(fixture,1);t.deadline="2026-11-04";
            eq(Core.dayTasks(List.of(t),"2026-11-04",true).size(),1);
            eq(Core.dayTasks(List.of(t),"2026-11-04",false).size(),1);
            eq(Core.dayTasks(List.of(t),"2026-11-03",true).size(),0);
            eq(Core.dayTasks(List.of(t),"2026-11-05",false).size(),0);
            eq(Core.dayTasks(List.of(t),"2026-11-05",true).size(),1);
            eq(Core.dayTasks(List.of(t),"2026-11-02",false).size(),1);
        });
        check("strict decoder rejects malformed segment structures",()->{
            JSONObject original=fixture.getJSONArray("operations").getJSONObject(1).getJSONObject("task");
            for(int variant=0;variant<11;variant++){
                JSONObject bad=new JSONObject(original.toString()),p=bad.getJSONObject("plan");JSONArray parts=p.getJSONArray("segments");
                switch(variant){
                    case 0:p.put("segments",new JSONArray());break;
                    case 1:parts.remove(1);break;
                    case 2:p.put("segments",new JSONArray().put(parts.get(1)).put(parts.get(0)));break;
                    case 3:parts.getJSONObject(1).put("start","2026-11-02");break;
                    case 4:p.put("start","2026-11-01");break;
                    case 5:p.put("end","2026-11-07");break;
                    case 6:parts.getJSONObject(0).put("kind","none");break;
                    case 7:parts.getJSONObject(0).put("kind","segments").put("segments",new JSONArray());break;
                    case 8:parts.getJSONObject(0).put("extra",true);break;
                    case 9:parts.getJSONObject(0).put("kind","week");break;
                    default:p.put("kind","range");
                }
                reject(()->JsonCodec.task(bad));
            }
        });
        System.out.println("Multiple-period host tests passed: "+passed);
    }
}
