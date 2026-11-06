# 同步协议 v1

0.3.0 实现本地 HTTP 与 WebDAV 两种传输，沿用相同操作日志协议。用户在各端单独配置自己的 WebDAV 账户；导出快照不包含连接设置。

## 数据格式

Task JSON：`{id,title,notes,plan:{kind,start,end},deadline,completed,deleted,color}`。0.5.0 新增多段计划，仅当 `kind=segments` 时，plan 含额外的 `segments` 数组。

- id：UUID 字符串；title：非空字符串（上限 300）；notes：字符串；color：六位十六进制颜色，默认 #477766。
- plan.kind：none/day/week/range/segments。none 的 start/end 为 null，其他为 YYYY-MM-DD 日历日期；day 首尾相同，week 为周一至周日，range 包含首尾日期。
- segments 计划的每个子段为 `{kind,start,end}`，kind 仅允许 day/week/range；至少两段，日期升序，不重叠、不嵌套。父计划 start/end 是首段开始和末段结束，期间的间隙不表示已安排。相邻但不重叠的段保持独立；用户操作造成重叠时会合并，零段或一段会回到旧的 none 或单段结构。
- deadline：YYYY-MM-DD 或 null；completed/deleted：boolean。

Operation JSON：`{id,taskId,parents,deviceId,createdAt,task}`。

- id/deviceId 为非空字符串；parents 为操作 ID 数组；createdAt 为 ISO 8601 字符串（仅排序显示，不决定冲突胜负）；task 为完整 Task。
- 每次编辑建立新操作，以该任务已知的当前叶节点 ID 为 parents；ID 相同的操作必须内容相同。
- 不同任务操作独立合并。同一任务出现多个没有继承关系的叶节点时为冲突，双方均保留。选择一方或人工合并时，创建以全部当前叶节点为 parents 的新操作。
- 删除以 task.deleted=true 保存，不移除历史。导入/同步是合并操作，不以文件覆盖本地数据。
- 新操作引用的 parents 必须存在且属于同一任务；拒绝循环、跨任务引用和 ID 内容不一致。网络传入一批操作允许乱序。

Snapshot：`{schemaVersion:1,operations:[...]}`。

### 多段兼容边界（0.5.0）

新客户端读取原有全部单段与历史操作，校验和同步时不向旧记录补字段。多段字段仅出现在实际创建多段的新操作中，独立截止日与完成状态仍属于整个事项。Java 与 JavaScript 使用相同的结构校验和日期语义。

使用多段安排前，参与同步的电脑服务及 Android 应用都需更新到 0.5.0。旧客户端不能识别 segments，会拒绝含有该记录的快照并保留原文件；不会静默改成一整段。操作历史会保留多段记录，因此后来删去一段也不意味着能重新用旧客户端同步。

## JavaScript 核心接口

`shared/core.mjs` 导出：

- `emptyTask(title, id=crypto.randomUUID())` 返回完整默认 Task。
- `validateTask(task)` 返回 task 或抛错；`validateOperation(operation)` 同理。
- `mergeOperations(local,remote)` 校验并合并完整操作集，返回新数组。
- `materialize(operations)` 返回 `{tasks,conflicts,heads}`。tasks 包含每个任务的一个显示版本（包括 deleted），conflicts 为 `[{taskId,heads:[Operation,...]}]`，heads 为 `{[taskId]:[operationId,...]}`。冲突显示版本按 createdAt 再按 id 排序取最后一个，仅用于预览。
- `makeOperation(task,operations,deviceId,options={})` 以当前任务全部 heads 为 parents；options 可以提供 id/createdAt 用于测试。
- `dateAdd(isoDate,days)`、`startOfWeek(isoDate)`、`shiftPlan(task,targetStart)`；shiftPlan 保持范围长度和 deadline 不变，week 归整为目标日期所在周，none 变 day。

## HTTP 传输

服务默认端口 4317、127.0.0.1；显式 `--lan` 才监听 0.0.0.0。

- `GET /api/health` 返回 `{ok:true,schemaVersion:1}`。
- `GET /api/sync` 带 `Authorization: Bearer TOKEN` 返回 Snapshot。
- `POST /api/sync` 带同样认证，body 为 Snapshot；校验整批、原子保存合并后的日志，返回合并后 Snapshot。
- `GET /api/setup` 仅本机回环访问、同源校验通过时返回 `{token,addresses,port}`，供电脑端配对界面。不能从非本机 Host 或跨站 Origin 访问；无 CORS 放行。
- 静态目录为 web/ 和 shared/。用户数据、凭据、日志不作为静态文件。

服务端将数据保存在 .local/，忽略 Git；令牌持久化且不打印。重复操作幂等，非法请求整批拒绝，原文件保持不变。

## 传输接口与 WebDAV

`shared/transports.mjs` 导出 `HttpSyncTransport(baseUrl,token)`，方法 `exchange(snapshot)` 返回合并 Snapshot。

`normalizeWebDavConfig({url,username,password})` 校验完整 HTTP(S) 文件 URL；拒绝嵌入认证、查询参数、片段和路径穿越。用户名/密码同时留空表示匿名，否则必须成对提供。`WebDavTransport(config).exchange(snapshot)` 执行：

1. GET 文件，校验完整 Snapshot，读取可用于条件写入的 ETag；文件不存在（404）作为首次创建。0.3.1 兼容坚果云的无引号版本值，不再只认可标准强 ETag。
2. 合并本地、远端及本轮前次重试已见的全部操作。已有文件使用 `PUT` + `If-Match: "etag"`；首次创建使用 `If-None-Match: *`。
3. 412 重新 GET、合并并重试；最多五次写入尝试，整个交换 30 秒超时。
4. PUT 成功后 GET 回读，确认传出操作及同 ID 内容完整一致，才返回可确认快照。远端回读中新增的合法操作也返回给客户端。

缺少/弱/畸形 ETag、认证错误、重定向、远端损坏、10 MiB 上限、网络异常或回读确认失败均报错，不能更新同步确认。父目录缺失提示用户先建立，不自动向不明共享根递归创建目录。请求不跟随重定向，不在状态/错误中回显 URL、密码或远端响应文本。

0.3.1 的兼容版本值长度为 1–1024 字符，首字符是 ASCII 字母或数字，后续仅允许 `._~+/:=-` 及字母数字，排除 `W/`、`w/` 前缀。该裸值不是 RFC 标准强 ETag；仅原样回传 `If-Match`，不加引号、不改大小写、不替换为 `*`。标准强 ETag 路径照旧。条件更新是否原子执行依赖服务端；读回核验不能弥补服务器忽略条件头的问题。首次创建仍遵循原 `If-None-Match: *` 流程，不能据此保证忽略该头的服务器在多端同时初始化时安全。

兼容性依据：[Super Productivity #5000 原始响应](https://github.com/super-productivity/super-productivity/issues/5000)、[FluentRead 的坚果云兼容说明](https://read.thinkstu.com/guide/webdav)。兼容范围以协议测试和实际服务响应为准。

### 电脑 WebDAV 接口

浏览器不直接连接 WebDAV。网页通过本地 Bearer 认证接口把凭据交给 Node 服务，避免远端 CORS 限制：

- `GET /api/webdav/config`：仅本机回环、同源、Bearer 授权，返回 `{enabled,url,username,hasPassword,configured,revision,status}`，不返回密码。
- `POST /api/webdav/config`：同样限制，body 为 `{enabled,url,username,password?}`。省略 password 仅对相同规范 URL 和用户名保留；显式空串清除。保存不立即发起传输，由设置按钮随后请求同步。
- `GET /api/webdav/status`：Bearer 授权，返回 `{syncing,lastSync,lastError,pending}`。此 pending 表示尚未确认到云端的操作，独立于浏览器到本机服务的确认。
- `POST /api/webdav/sync`：Bearer 授权，body `{}`。成功返回 `{ok:true,status}`，失败返回安全错误与当前 status。本地记录不因云端失败回退。
- `GET /api/version`：返回版本与功能标记，当前电脑服务版本为 0.5.0，功能标记包含 webdav。

Windows 密码使用当前用户的 DPAPI 保护，保存于 `.local/webdav-config.json` 的密文字段；`.local/webdav-state.json` 保存当前配置代次、确认 ID 和成功时间。切换目的地建立新代次、重置云端确认；旧请求结果不得给新目的地更新确认。服务对本地和云端的操作合并共用串行原子写入队列，同步过程中新增的本地操作保持待同步。

Android `WebDavTransport` 直接访问同一文件，密码通过 Android Keystore AES-GCM 加密，配置和同步代次在原生 Store 文件锁内读写。配置切换、清除凭据和旧请求确认使用同一代次检查，不向 WebView 桥、Snapshot、导出文件或 Intent 暴露密码。

协议依据：[RFC 9110 条件请求](https://www.rfc-editor.org/rfc/rfc9110.html#name-conditional-requests)、[RFC 4918 ETag](https://www.rfc-editor.org/rfc/rfc4918.html#section-8.6)。
