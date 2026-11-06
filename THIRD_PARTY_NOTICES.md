# 第三方组件说明

随历项目代码按 [Apache-2.0](LICENSE) 发布。第三方文件保留各自的版权和许可声明。

| 随源码分发的组件 | 位置 | 许可与来源 |
| --- | --- | --- |
| Gradle Wrapper 8.14.5 | `android/gradlew`、`android/gradlew.bat`、`android/gradle/wrapper/gradle-wrapper.jar` | Apache-2.0；[Gradle 官方说明](https://docs.gradle.org/current/userguide/gradle_wrapper.html) |

Wrapper 脚本原始版权头保持完整；JAR 内的 `META-INF/LICENSE` 同时保存在 [third_party/gradle-wrapper/LICENSE](third_party/gradle-wrapper/LICENSE)。JAR 的 SHA-256 与 [Gradle 官方校验表](https://gradle.org/release-checksums/)中的 8.14.5 相符。Wrapper 配置也固定了 Gradle 分发 ZIP 的校验值。

完整 Gradle 分发包、Android SDK、Android Gradle Plugin、JDK 和测试时使用的 JSON-java 不随本源码包分发。构建和测试工具会按配置下载所需组件；这些工具和依赖分别适用其上游许可。应用运行时没有第三方 JavaScript 包依赖，Android 应用也没有引入 AndroidX 或 Compose 运行库。

公开截图使用虚构事项，图标和小部件预览为项目内资源；不包含用户照片、个人日历或字体文件。
