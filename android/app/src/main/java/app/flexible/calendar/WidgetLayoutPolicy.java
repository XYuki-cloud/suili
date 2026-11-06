package app.flexible.calendar;

/** DP budgets match widget.xml / widget_compact.xml; font line heights are measured by Android. */
final class WidgetLayoutPolicy {
    final int fixedHeightDp,rowHeight,maxDateLineDp,weekBarHeightDp,dayVerticalPaddingDp,maxItems,maxRanges;
    final boolean compactRoot,compact,datesOnly,showWeekBar,showDayOverflow;
    static int clampFontSize(int value){return Math.max(6,Math.min(14,value));}
    WidgetLayoutPolicy(int height,int weeks,int dateLineDp,int itemLineDp){
        if(weeks<1)throw new IllegalArgumentException("weeks must be positive");
        dateLineDp=Math.max(1,dateLineDp);itemLineDp=Math.max(1,itemLineDp);
        compactRoot=height<=300||Math.max(0,height-92)/weeks<dateLineDp+20;
        // Compact: 3dp root padding on each side, 22dp title, 12dp weekdays; no footer.
        fixedHeightDp=compactRoot?40:92;
        dayVerticalPaddingDp=compactRoot?0:2;
        rowHeight=Math.max(0,height-fixedHeightDp)/weeks;
        int cellInsets=2+2*dayVerticalPaddingDp; // 1dp margins above and below each cell.
        maxDateLineDp=Math.max(1,rowHeight-cellInsets);
        int fittedDateLine=Math.min(dateLineDp,maxDateLineDp);
        weekBarHeightDp=Math.max(14,itemLineDp);
        // Preserve one task line before spending a row's limited space on the week heading.
        showWeekBar=rowHeight>=fittedDateLine+cellInsets+weekBarHeightDp+itemLineDp+2;
        int bodySpace=Math.max(0,rowHeight-fittedDateLine-cellInsets-(showWeekBar?weekBarHeightDp:0));
        // Reserve actual 20dp range rows + 16dp range overflow only when they fit alongside tasks.
        maxRanges=!showWeekBar?0:bodySpace>=2*itemLineDp+56?2:bodySpace>=2*itemLineDp+36?1:0;
        int available=bodySpace-maxRanges*20-(maxRanges>0?16:0);
        maxItems=Math.max(0,Math.min(2,available/itemLineDp));
        showDayOverflow=maxItems>0&&available>=(maxItems+1)*itemLineDp;
        compact=maxItems==0;
        datesOnly=compact&&!showWeekBar;
    }
}
