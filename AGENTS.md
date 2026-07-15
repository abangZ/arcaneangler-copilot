# AGENTS.md

## 项目定位

- 本项目是面向 Linux 服务器长期运行的 Playwright 自动化服务，默认使用无头 Chromium。
- 当前交互入口是独立 Web 控制台；服务启动时只启动控制面，用户保存配置并点击启动后才创建 Playwright Worker。不要在游戏页面注入操作面板。
- `README.md` 面向开源用户，只写当前可用能力、安装、配置、运行、排障和免责声明；不要写会话讨论、实现过程、历史方案、测试账号或本地绝对路径。
- 内部架构说明放在 `docs/architecture.md`；阶段性交接和页面结构证据放在 `docs/auto-bait-handoff.md`，不要塞进 README。

## 配置与日志

- `.env` 只保存 Arcane Angler 账户和 Web host/port、目录等进程级基础设施配置，`src/config.js` 负责解析；账户密码不得进入 Web 配置和 API 响应。
- 自动化配置由 `SettingsStore` 校验并原子持久化到 `.data/settings.json`，`RuntimeSettings` 只向 Engine/features 提供最新只读快照。
- Web UI 不能直接操作 `ArcaneAnglerPage`；配置更新和启动、暂停、恢复、停止、重启都必须经过 `WorkerController` 的串行命令队列。
- 主要运行信息统一通过 `StatusReporter` 输出到 stdout/stderr 和 `LogStore`，并通过 SSE 推送结构化状态与日志。
- 不要整体转发页面 console，站点日志可能包含登录响应或令牌。
- 日志和文档不得输出 `.env` 中的密码或其他敏感数据。

## 浏览器身份

- 生产启动统一使用 `src/core/browser-profile.js` 生成的 profile：`channel: 'chromium'`、与内置 Chromium 主版本一致的桌面 Chrome UA，以及 `--disable-blink-features=AutomationControlled`。
- 网络请求头和 `navigator.userAgent` 必须保持一致；不要只在页面上下文覆盖 UA。
- `scripts/fingerprint-smoke.js` 负责验证 UA 不含 `HeadlessChrome`、`navigator.webdriver === false`、插件和 `window.chrome` 存在。
- 这些设置只能减少默认无头特征，不能保证无法检测；没有实际证据时不要继续加入 canvas、WebGL、音频或字体随机伪装，以免制造互相矛盾的指纹。

## 浏览器与调度边界

- 普通页面点击使用 Playwright `Locator.click()`，它已经产生可信事件；不要改成页面上下文中的 `HTMLElement.click()`。
- Human Verification 可以使用真实鼠标移动、点击和拖动，其他普通操作无需额外模拟鼠标轨迹。
- quiet hours 是浏览器生命周期边界：进入 quiet 时关闭整个 persistent context，恢复时重新创建 context/page，并通过 `session.replacePage()` 更新页面引用。
- Web 控制面不受 quiet hours、手动暂停和 Worker 异常影响；这些状态只改变 Playwright Worker 生命周期。
- 操作前继续经过 scheduler gate；不要让较长的 feature 跨过休息或 quiet 边界后继续点击。
- 页面 console 不作为状态事实来源；页面操作集中在 `ArcaneAnglerPage`，feature 只编排语义操作。

## 功能约束

- `VerificationFeature`、`MapFeature`、`BaitFeature`、`FishingFeature` 按优先级依次处理，不要把 DOM Locator 放进 feature 或 HTTP handler。
- 自动鱼饵默认关闭，避免首次启动自动消费金币。
- 鱼饵购买和装备必须点击页面已有控件，不直接构造游戏 API 请求。
- 普通抛竿同样只走页面控件，不直接调用 `/api/game/cast`。
- 页面文案可能被汉化，Locator 优先依赖结构、状态 class、`disabled`、稳定属性和请求路径，英文文本只作兼容兜底。

## 修改与验证

- 修改前后检查 `git status --short` 和相关 diff，保留用户已有改动。
- 优先做与改动直接相关的最小验证；提交前运行 `git diff --check`。
- 稳定验证入口：

```bash
pnpm run check
pnpm run smoke:web
pnpm run smoke:reporter
pnpm run smoke:fingerprint
pnpm run smoke:scheduler
pnpm run smoke:map
pnpm run smoke:bait
pnpm run smoke:verification
pnpm run smoke
```

- Chromium smoke 在当前环境中串行执行更稳定，不要并行启动多个浏览器 smoke。
- `pnpm start` 会连接真实站点并可能触发真实账号操作；除非用户明确要求，不把它当普通验证命令运行。
- 默认不提交、不 push；用户明确授权后再执行对应 Git 操作。
