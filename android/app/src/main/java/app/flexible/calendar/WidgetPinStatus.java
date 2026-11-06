package app.flexible.calendar;

/** A request result never substitutes for a live AppWidgetManager binding. */
final class WidgetPinStatus {
    static String message(String state,int callbackId,int[] boundIds){
        if("callback".equals(state)){
            for(int id:boundIds)if(id==callbackId)return "系统已确认绑定普通桌面小部件（ID "+id+"）。返回桌面查看实际显示。";
            return "收到过系统添加回调，当前未查到该绑定；可能尚未完成或已被移除。";
        }
        if("requested".equals(state))return "已发出添加请求，尚未确认绑定。请在桌面确认；没有弹窗时按系统方法手动添加。";
        if("rejected".equals(state))return "桌面未接受此次添加请求。请按系统方法手动添加。";
        if("unsupported".equals(state))return "当前桌面不支持应用内添加，请按系统方法手动添加。";
        if("error".equals(state))return "此次添加请求未完成，请按系统方法手动添加。";
        return "尚未从应用发起添加请求。也可以直接在桌面手动添加。";
    }
}
