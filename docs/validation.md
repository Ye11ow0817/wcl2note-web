# 移植验证记录

日期：2026-09-07。原 Windows 基线 `3c96974244a06314c0683fd6cf49b6818c1fe96b`。

原工作区仅两份迁移文档未提交；未编辑 Windows 源文件、凭据或 Git 历史。原 .NET 测试：46 通过，0 失败，0 跳过。

## 本地功能与证据

| 功能                                         | 实现                                  | 验证                                 |
| -------------------------------------------- | ------------------------------------- | ------------------------------------ |
| URL/query/hash 优先级、fight=last、pull 优先 | domain/report.ts                      | 单元与 E2E                           |
| 无选择器等待选战斗、切换清空                 | app/App.tsx                           | E2E                                  |
| 全程、Pull 零起点、阶段整场起点              | domain/report.ts、group.ts            | 区间测试                             |
| Cast/Buff/Debuff 获得者映射                  | domain/group.ts                       | 单元与 E2E                           |
| 主人/宠物/实例、友方隐藏召唤物               | domain/group.ts                       | 单元与 E2E                           |
| 同来源实例合并同步、不同来源分离             | selection key、visibleGroups          | 单元与 E2E                           |
| 跨事件选择、阶段保留、清除全部               | app/App.tsx                           | E2E                                  |
| 时间排序、同秒、编号、职业、图标开关         | domain/format.ts                      | 192 组原 C# 导出器对照；另有边界测试 |
| 双侧分页、无效游标、取消                     | infrastructure/client.ts              | 单元与 E2E                           |
| 固定操作与参数限制                           | shared/contract.ts、server/gateway.ts | 网关单元测试                         |
| 默认 OAuth、自定义 AES-GCM Cookie、身份隔离  | server/gateway.ts、app/App.tsx        | mock 测试，不等于真实 OAuth          |
| 复制失败提示、UTF-8 下载、窄屏               | app/App.tsx                           | Edge E2E                             |

已执行结果：

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm test`：249 项通过，其中 192 项为原 C# 导出器的逐字符对照，差异为零（只归一化换行）。
- `npm run build`：前端与 EdgeOne 函数构建通过；打包后入口本地烟测通过（health 200、非法操作 400、no-store、请求 ID）。
- `npm run test:e2e`：14 项通过，包含桌面和 390×844 窄屏；另重跑两项导出流程，核对实际 UTF-8/CRLF 下载内容并生成截图，通过。
- `npm audit --omit=dev`：生产依赖已知漏洞为 0。此记录不是全部开发工具依赖的审计结论。
- 页面截图已人工查看：[桌面](screenshots/desktop.png)、[窄屏](screenshots/mobile.png)。截图使用脱敏测试报告，不是真实在线 WCL 数据。

本地 Node 22.16.0、npm 10.9.2、Microsoft Edge 152.0.4191.66。前端 dist 扫描未包含服务端凭据变量名、SESSION_KEY、OAuth token 地址或 client_credentials 授权参数。

最终交付目录 `F:\CodexProjects\wcl2note-web` 已独立执行 `npm ci` 和 `npm run build`，均通过，前端产物哈希与工作区构建一致。独立本地 Git 仓库已初始化，未创建远端或提交；初始分支 `codex/initial-web`。

已下载并校验官方 `edgeone@1.6.34` tarball，检查其 init 模板确认默认目录为 `edge-functions`、命名导出 `onRequest`；同时确认旧 `functions` 只是兼容路径。本轮没有登录或运行云端调试。

## 已明确差异

- 名称 wcl2mrt → wcl2note；输出 MRT 协议不变。
- 桌面持久化 Secret → 浏览器临时输入及最多 1 小时加密 HttpOnly Cookie；刷新回到共享模式。
- Windows 保存对话框 → 浏览器下载，CRLF、UTF-8，无 BOM。
- UI 按网页尺寸排版；来源树常驻，可访问全部实例。没有新增默认排序/搜索或账户系统。
- npm 替代计划中的 pnpm；使用精确依赖及 package-lock.json。

## 待完成的外部验收

用户明确尚未创建 EdgeOne 项目。因此未创建远端资源、未部署、没有生产 URL。以下仍待完成：

1. 目标账户/区域、CLI 模板与实际函数运行时、生产分支/域名确认。
2. 真实共享/自定义 WCL OAuth、公开报告、长报告、配额及服务端出站连接。
3. 预览/生产环境配置与全局限流，真实报告双端逐字符对照。
4. Windows 应用实际交互截图；当前桌面证据为源码、46 项测试和真实导出器 fixture。
5. Chrome 独立版本及 Firefox/Safari 烟测；Edge 窄屏仿真不是手机或 Safari 实机证明。

本地通过不能标记上述上线门槛完成。
