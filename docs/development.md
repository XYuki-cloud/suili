# 开发指南

本文介绍源码结构、开发入口和验证方法。命令默认从项目根目录运行，Android 命令另有说明。开发与验证应使用虚构测试数据和隔离环境，真实日程、同步地址、凭据及设备日志应保留在仓库之外。

## 环境与版本

| 部分 | 要求／当前版本 |
| --- | --- |
| Node.js | 22 或更新版本 |
| 桌面／网页版本 | 0.5.0，见 `package.json` |
| Android 版本 | 0.5.0，`versionCode 9`，见 `android/app/build.gradle` |
| Android JDK | 17 |
| Android SDK | compileSdk／targetSdk 35，minSdk 26 |
| Android Gradle Plugin | 8.8.1 |
| Gradle Wrapper | 8.14.5 |

Node 运行时与测试使用标准库，无 npm 运行依赖。Android 应用运行时使用平台 API，Gradle、插件、SDK 和主机测试依赖需预先取得。当前桌面启动器与 WebDAV 密码保护使用 Windows 功能，其他桌面系统的完整使用流程尚待验证。

## 目录结构

| 路径 | 职责 |
| --- | --- |
| `web/` | 共享日历界面、日期布局、指针交互、浏览器／原生存储适配和离线缓存 |
| `shared/core.mjs` | 事项、操作日志、因果关系、合并与冲突规则 |
| `shared/transports.mjs` | 本地 HTTP 与 WebDAV 传输、URL 和响应校验 |
| `server/` | Node 本地服务、原子存储、电脑 WebDAV 同步与凭据保护 |
| `tests/` | Node 测试与隔离 WebDAV 测试服务 |
| `android/app/src/main/` | 原生日历宿主、Store、同步器、文件操作和桌面小部件 |
| `android/app/src/androidTest/` | Android 平台、Keystore、WebView 和小部件宿主检查 |
| `android/tests/` | 可在主机 JDK 上运行的 Java 检查 |
| `docs/` | 使用与开发文档、协议说明及公开示例截图 |

## 电脑端开发

```powershell
node --version
npm start
```

在 [http://127.0.0.1:4317](http://127.0.0.1:4317) 打开界面。静态资源直接来自 `web/` 和 `shared/`。修改后刷新页面，离线缓存采用联网优先方式，开发时应确认拿到新资源。浏览器开发工具可用于检查页面缓存和网络响应。

以下参数可切换端口或启用局域网访问。

```powershell
node server/server.mjs --port 4318
node server/server.mjs --lan
```

默认只监听回环地址，`--lan` 监听局域网接口。测试应使用独立的数据目录。需要隔离服务时，可在测试代码中调用 `createServer({dataDir, port})`，使用临时目录和空闲端口，结束后调用 `close()` 释放锁与监听。

网页通过 Web Lock 保证同一浏览器同时只有一个编辑页面。客户端数据在浏览器站点存储，服务数据默认在 `.local/`，两者通过操作记录合并。排查问题前应先导出备份并保留已有数据。

## 数据与同步约束

事项支持 `none`、`day`、`week`、`range`、`segments` 五种计划，截止日期独立保存。`segments` 包含至少两个按日期升序、互不重叠的单日、周或范围子段，父计划的首尾日期仅表示整体边界。每次修改建立操作，引用已看到的父版本，冲突由因果关系判断，设备时间只用于显示排序。

多段安排从 0.5.0 开始支持。参与同步的电脑服务与 Android 应用均需使用 0.5.0 或更新版本，旧客户端会拒绝含多段记录的快照。保留旧历史的原始字段，仅在新建多段操作时写入 `segments`。渲染、拖动和小部件应通过已有 `planParts`／`renderParts` 逻辑处理各段，避免把段间空白当作连续安排。

修改核心、拖动、撤销、导入或同步时，需要保留以下行为。

- 通过操作记录合并历史，删除也建立操作并保留记录。
- 保存编辑、拖动和批量修改前检查已看到的版本，发现同步更新时拒绝过时的编辑。
- WebDAV 写入使用条件请求，遇到并发重新读取并合并，写后回读确认才清除相应待同步状态。
- 切换同步目的地或凭据后，旧请求不能替新配置确认成功。
- 备份只导出协议快照，不包含同步凭据。

详细字段、HTTP 接口和 ETag 处理见 [同步协议](sync-contract.md)。

## 自动化检查

在项目根目录运行 Node 检查。

```powershell
npm test
```

测试覆盖共享核心、日历布局、拖动计算、本地存储、原生桥适配、HTTP 服务、凭据处理与 WebDAV。命令的实际输出才代表本次运行结果，文档不固定测试数量。

配置 `JAVA_HOME` 为 JDK 17 后，运行以下主机检查。

```powershell
Set-Location android
.\test-core.ps1
.\test-widget.ps1
.\test-webdav.ps1
.\tests\run-multiple-periods.ps1
```

脚本可通过 `-JavaHome` 覆盖环境选择。WebDAV 主机测试会按需下载固定版本 JSON-java，核对 SHA-256，并存放在被忽略的构建目录。该依赖的使用范围为主机测试。

多段检查包含 Java 日期／复制／布局投影测试，以及 Node → Java → Node 的实际 JSON 往返比较，旧历史操作和多段记录均须保持原内容。涉及“移到下周”时，也比较首段不在周一的两端结果。

验证应覆盖改动影响的入口与运行环境。

- 核心协议需运行相应 Node 和 Java 检查。
- 同步变更需覆盖竞态、失败与回读。
- HTML／CSS 需检查实际桌面、手机布局及手势。
- 小部件变更需在 Android 宿主上检查不同尺寸，并记录设备或模拟器范围。

构建、纯逻辑测试和实际界面检查应分别记录结果。

## Android 构建

先安装 JDK 17、Android API 35 SDK 和构建工具，设置 `JAVA_HOME` 与 `ANDROID_HOME`。个人 SDK 目录使用环境变量或本机生成的 `local.properties` 配置，后者应保持 Git 忽略。

在 `android/` 运行构建脚本。

```powershell
# 首次取得依赖，需要网络与已接受的 SDK 许可
.\build.ps1 -Online

# 已有完整缓存时使用离线模式
.\build.ps1
```

默认使用 Gradle 8.14.5 Wrapper，也可直接运行 `.\gradlew.bat --no-daemon :app:assembleDebug`。`syncPlannerAssets` 会把共享 `web/`、`shared/` 源文件复制进 APK，因此网页修改也需要重新构建 Android 包。

主日历由 `PlannerActivity` 加载固定本地来源的资源，网络请求由原生同步层执行。WebView 桥处理协议快照和原生操作，确认记录由原生同步器维护。修改时应继续使用资源白名单与原生 Store。

更多安装、签名与小部件说明见 [Android README](../android/README.md)。

## Android instrumentation

使用专用测试设备或隔离的测试环境。部分界面检查会打开主界面，已配置的自动同步可能正常触发，应使用专用空白 WebDAV 文件。

在 `android/` 构建并安装应用与测试 APK，然后运行协议检查。

```powershell
.\gradlew.bat --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w app.flexible.calendar.test/app.flexible.calendar.ProtocolInstrumentation
```

连接多台设备时，请为每条命令加 `-s SERIAL`，并将 `SERIAL` 替换为所选测试设备的序列号。`ProtocolInstrumentation` 检查 Android 平台 JSON、原子存储、历史合并、版本检查和共享界面加载。`WebDavInstrumentation` 包含隔离存储与 Keystore 检查，可单独指定 runner。

```powershell
adb shell am instrument -w app.flexible.calendar.test/app.flexible.calendar.WebDavInstrumentation
```

小部件渲染检查需要测试 Host 的系统绑定权限。`WidgetRenderInstrumentation` 是独立入口，不能只因测试 APK 已安装就认为普通桌面小部件可用。使用前阅读对应测试源码，在测试设备上临时授予所需权限，结束后撤销。外部 WebDAV 互操作检查应使用专用空白文件，凭据不写入提交、命令历史或公开输出。

## 版本、签名与交付

桌面和 Android 版本分别维护。更新桌面版本时核对 `package.json` 与服务版本响应，修改离线界面后核对 Service Worker 缓存版本。Android 更新时核对 `versionName`、递增的 `versionCode` 和打包资源。

debug 签名只用于开发。正式发行应创建并长期使用自己的 release 签名，私钥和密码放在仓库之外，通过本机或 CI 的秘密管理注入。当前项目的发布签名需由发行者配置。相同包名的 APK 覆盖安装需要兼容签名，更换签名前先完成可恢复的备份。

提交前检查 diff 和状态，运行与改动相关的检查。不要提交 `.local/`、构建输出、APK、本机 SDK 配置、密钥、账号、连接码、真实事项备份或个人设备日志。公开截图必须使用虚构数据，并检查界面、地址栏和文件元数据。

公开说明应分别报告源码检查、自动测试、构建与设备／桌面验证的范围，并列出实际使用的 Android 环境、桌面与 WebDAV 服务。贡献流程见 [贡献指南](../CONTRIBUTING.md)，数据处理见 [隐私说明](../PRIVACY.md)，许可证见 [Apache License 2.0](../LICENSE)。
