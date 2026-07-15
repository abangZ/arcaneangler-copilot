# 架构与扩展指南

## 目标

Arcane Angler Copilot 由常驻 Web 控制面和按需创建的 Playwright Worker 组成。HTTP 请求不能直接操作游戏页面；所有启动、暂停、恢复、停止和配置重建命令都由 `WorkerController` 串行处理。

```text
.env（账户 / Web 基础设施）
          │
          ├──> AuthService ──> session / CSRF
          │
Browser ──> ControlServer ──> WorkerController ──> AutomationWorker
   ▲              │                  │                    │
   │              ├──> SettingsStore ┘                    ├──> AutomationEngine
   │              │                                       │      ├── Scheduler
   │              ├──> StatsStore <── /cast response <────┤      └── Features
   │              └──> SSE <── StatusReporter <────────────┤
   │                         └── LogStore                   │
   └───────────────────────────────────────────────────────┴──> ArcaneAnglerPage
```

服务启动时只创建 `ControlServer`。用户登录、保存 `.data/settings.json` 并点击“启动”后，`WorkerController` 才创建 `AutomationWorker` 和 Playwright persistent context。

## 配置边界

### `src/config.js`

- 从 `.env` 读取 Arcane Angler 用户名和密码。
- 读取 Web host/port、目标 URL、浏览器目录和截图目录等进程级基础设施配置。
- 不读取地图、鱼饵、功能开关和调度参数。
- 账户密码只传给 `AuthService` 和 `ArcaneAnglerPage`，不进入网页配置、API 响应或日志。

### `src/core/settings-schema.js`

- 定义所有可由 Web 修改的默认配置和唯一服务端校验入口。
- 拒绝未知字段、非法范围和跨字段冲突。
- 鱼饵购买数量必须是 100 的倍数；固定地图必须提供目标 Biome。
- 角色、无头模式和页面操作超时属于需要重建 Worker 的设置。

### `src/core/settings-store.js`

- 配置保存在 `.data/settings.json`，不包含账户密码。
- 首次启动时 `configured=false`，默认值只用于填充表单，不能直接启动 Worker。
- 保存使用 revision 做乐观并发控制，并通过临时文件 + rename 原子替换。
- 文件权限固定为 `0600`。配置损坏时保留 Web 服务，回退安全默认值并在页面显示错误。

### `src/core/runtime-settings.js`

- 把 `SettingsStore` 的最新快照提供给 Engine 和 features。
- 每次 `get()` 都返回克隆，feature 不能直接修改配置。
- 地图、鱼饵、调度和延迟变化在后续 tick 生效，不需要重启服务。

## Web 控制面

### `src/web/auth-service.js`

Web 登录复用 `.env` 中的 Arcane Angler 账户，但与游戏网页登录路径隔离：

1. 浏览器请求一次性 `challengeId + salt + nonce`。
2. 浏览器用 Web Crypto PBKDF2 派生 key，再提交 HMAC proof。
3. 服务端用 `.env` 密码计算期望 proof，并用恒定时间比较。
4. challenge 绑定来源 IP、有效期 60 秒且只能使用一次。
5. 连续失败达到阈值后按 IP 限流 15 分钟。
6. 成功后生成 12 小时随机 session；服务端只保存 session token 的 SHA-256 key。

静态 salted hash 会成为可重放凭据，因此禁止使用。challenge-response 也不能代替 HTTPS；远程部署必须通过反向代理或安全隧道提供 TLS。

### `src/web/control-server.js`

- 使用 Node.js HTTP 服务静态页面和 JSON API，不引入游戏页面 DOM。
- session cookie 使用 `HttpOnly`、`SameSite=Strict`；HTTPS 下增加 `Secure`。
- 修改接口同时校验 session、CSRF token 和 Origin。
- 设置 CSP、frame、MIME、referrer 和 permissions 安全响应头。
- API body 限制为 64 KiB，不提供任意路径文件读取。
- SSE 使用同源 session cookie，响应禁用代理缓冲。

主要接口：

```text
POST /api/auth/challenge
POST /api/auth/login
GET  /api/session
POST /api/auth/logout
GET  /api/state
GET  /api/settings
PUT  /api/settings
GET  /api/stats
GET  /api/logs
GET  /api/events
POST /api/actions/start|pause|resume|stop|restart
```

SSE 事件分为 `status`、`controller`、`settings`、`stats`、`log` 和会话过期时的 `auth`。日志事件带递增 ID；首次连接从已加载日志的最新 ID 继续，后续通过 `Last-Event-ID` 断线补发；每 15 秒发送 heartbeat。

前端信息架构按使用频率划分：未配置账户只显示首次设置页；完成配置后进入概览，收益和日志使用一级导航，设置由右上角入口进入。概览只显示运行控制、当前任务、运行环境和今日核心收益。日志在浏览器内倒序保留最近 200 条。

## Worker 生命周期

### `src/core/worker-controller.js`

控制状态包括：

```text
stopped -> starting -> running -> pausing -> paused
                       │   ▲                    │
                       │   └──── resume ────────┘
                       └── stopping -> stopped
```

启动异常进入 `error`，可以再次启动或停止。所有命令进入同一 Promise queue，避免 HTTP 请求并发创建、关闭或重启浏览器。

- `start`：要求配置已经保存，然后创建 Worker。
- `pause`：先调用 Engine stop gate，等待当前协作式操作退出，再关闭整个 persistent context。
- `resume`：创建新 Worker；如果当前处于 quiet hours，Engine 会立即进入 quiet 并保持浏览器关闭。
- `stop`：关闭 Worker，配置保持不变。
- `restart`：串行执行 stop/start。
- 会话级配置变化时自动执行受控重启；其他配置从下一轮 tick 生效。

### `src/core/automation-worker.js`

- 创建 browser profile、persistent context、`ArcaneAnglerPage`、Engine 和 features。
- quiet hours 的 `browserLifecycle.suspend/resume` 只关闭和重建 Playwright，不影响 Web 服务。
- `session.replacePage()` 保证恢复后所有 feature 使用新的页面引用。
- 页面脚本异常通过 `StatusReporter.log()` 记录，不整体转发页面 console。
- 把 `StatsStore` 回调交给页面 adapter，Worker 和 HTTP handler 不解析游戏响应字段。

### `src/core/automation-engine.js`

- 注册并按优先级调度 Verification、Map、Bait、Fishing。
- 每轮读取最新配置，并把最新 schedule 交给 `OperationScheduler`。
- 操作前继续通过 `isOperationAllowed()` / `AutomationPausedError` 做实时门禁。
- 连续异常达到网页配置的阈值后截图并尝试恢复。
- 浏览器不可恢复地关闭时让 Worker 进入 error；Web 控制面继续在线。

### `src/core/operation-scheduler.js`

- 状态包含 `idle`、`active`、`rest`、`quiet` 和 `disabled`。
- quiet 优先于功能开关和 active/rest。
- schedule 变化时重置当前周期并使用新配置重新计算。
- quiet 会关闭整个 Playwright persistent context，而不是只关闭 page。

## 页面与 Feature 边界

`ArcaneAnglerPage` 继续封装所有 DOM Locator 和页面响应细节。普通点击必须使用 Playwright `Locator.click()`，禁止在页面上下文调用 `HTMLElement.click()`。Human Verification 可以使用真实鼠标移动、点击和拖动。

页面 adapter 监听页面自己产生的 `POST /api/game/cast` 成功响应，只把 `payload.result` 交给 `StatsStore`。该监听不会发起额外游戏请求，也不会改变页面对响应的消费。

feature 只编排语义操作：

- `VerificationFeature`：优先处理页面验证。
- `MapFeature`：报名可参与 Derby，并按赛事或经验权重切换已解锁地图。
- `BaitFeature`：按当前地图的 `0..4` 档位购买和装备鱼饵。
- `FishingFeature`：确保经典模式，按 90% 常规、8% 短停顿、2% 长停顿分层等待后点击可用抛竿按钮；等待期间每 500ms 重新检查 scheduler gate。

HTTP API 和 Web UI 不得直接持有 DOM Locator，也不得绕过 Engine queue 调用页面方法。

## 状态和日志

### `src/core/status-reporter.js`

- 维护当前结构化状态，并继续输出 stdout/stderr。
- `record:false` 的高频状态只更新当前快照，不写日志文件。
- 当前状态变化和日志记录分别向 SSE 订阅者发送事件。
- 页面 console 不作为状态事实来源。

### `src/core/log-store.js`

- 内存保留最近 2,000 条结构化日志。
- 按 UTC 日期追加 `.data/logs/YYYY-MM-DD.jsonl`。
- 启动时加载最近 7 个日志文件，并从历史最大 ID 继续递增。
- 单条损坏日志不会阻止 Web 控制面启动。

### `src/core/stats-store.js`

- 只累计 `/cast` 的 `goldGained`、`xpGained`、`relicsGained`、鱼获数量、宝箱、装备和稀有度分类等每竿增量。
- 同时维护累计值和按服务器本地日期划分的每日值，保留最近 90 个每日汇总。
- 数据原子写入 `.data/stats.json`，权限固定为 `0600`。
- Web 读取当前快照，并通过 `stats` SSE 事件实时更新；统计写入失败不阻断自动化循环。

## 关闭流程

SIGINT / SIGTERM 的顺序是：

1. 标记服务停止并记录状态。
2. 关闭所有 SSE 响应和 HTTP server，停止接收新的控制命令。
3. 通过 `WorkerController.stop()` 阻止新页面操作、等待 Engine 退出并关闭浏览器。

## 验证

- `pnpm run smoke:web`：challenge 登录、session/CSRF、配置持久化、收益 API、SSE 和 Worker 控制。
- `pnpm run smoke:reporter`：运行配置快照、结构化输出和重复抑制。
- `pnpm run smoke:fishing`：默认普通延迟和抛竿延迟的 90%/8%/2% 概率边界。
- `pnpm run smoke:scheduler`：active/rest/quiet 和浏览器 suspend/resume。
- `pnpm run smoke:stats`：`/cast` 响应解析、每日/累计收益和持久化。
- `pnpm run smoke:map`：Derby 报名、地图算法和可信点击。
- `pnpm run smoke:bait`：跨地图档位、购买、装备和库存处理。
- `pnpm run smoke:verification`：真实鼠标验证事件。
- Chromium smoke 在当前环境中串行执行，不并行启动 persistent browser。

`.env`、`.data/`、`artifacts/` 和 `node_modules/` 必须保持在 Git 忽略范围内。
