# 随历 Android

Android 应用提供与电脑相同的完整日历界面，并通过原生 Java 实现持久存储、同步、文件导入导出和桌面小部件。界面资源随 APK 打包，打开日历不依赖电脑或外部网页。

当前版本 **0.5.0**（`versionCode 9`），包名 `app.flexible.calendar`。最低声明 Android 8.0（API 26），编译与目标 API 均为 35。应用运行时使用 Android 平台 API，不依赖 AndroidX、Compose 或第三方运行库；构建工具和主机测试仍需相应依赖。

日常操作和双端同步配置见 [使用指南](../docs/getting-started.md)，项目总览见 [主 README](../README.md)。

## 从源码构建

需要：

| 工具 | 版本／配置 |
| --- | --- |
| JDK | 17，配置 `JAVA_HOME` |
| Android SDK | 安装 API 35 平台与所需构建工具，配置 `ANDROID_HOME` |
| Android Gradle Plugin | 8.8.1，由项目声明 |
| Gradle | 8.14.5，使用仓库中的 Wrapper |

可在 Android Studio 的 SDK Manager 中安装 SDK。`ANDROID_HOME` 指向本机 SDK 目录；若也设置了 `ANDROID_SDK_ROOT`，应指向同一个目录。也可以让 Android Studio 创建本机专用的 `local.properties`，不要提交该文件。

下面的 PowerShell 示例应从仓库根目录执行。先将环境变量设为自己机器上的 JDK 与 SDK 安装目录，再检查工具：

```powershell
$env:JAVA_HOME = "你的 JDK 17 安装目录"
$env:ANDROID_HOME = "你的 Android SDK 安装目录"
& "$env:JAVA_HOME/bin/java.exe" -version
Test-Path "$env:ANDROID_HOME/platforms/android-35/android.jar"
Set-Location android
```

首次构建需要下载 Gradle、插件和相关依赖，并提前接受 SDK 许可：

```powershell
.\build.ps1 -Online
```

已准备好依赖缓存时可离线构建：

```powershell
.\build.ps1
```

脚本支持 `-JavaHome` 指定 JDK、`-Gradle` 指定 Gradle 启动文件。也可直接使用 Wrapper，或在 Android Studio 中打开 `android/`：

```powershell
.\gradlew.bat --no-daemon :app:assembleDebug
```

构建产物位于 `app/build/outputs/apk/debug/app-debug.apk`。这是本机生成的开发签名 APK，不是项目预先提供的正式发行包。

## 安装、升级与签名

可以在手机上打开自己构建的 APK 安装，也可以使用 Android SDK Platform Tools：

```powershell
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

连接多台设备时，用 `adb -s SERIAL ...` 选择目标，将 `SERIAL` 替换为所选测试设备的序列号。安装前确认手机允许该安装来源。

**同一包名必须使用兼容签名才能覆盖安装。** 不同电脑生成的 debug 密钥可能不同，debug 包与自己的 release 包通常也不能互相覆盖。更换签名如需卸载旧应用，应先导出备份并确认文件可读取；卸载会移除应用私有数据与凭据，重新安装后还需要重新配置同步。

正式分发应建立并持续使用自己的发布签名，可通过 Android Studio 的签名向导生成 APK。妥善保管密钥、密码和恢复副本；不要提交 `.jks`、`.keystore`、签名配置、密码或带凭据的构建日志。当前 Gradle 文件未配置统一的项目发布密钥。

## 首次使用与同步

安装后即可离线录入和安排事项。点击“设置与同步 → 同步设置”，选择“本地电脑”或“WebDAV”，填写自己的连接信息。

- **WebDAV**：两端使用同一个专用 JSON 文件地址；手机直接连接远端，电脑可以关机。父目录需提前创建。“测试连接”只读校验，保存后可点击“立即同步已保存配置”。
- **本地电脑**：电脑先用局域网模式启动，手机填写电脑设置页显示的局域网地址与连接码。只在可信网络使用 HTTP；普通手机连接中的 `127.0.0.1` 指向手机自身。
- **离线与冲突**：已提交的事项先保存到本机，联网后合并操作记录。同一事项的并发版本会保留，用户在冲突界面选择版本。

自动同步默认开启，在配置成功、回到应用和本地修改后触发；后台通过系统调度申请约每 30 分钟同步。省电、网络和厂商后台限制可能延迟任务；关闭自动同步后，手动同步仍可使用。

完整的 [WebDAV 配置、备份与恢复步骤](../docs/getting-started.md) 应在更换设备、重装或更换签名前阅读。应用不通过 Android 自动备份恢复数据；请主动导出 JSON 备份。备份包含操作历史，不包含同步凭据。

## 桌面小部件

在应用“设置与同步 → 添加桌面小部件”中打开小部件面板，点击“添加普通桌面小部件”并完成桌面确认。也可长按主屏空白处，通过系统“小部件”入口添加“随历 · 月历与四周”。请求发出与实际绑定是不同状态，面板可查看绑定结果。

- 默认请求约 **4×3**，支持横向、纵向缩放；长按小部件边框调整大小。实际格数与最小尺寸由桌面决定。
- 日期和事项字号分别提供 **6–14 sp** 滑条，默认分别为 **9 sp／8 sp**；修改后保存并刷新全部随历小部件，与主日历字号分开设置。
- 支持整月／连续四周、前后翻页、单日事项、跨周范围、独立周事项和截止日提示。点击日期或事项进入应用查看。
- 小尺寸优先压缩间距并隐藏部分周栏、底栏；内容过多时显示数量或圆点提示，需要进入应用查看完整内容。
- 本地修改和同步结果会请求刷新小部件，网络同步与后台刷新仍受系统调度限制。

小米澎湃／MIUI 桌面可能把普通组件放在“安卓小部件”入口。**普通 Android 小部件不等于小米小部件中心或负一屏组件**；负一屏尚未通过平台审核，不能保证可添加。普通构建只注册标准 Provider，`miuiExperimental` 构建属于显式实验选项，不代表正式接入。

## 测试

在 `android/` 中运行主机检查：

```powershell
.\test-core.ps1
.\test-widget.ps1
.\test-webdav.ps1
```

三个脚本分别覆盖日期与操作协议、规划资源限制、小部件添加与布局策略、WebDAV 条件写入和冲突合并等逻辑。WebDAV 主机测试首次运行会从 Maven Central 下载固定版本的 JSON-java 并校验 SHA-256；该依赖只用于测试，不进入 APK。

Android 平台解析、原子存储、Keystore、WebView 与真实小部件宿主行为还需要设备或模拟器检查。运行 instrumentation 的方法和范围见 [开发指南](../docs/development.md)。主机测试通过或 APK 构建成功，不能单独证明所有手机、桌面或小米负一屏兼容。

## 实现概览

- `PlannerActivity` 从固定本地 HTTPS 来源加载打包资源，通过 `SuiliNative` 桥读写原生 Store；同步网络由原生层完成。
- `Store` 使用应用私有目录、文件锁和原子写入；主界面、同步器与小部件共享同一份事项历史。
- WebDAV 密码由 Android Keystore 保护，配置不进入网页事项数据或 JSON 备份。详细行为见 [隐私说明](../PRIVACY.md)。
- 构建任务 `syncPlannerAssets` 自动复制仓库中的 `web/` 与 `shared/` 源文件，修改网页后需要重新构建 APK。

当前未保证所有 API 26 设备、WebView 版本、桌面实现或后台省电策略都兼容。请保持系统 WebView 更新，并在目标环境验证安装、编辑、离线重启、同步和小部件显示。进程结束后，未提交的输入和编辑草稿不保证恢复。

项目采用 [Apache License 2.0](../LICENSE)。贡献前请阅读 [贡献指南](../CONTRIBUTING.md)。
