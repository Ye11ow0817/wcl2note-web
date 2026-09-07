# EdgeOne Pages 部署与回滚

目前用户尚未创建 Pages 项目，本仓库没有关联任何账号、项目或域名；以下为待执行步骤，不是部署成功记录。

## 配置

1. 在目标腾讯云账户创建独立 Pages 项目，建议名 `wcl2note-web`，选择实际服务区域，导入本项目的独立 Git 仓库。不要导入 Windows 仓库历史。
2. 使用根目录，安装 `npm ci`，构建 `npm run build`，输出 `dist`。`edgeone.json` 已写入这些选项及官方预装 Node 22.11.0。以该账户实际支持的运行时为准；验证后再调整版本锁。
3. 配置服务端 `WCL_CLIENT_ID`、`WCL_CLIENT_SECRET`、`SESSION_KEY`。使用新签发的共享凭据；旧 Windows 凭据的轮换由所有者协调，避免中断仍使用旧应用的人。
4. 构建脚本把服务端代码打成不依赖 Node 的 ES module，生成 `edge-functions/api/wcl/[[path]].js`，导出命名 `onRequest`。已下载并校验官方 CLI 1.6.34，其 init 模板默认生成 `edge-functions/helloworld-edge/index.js` 并导出命名 `onRequest`；本项目采用这一约定。CLI 仍兼容旧 `functions`，但本项目不混用两套目录。创建项目后仍需预览验证实际运行时。
5. Git 构建优先。手工 CLI 部署时不能只上传前端 dist；按官方说明把 `edge-functions`、`package.json`、`edgeone.json` 和静态文件一并放入上传目录。CLI 所需项目名/账号授权由所有者提供，不在脚本硬编码 token。
6. 配置平台级访问频率和 WCL 配额保护。代码的每实例计数只是局部保护，不是全局限流；Origin 校验也不是配额控制。公开上线前验证该账户的安全规则、额度及触发后的行为。

## 预览验收

- `GET /api/wcl/health` 返回 `{"ok":true,"service":"wcl2note"}`。
- 首页输入真实公开报告，验证默认共享 OAuth → reportFights → context → 双侧多页 events。
- 验证自定义认证 Cookie 在 HTTPS 下可用，失效不会回退共享，切换认证不会显示旧缓存。
- 检查 API `Cache-Control: no-store` 和 `X-Request-ID`；前端 bundle/浏览器响应不含共享 Secret/token。
- 真实报告在 Windows 与网页选择相同技能，比较复制和下载文本，只归一化 CRLF/LF。
- 冷启动、并发认证、较大事件页、429、权限错误、取消、快速切换、域名 HTTPS 和首页刷新均须验证。
- 项目区域、运行时、域名、WCL 请求耗时及配额实测结果填入 validation.md；不要记录 Cookie、Authorization、凭据或完整请求体。

API 网关固定四种操作，单页 10,000 条，由浏览器完成分页；不会接受任意 GraphQL 或 URL。单次出站请求含正文读取超时 20 秒。目标边缘函数执行限额比此更紧时，需要缩小单页或迁移同一契约到该账户支持的 Node Functions，并重新测试，不应悄悄截断事件。

## 生产与回滚

确认预览通过后，绑定域名与 HTTPS，明确生产分支、环境变量范围。若环境变量不能按预览/生产隔离，使用独立预览项目。单页只使用根路径，无 history fallback 或 SPA rewrite 假设。

发布前记录当前有效构建 ID、提交、依赖锁、环境变量名称及版本（不记值）。失败时在 Pages 控制台恢复上一成功构建，再用同一公开报告执行烟测。环境变量需要独立恢复；代码回滚不等于密钥配置回滚。SESSION_KEY 轮换会使旧自定义会话失效，用户需重新认证。

## 官方依据（2026-09-07 查阅）

- [中国站 Pages Functions](https://edgeone.cloud.tencent.com/pages/document/162936866445025280)：functions 路由、onRequest 和 env。
- [edgeone.json 配置](https://edgeone.cloud.tencent.com/pages/document/162936771610066944)：构建、安装、输出与预装 Node 版本。
- [EdgeOne CLI](https://edgeone.cloud.tencent.com/pages/document/162936923278893056)：构建部署及手工上传函数要求。
