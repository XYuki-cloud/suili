package app.flexible.calendar;

/** Host checks for the distinction between a pin request, callback and live binding. */
public final class WidgetPinStatusTest {
    private static int checks;
    private static void contains(String actual,String expected){checks++;if(!actual.contains(expected))throw new AssertionError(actual+" should contain "+expected);}
    public static void main(String[] args){
        contains(WidgetPinStatus.message("requested",-1,new int[0]),"尚未确认绑定");
        contains(WidgetPinStatus.message("requested",-1,new int[]{12}),"尚未确认绑定");
        contains(WidgetPinStatus.message("callback",12,new int[]{12}),"系统已确认绑定");
        contains(WidgetPinStatus.message("callback",12,new int[]{13}),"当前未查到该绑定");
        contains(WidgetPinStatus.message("callback",0,new int[0]),"当前未查到该绑定");
        contains(WidgetPinStatus.message("rejected",-1,new int[]{12}),"未接受此次添加请求");
        contains(WidgetPinStatus.message("unsupported",-1,new int[0]),"手动添加");
        contains(WidgetPinStatus.message("",-1,new int[]{12}),"尚未从应用发起");
        System.out.println("Widget pin state tests passed: "+checks);
    }
}
