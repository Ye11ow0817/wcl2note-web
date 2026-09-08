# wcl2note

将 Warcraft Logs 战斗记录转换为 MRT 团队笔记的网页工具。由 Windows WCL2MRT 按行为移植，产品名改为 **wcl2note**，输出仍采用 MRT 格式。React 19 + TypeScript + Vite，EdgeOne Pages 静态托管及 Functions，无常驻服务器。

## 本地运行

```powershell
cd F:\CodexProjects\wcl2note-web
npm ci
Copy-Item .env.example .env.local
# 在本机编辑 .env.local；不要将凭据提交或发到聊天。
npm run dev
```

打开 `http://127.0.0.1:5173`。Vite 同时运行同源 API 开发适配器，无需再启动一个服务器。没有共享凭据时页面可以打开，加载真实报告会明确提示尚未配置。可通过设置使用自己的 Client ID/Secret；自定义认证还需要配置 SESSION_KEY。

- `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET`：新签发的共享 client credentials，仅服务端读取。
- `SESSION_KEY`：32 个随机字节的十六进制编码（64 字符），用于 AES-GCM 会话票据。可在本机用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成，再保存到本机环境文件或 Pages 服务端配置。
- 不使用 `VITE_*` 保存任何凭据。不读取或复制 Windows 默认凭据文件。

浏览器自定义 Secret 不持久化，认证成功即清空输入；最长 1 小时的加密 Cookie 仅含 WCL token 和到期时间。刷新页面使用共享模式，需重新认证才能启用自定义模式。与桌面自动保存 Secret 的行为不同。显式自定义认证失败不会静默回退。

默认使用 `https://cn.warcraftlogs.com` 发起 OAuth 和 GraphQL 请求，API 凭据申请链接也指向 CN 站。报告输入继续兼容其他地区链接及纯报告编号；查询统一走 CN，不随输入域名切换。

## 使用

输入报告编号或带 `fight/pull/phase` 的 URL → 选择战斗 → 选择全程/Pull/阶段 → 切换敌友、来源树及施法/Buff/Debuff → 勾选技能 → 复制或下载。没有 fight 选择器时等待手动选择战斗，与桌面一致。

同 Source 的 Instance 同步勾选；不同 Source 不混并。所有友方视图隐藏宠物，宠物仍可从主人下方的树选择。阶段保留整场计时，Pull 从零计时。切换阶段保留选择，切换战斗/报告清空。四项输出默认值为：图标关、友方来源开、敌方来源关、友方简化开。

## 验证命令

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

E2E 使用本机 Microsoft Edge，含桌面和 390px 窄屏。测试接口使用脱敏 fixture，不代表真实 WCL/EdgeOne 网络已经验证。

`edge-functions/api/wcl/[[path]].ts` 是必须提交到 Git 的函数源码入口。`npm run build` 生成前端 `dist/`，并将函数编译到仅用于本地验证的 `.edge-build/`。Makers 从仓库中的 `edge-functions/` 发布函数；不要忽略该源码目录。`npm run preview` 只预览静态前端，真实 API 本地联调用 `npm run dev`。

## 目录

- `src/domain`：URL/区间、事件映射、来源树、选择 key 和 MRT 格式化。
- `src/app`：界面与状态协调；TanStack Query 按认证身份/报告/战斗/事件隔离请求缓存。
- `server`：固定查询、参数约束、共享 OAuth、加密自定义会话和脱敏错误。
- `scripts/baseline`：只引用原 Core/Exporting DLL 生成 C# 输出 fixture，不引用凭据所在 Infrastructure。
- `tests`：领域、认证、分页、192 组桌面输出对照和浏览器流程。
- `docs/deployment.md`：EdgeOne 部署及回滚步骤。
- `docs/validation.md`：完成情况与尚未验证的边界。

采用 npm 10.9.2 + package-lock.json；本机 pnpm 下载多次超时，未绕过签名检查。`.npmrc` 使用 `legacy-peer-deps=true`，避免安装不使用的测试运行时 peer 依赖；显式依赖组合已通过类型、构建及测试验证。中国站配置使用官方预装 Node 22.11.0；本地 Node 22.16.0。正式构建环境仍需创建项目后实测。

生成桌面对照 fixture（可选，日常网页测试直接使用已保存的 fixture）：

```powershell
dotnet test F:\CodexProjects\wcl2mrt\Wcl2Mrt.sln --no-restore
dotnet run --project scripts/baseline/Baseline.csproj -p:DesktopRoot=F:/CodexProjects/wcl2mrt -- tests/fixtures/desktop-mrt.json
```

By Ye11ow
