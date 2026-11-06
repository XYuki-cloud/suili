package app.flexible.calendar;

public final class WidgetLayoutPolicyTest {
    private static int checks;
    private static void check(boolean value){checks++;if(!value)throw new AssertionError("layout check "+checks);}
    public static void main(String[] args){
        WidgetLayoutPolicy minimum=new WidgetLayoutPolicy(160,6,17,17);
        check(minimum.compactRoot);
        check(minimum.fixedHeightDp==40);
        check(minimum.rowHeight==20);
        check(minimum.maxDateLineDp>=17);
        check(minimum.datesOnly&&minimum.compact);
        check(minimum.maxItems==0&&minimum.maxRanges==0);
        WidgetLayoutPolicy defaultSize=new WidgetLayoutPolicy(180,6,17,17);
        check(defaultSize.rowHeight>=23);
        check(defaultSize.maxDateLineDp>=17);
        check(defaultSize.datesOnly);
        WidgetLayoutPolicy enlargedSystemFont=new WidgetLayoutPolicy(160,6,34,34);
        check(enlargedSystemFont.datesOnly);
        check(enlargedSystemFont.maxDateLineDp==18);
        WidgetLayoutPolicy medium=new WidgetLayoutPolicy(300,6,12,10);
        check(medium.compactRoot&&!medium.datesOnly);
        check(medium.maxItems>=1);
        WidgetLayoutPolicy large=new WidgetLayoutPolicy(500,4,12,10);
        check(!large.compactRoot&&!large.compact);
        check(large.maxItems>0&&large.maxRanges>0);
        check(large.weekBarHeightDp+12+6+large.maxItems*10+10+large.maxRanges*20+16<=large.rowHeight);
        check(WidgetLayoutPolicy.clampFontSize(1)==6);
        check(WidgetLayoutPolicy.clampFontSize(20)==14);
        check(WidgetLayoutPolicy.clampFontSize(10)==10);
        check(new WidgetLayoutPolicy(180,4,7,7).maxDateLineDp>=7);
        WidgetLayoutPolicy tinyFont=new WidgetLayoutPolicy(160,6,7,7);
        check(tinyFont.maxItems>=1);
        check(!tinyFont.showWeekBar&&!tinyFont.showDayOverflow);
        check(new WidgetLayoutPolicy(180,6,7,7).maxItems==2);
        check(new WidgetLayoutPolicy(180,6,11,10).maxItems>=1);
        System.out.println("Widget layout policy tests passed: "+checks);
    }
}
