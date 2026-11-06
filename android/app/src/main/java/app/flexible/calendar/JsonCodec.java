package app.flexible.calendar;

import org.json.*;
import java.util.*;

/** Credentials never enter the protocol snapshot. Strict readers reject type coercion. */
public final class JsonCodec {
    static void keys(JSONObject object,String... expected) throws JSONException {Set<String> keys=new HashSet<>(Arrays.asList(expected));Iterator<String> actual=object.keys();while(actual.hasNext()){String key=actual.next();if(!keys.remove(key))throw new JSONException("未知字段："+key);}if(!keys.isEmpty())throw new JSONException("缺少字段："+keys.iterator().next());}
    static String string(JSONObject o,String key) throws JSONException {Object v=o.get(key);if(!(v instanceof String))throw new JSONException("字段不是字符串："+key);return (String)v;}
    static String nullable(JSONObject o,String key) throws JSONException {Object v=o.get(key);if(v==JSONObject.NULL)return null;if(!(v instanceof String))throw new JSONException("字段不是日期或 null："+key);return (String)v;}
    static boolean bool(JSONObject o,String key) throws JSONException {Object v=o.get(key);if(!(v instanceof Boolean))throw new JSONException("字段不是布尔值："+key);return (Boolean)v;}
    public static Core.Task task(JSONObject o) throws JSONException {
        keys(o,"id","title","notes","color","completed","deleted","deadline","plan");Core.Task t=new Core.Task(string(o,"id"),string(o,"title"));t.notes=string(o,"notes");t.color=string(o,"color");t.completed=bool(o,"completed");t.deleted=bool(o,"deleted");t.deadline=nullable(o,"deadline");
        JSONObject p=o.getJSONObject("plan");t.kind=string(p,"kind");
        if(t.kind.equals("segments")){keys(p,"kind","start","end","segments");t.segments=new ArrayList<>();JSONArray parts=p.getJSONArray("segments");for(int i=0;i<parts.length();i++){JSONObject part=parts.getJSONObject(i);keys(part,"kind","start","end");t.segments.add(new Core.PlanPart(string(part,"kind"),string(part,"start"),string(part,"end")));}}
        else keys(p,"kind","start","end");
        t.start=nullable(p,"start");t.end=nullable(p,"end");Core.validateTask(t);return t;
    }
    public static JSONObject task(Core.Task t) throws JSONException {
        Core.validateTask(t);JSONObject o=new JSONObject();o.put("id",t.id);o.put("title",t.title);o.put("notes",t.notes);o.put("color",t.color);o.put("completed",t.completed);o.put("deleted",t.deleted);o.put("deadline",t.deadline==null?JSONObject.NULL:t.deadline);JSONObject p=new JSONObject();p.put("kind",t.kind);p.put("start",t.start==null?JSONObject.NULL:t.start);p.put("end",t.end==null?JSONObject.NULL:t.end);
        if(t.kind.equals("segments")){JSONArray parts=new JSONArray();for(Core.PlanPart part:t.segments)parts.put(new JSONObject().put("kind",part.kind).put("start",part.start).put("end",part.end));p.put("segments",parts);}
        o.put("plan",p);return o;
    }
    public static List<Core.Op> decode(String raw) throws JSONException {JSONTokener parser=new JSONTokener(raw);Object value=parser.nextValue();if(!(value instanceof JSONObject)||parser.nextClean()!=0)throw new JSONException("无效的完整 JSON 快照");JSONObject root=(JSONObject)value;keys(root,"schemaVersion","operations");Object version=root.get("schemaVersion");if(!(version instanceof Number)||((Number)version).doubleValue()!=1)throw new JSONException("不支持的数据版本");JSONArray a=root.getJSONArray("operations");List<Core.Op> ops=new ArrayList<>();for(int i=0;i<a.length();i++){JSONObject o=a.getJSONObject(i);keys(o,"id","taskId","parents","deviceId","createdAt","task");List<String> parents=new ArrayList<>();JSONArray p=o.getJSONArray("parents");for(int j=0;j<p.length();j++){Object v=p.get(j);if(!(v instanceof String))throw new JSONException("parent 非字符串");parents.add((String)v);}Core.Op op=new Core.Op(string(o,"id"),task(o.getJSONObject("task")),parents,string(o,"deviceId"),string(o,"createdAt"));op.taskId=string(o,"taskId");ops.add(op);}return Core.merge(Collections.emptyList(),ops);}
    public static String encode(List<Core.Op> ops) throws JSONException {JSONArray a=new JSONArray();for(Core.Op op:ops){JSONObject o=new JSONObject();o.put("id",op.id);o.put("taskId",op.taskId);o.put("parents",new JSONArray(op.parents));o.put("deviceId",op.deviceId);o.put("createdAt",op.createdAt);o.put("task",task(op.task));a.put(o);}return new JSONObject().put("schemaVersion",1).put("operations",a).toString();}
}
