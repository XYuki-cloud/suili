package app.flexible.calendar;

import java.util.*;

public class CoreTest {
    static int passed;
    static void eq(Object actual,Object expected) { if (!Objects.equals(actual,expected)) throw new AssertionError("Expected "+expected+" but got "+actual); }
    static void reject(Runnable fn) { try { fn.run(); } catch (IllegalArgumentException e) { return; } throw new AssertionError("Expected rejection"); }
    static Core.Task task() { return new Core.Task("11111111-1111-4111-8111-111111111111","作业 A"); }
    static Core.Op op(String id, Core.Task t, String... parents) { return new Core.Op(id,t,Arrays.asList(parents),"device-test","2026-10-23T12:00:00.000Z"); }
    static void run(String name,Runnable fn) { fn.run(); passed++; System.out.println("PASS "+name); }
    public static void main(String[] args) {
        run("calendar arithmetic crosses month and leap day", ()->{eq(Core.dateAdd("2026-10-31",1),"2026-11-01");eq(Core.dateAdd("2028-02-28",1),"2028-02-29");});
        run("week begins Monday across year", ()->eq(Core.startOfWeek("2027-01-03"),"2026-12-28"));
        run("range shift preserves duration and independent deadline", ()->{Core.Task t=task();t.kind="range";t.start="2026-10-26";t.end="2026-11-01";t.deadline="2026-11-08";Core.Task shifted=Core.shiftPlan(t,"2026-11-03");eq(shifted.end,"2026-11-09");eq(shifted.deadline,"2026-11-08");eq(t.start,"2026-10-26");});
        run("week shift remains full Monday to Sunday", ()->{Core.Task t=task();t.kind="week";t.start="2026-10-26";t.end="2026-11-01";Core.Task s=Core.shiftPlan(t,"2026-11-04");eq(s.start,"2026-11-02");eq(s.end,"2026-11-08");});
        run("unplanned shift becomes a day", ()->{Core.Task s=Core.shiftPlan(task(),"2026-10-24");eq(s.kind,"day");eq(s.start,s.end);});
        run("duplicate replay is idempotent", ()->{Core.Op a=op("a",task());eq(Core.merge(List.of(a),List.of(a)).size(),1);});
        run("concurrent versions both survive and resolution consumes all heads", ()->{Core.Op a=op("a",task());Core.Task t=task();t.title="手机编辑";Core.Op b=op("b",t,"a");Core.Task u=task();u.completed=true;Core.Op c=op("c",u,"a");List<Core.Op> merged=Core.merge(List.of(a,b),List.of(a,c));eq(Core.heads(merged,a.taskId).size(),2);Core.Op d=op("d",t,"b","c");eq(Core.heads(Core.merge(merged,List.of(d)),a.taskId).size(),1);});
        run("unordered incoming parents are accepted", ()->{Core.Op a=op("a",task()),b=op("b",task(),"a");eq(Core.merge(List.of(),List.of(b,a)).size(),2);});
        run("missing parent is rejected", ()->reject(()->Core.merge(List.of(),List.of(op("b",task(),"missing")))));
        run("cycles are rejected", ()->reject(()->Core.merge(List.of(),List.of(op("a",task(),"b"),op("b",task(),"a")))));
        run("ID content collision is rejected", ()->{Core.Task t=task();t.title="different";reject(()->Core.merge(List.of(op("a",task())),List.of(op("a",t))));});
        run("cross task parent is rejected", ()->{Core.Task t=task();t.id="22222222-2222-4222-8222-222222222222";reject(()->Core.merge(List.of(op("a",task())),List.of(op("b",t,"a"))));});
        run("range dates include both endpoints and deadline", ()->{Core.Task t=task();t.kind="range";t.start="2026-10-26";t.end="2026-11-01";t.deadline="2026-11-08";eq(Core.onDay(t,"2026-10-26"),true);eq(Core.onDay(t,"2026-11-01"),true);eq(Core.onDay(t,"2026-11-08"),true);eq(Core.onDay(t,"2026-11-02"),false);});
        run("week plan is not expanded to daily tasks", ()->{Core.Task t=task();t.kind="week";t.start="2026-10-26";t.end="2026-11-01";eq(Core.onDay(t,"2026-10-27"),false);});
        run("invalid dates and malformed weekly ranges rejected", ()->{Core.Task t=task();t.kind="day";t.start=t.end="2026-02-30";reject(()->Core.validateTask(t));t.kind="week";t.start="2026-10-27";t.end="2026-11-02";reject(()->Core.validateTask(t));});
        run("calendar dates are confined to protocol years", ()->{reject(()->Core.date("0000-01-01"));reject(()->Core.dateAdd("9999-12-31",1));});
        run("preview timestamps use JS compatible milliseconds", ()->{Core.Op a=op("a",task()),z=op("z",task());a.createdAt="2026-10-23T12:00:00.0009Z";z.createdAt="2026-10-23T12:00:00.0001Z";List<Core.Op> h=Core.heads(Core.merge(List.of(a),List.of(z)),a.taskId);eq(h.get(h.size()-1).id,"z");});
        run("next week shortcut explicitly changes range into week", ()->{Core.Task t=task();t.kind="range";t.start="2026-10-26";t.end="2026-11-05";t.deadline="2026-11-08";Core.Task n=Core.toNextWeek(t,"2026-10-23");eq(n.kind,"week");eq(n.start,"2026-10-26");eq(n.end,"2026-11-01");eq(n.deadline,t.deadline);});
        run("tomorrow shortcut changes week into a day", ()->{Core.Task t=task();t.kind="week";t.start="2026-10-26";t.end="2026-11-01";t.deadline="2026-11-08";Core.Task n=Core.toTomorrow(t,"2026-10-23");eq(n.kind,"day");eq(n.start,"2026-10-24");eq(n.end,n.start);eq(n.deadline,t.deadline);});
        run("range bar spans inclusive day columns and splits across weeks", ()->{Core.Task t=task();t.kind="range";t.start="2026-10-30";t.end="2026-11-04";eq(Arrays.toString(Core.rangeSpan(t,"2026-10-26")),"[4, 3]");eq(Arrays.toString(Core.rangeSpan(t,"2026-11-02")),"[0, 3]");eq(Arrays.toString(Core.rangeSpan(t,"2026-11-09")),"[-1, 0]");});
        run("stale editor or conflict resolution refuses unseen heads", ()->{Core.Op a=op("a",task()),b=op("b",task(),"a");Core.requireHeads(List.of(a),a.taskId,List.of("a"));reject(()->Core.requireHeads(List.of(a,b),a.taskId,List.of("a")));Core.Op c=op("c",task(),"a");reject(()->Core.requireHeads(List.of(a,b,c),a.taskId,List.of("b")));Core.requireHeads(List.of(a,b,c),a.taskId,List.of("c","b"));});
        run("timestamp wire grammar rejects leap seconds", ()->{Core.Op a=op("a",task());a.createdAt="2026-10-23T23:59:60Z";reject(()->Core.validateOp(a));});
        run("Unicode whitespace validation matches JavaScript without rewriting history", ()->{Core.Task t=task();t.title="\u00a0\ufeff\u3000";reject(()->Core.validateTask(t));Core.Op a=op("a",task());a.deviceId="\u00a0";reject(()->Core.validateOp(a));a.deviceId="device";a.parents=List.of("\u3000");reject(()->Core.validateOp(a));t.title="\u00a0原始标题\u00a0";Core.validateTask(t);eq(t.title,"\u00a0原始标题\u00a0");});
        System.out.println("Core tests passed: "+passed);
    }
}
