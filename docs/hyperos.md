# Android 小部件与小米澎湃系统

随历默认构建使用标准 Android AppWidget。小米桌面的普通安卓小部件入口，与小米小部件中心／负一屏的审核接入属于不同能力。

## 普通小部件

应用里打开“设置 → 添加桌面小部件”，原生面板提供：

- 日期和事项两个 6–14 sp 字号滑条，默认 9／8 sp，影响本机全部桌面组件。
- 添加普通小部件、系统添加方法和刷新。
- 系统是否识别 Provider、当前绑定数量、添加请求／回调状态。

默认网格目标为 4×3，内容最小尺寸为 250×180 dp，可缩至 210×160 dp，允许调整宽度和高度。小尺寸缩减边距和标题区，按实际字高尽量保留事项；放不下时保留日期与事项提示。新添加组件使用默认目标，已有组件可长按边框缩小。

具体占用格数、边框与可缩范围由系统桌面决定。Android 12 及以后支持目标网格属性的桌面会参考 `targetCellWidth`／`targetCellHeight`，旧版使用 dp 最小尺寸回退。[Android 尺寸说明](https://developer.android.com/develop/ui/views/appwidgets/layouts)

## 小米桌面的添加入口

通常可按以下路径查找：

1. 在桌面空白处双指捏合，选择添加小部件。
2. 打开搜索，找到“安卓小部件”；部分桌面版本可能位于“全部”或页面底部。
3. 找到“随历 · 月历与四周”，添加后长按调整边框。
4. 返回随历查看绑定状态；如果桌面不支持应用内添加，使用系统入口。

应用显示“已发出请求”仅表示桌面接受了添加请求。成功回调和重新查询到的绑定 ID 才提供进一步证据；即使已有绑定，实际画面和点击仍需在桌面确认。`exported=false` 是标准 Provider 的有意设置，不应为尝试适配而直接放开。[Android 添加接口](https://developer.android.com/reference/android/appwidget/AppWidgetManager#requestPinAppWidget(android.content.ComponentName,%20android.os.Bundle,%20android.app.PendingIntent))

小米在线组件搜索结果与“安卓小部件”列表不同，入口名称也可能随桌面版本变化。[小米适配 FAQ](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1591)、[设计规范](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1664)

## 负一屏和实验构建

普通包只注册 `CalendarWidget`，不注册小米实验 Provider，也不声明应用级 `miuiWidgetVersion`。当前项目未完成小米组件中心审核，不能保证负一屏添加。

`miuiExperimental` 构建保留实验性 MIUI 声明，供官方接入和测试流程使用，不属于默认交付：

```powershell
cd android
.\gradlew.bat :app:assembleMiuiExperimental
```

实验构建与普通包使用相同 application ID，测试时先保留数据。系统能力检测通过不代表审核或收录成功；侧载包也不等于已进入负一屏。[小米上传指南](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1588)

## 验证边界

宿主测试验证布局预算和状态逻辑；专用 Android 测试在隔离模拟器上绑定真实 AppWidgetHost、加载 RemoteViews 并检查文字和删除 ID 刷新。这些内容矩形测试不包含桌面网格吸附、宿主外边距、小米组件选择器或负一屏。

反馈问题时可描述“列表找不到”“请求后无绑定”或“已绑定但显示异常”，并提供已脱敏的系统版本和步骤。不要公开真实事项、同步地址、账户或完整备份。
