# 架构与扩展指南

## 目标

Arcane Angler Copilot 由常驻 Web 控制面和按需创建的 Playwright Worker 组成。HTTP 请求不能直接操作游戏页面；所有启动、暂停、恢复、停止和配置重建命令都由 `WorkerController` 串行处理。

```text
.env（账户 / Web 基础设施）
          │
          ├──> AuthService ──> .data/sessions.json / CSRF
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
6. 成功后生成 12 小时随机 session；服务端只保存 session token 的 SHA-256 key，同一账号允许多个独立 session 并存。

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
GET  /api/gears
GET  /api/logs
GET  /api/events
POST /api/gears/equip|sell
POST /api/actions/start|pause|resume|stop|restart
```

SSE 事件分为 `status`、`controller`、`settings`、`stats`、`log` 和会话过期时的 `auth`。日志事件带递增 ID；首次连接从已加载日志的最新 ID 继续，后续通过 `Last-Event-ID` 断线补发；每 15 秒发送 heartbeat。

前端首屏先显示 session 恢复态，只有 `/api/session` 返回 401 才展示登录表单，避免刷新时闪现密码输入。信息架构按使用频率划分：完成配置后进入概览，收益和日志使用一级导航，设置由右上角入口进入。概览显示紧凑运行控制、今日收获、当前鱼饵收益、角色/地图快照和最后鱼获；收益页承载详细列表。日志在浏览器内倒序保留最近 200 条。

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
- `getGearInventory`、`equipGear`、`sellGears`：与生命周期命令共用同一队列，只在 Worker 运行且浏览器打开时转发给当前 Worker。装备 ID、戒指槽位和批量数量在转发前校验。
- 会话级配置变化时自动执行受控重启；其他配置从下一轮 tick 生效。

### `src/core/automation-worker.js`

- 创建 browser profile、persistent context、`ArcaneAnglerPage`、Engine 和 features。
- quiet hours 的 `browserLifecycle.suspend/resume` 只关闭和重建 Playwright，不影响 Web 服务。
- `session.replacePage()` 保证恢复后所有 feature 使用新的页面引用。
- 页面脚本异常通过 `StatusReporter.log()` 记录，不整体转发页面 console。
- 把 `StatsStore` 回调交给页面 adapter，Worker 和 HTTP handler 不解析游戏响应字段。
- 页面 bootstrap 后读取角色等级、XP、当前地图/鱼饵和天气经验加成；抛竿响应即时更新 `newLevel/newXP/xpToNext`，并至多每分钟重新校准完整快照。
- 装备管理通过页面已登录会话的 `ApiService.getGears()`、`equipGear()` 和 `sellGears()` 完成，不切换当前游戏页面。Worker 对穿戴和出售操作记录结构化日志；quiet hours 或手动暂停关闭浏览器时拒绝操作，不额外创建临时页面。
- 角色快照通过 `StatusReporter` 的非落盘状态事件提供给 Web；读取失败不阻断统计或自动化。

### `src/core/automation-engine.js`

- 注册并按优先级调度 Verification、WorldBoss、Map、Bait、Fishing。
- 每轮读取最新配置，并把最新 schedule 交给 `OperationScheduler`。
- 操作前继续通过 `isOperationAllowed()` / `AutomationPausedError` 做实时门禁。
- 连续异常达到网页配置的阈值后截图并尝试恢复。
- 浏览器不可恢复地关闭时让 Worker 进入 error；Web 控制面继续在线。

### `src/core/operation-scheduler.js`

- 状态包含 `idle`、`active`、`competition`、`rest`、`quiet` 和 `disabled`。
- 已参与的活动优先于自动 rest/quiet；用户手动关闭自动化仍然生效。
- schedule 变化时重置当前周期并使用新配置重新计算。
- quiet 会关闭整个 Playwright persistent context，而不是只关闭 page；常规恢复时间在配置的 quiet end 后再延迟 1 小时。
- 已记录活动在 quiet 内开始时进入 `competition` 并临时重建浏览器，结束后继续 quiet；活动期间到期的 active 周期会在活动结束后补休。世界 Boss 不要求 Biome，并优先于同时段的钓鱼赛事。

## 页面与 Feature 边界

`ArcaneAnglerPage` 继续封装所有 DOM Locator 和页面响应细节。普通点击必须使用 Playwright `Locator.click()`，禁止在页面上下文调用 `HTMLElement.click()`。Human Verification 可以使用真实鼠标移动、点击和拖动。

页面 adapter 监听页面自己产生的 `POST /api/game/cast` 成功响应，用页面 `BIOMES` / `BAITS` catalog 补齐地图名、鱼饵名和价格后交给 `StatsStore`，同时缓存响应中的 `equippedBait` / `baitQuantity` 供 `BaitFeature` 判断是否需要打开 Equipment。该监听不会发起额外抛竿请求，也不会改变页面对响应的消费。

角色、天气和赛事状态通过页面已有 `ApiService.getPlayerData()`、`getAllBiomeWeather()`、`getCurrentAnomaly()`、`getCurrentTournaments()`、`getCurrentDerbies()` 做低频只读采集。公会锦标赛是否参与以 standings 中存在当前 `guild_id` 为准，不能只依据全局 active tournament 或 Biomes 页标签。世界 Boss 的 inactive 响应提供 `nextSpawnTime`，active 响应提供生命值、结束时间、弱点、个人参与和排行榜。
首页复用同一份锦标赛 standings，按数组顺序计算当前公会排名，并展示 `total_points` 与 `fish_caught`；没有 standings 或当前公会未参赛时隐藏进度和排名。

feature 只编排语义操作：

- `VerificationFeature`：优先处理页面验证。
- `WorldBossFeature`：默认开启；活动中进入 Anomalies 页面并通过主要弱点对应的页面按钮持续攻击。只读接口用于发现和展示，不直接构造攻击请求。
- `MapFeature`：自动切图与公会锦标赛优先是两个默认开启的独立设置。锦标赛优先开启时，已参与锦标赛覆盖关闭/固定/自动地图策略；比赛结束后恢复原策略。自动模式继续报名可参与 Derby，并按个人 Derby、经验权重选择已解锁地图。
- `BaitFeature`：按当前地图的 `0..4` 档位购买和装备鱼饵；已知库存充足时复用 `/cast` 缓存，不进入 Equipment。
- `FishingFeature`：确保经典模式，常规状态按 90% 常规、8% 短停顿、2% 长停顿分层等待；比赛期间跳过长停顿。等待期间每 500ms 重新检查 scheduler gate。

HTTP API 和 Web UI 不得直接持有 DOM Locator，也不得绕过 Engine queue 调用页面方法。

装备管理是显式的用户操作，不属于自动化 feature。Web 只发送 gear ID 和可选戒指槽位，`WorkerController` 串行转发；`ArcaneAnglerPage` 在提交穿戴/出售前重新读取服务器装备列表，拒绝不存在、已穿戴或已锁定的出售项。返回给 Web 的装备快照只包含展示所需字段，不转发 owner 等原始响应数据。

## 状态和日志

### `src/core/status-reporter.js`

- 维护当前结构化状态，并继续输出 stdout/stderr。
- `record:false` 的高频状态只更新当前快照，不写日志文件。
- 当前状态变化和日志记录分别向 SSE 订阅者发送事件。
- 页面 console 不作为状态事实来源。

### `src/core/log-store.js`

- 内存保留最近 2,000 条结构化日志。
- 按 UTC 日期追加 `.data/logs/YYYY-MM-DD.jsonl`。
- 启动时加载最近 7 个日志文件，并从历史最大 ID 继续递增；连续运行跨日时再次执行保留策略，始终只保留最近 7 个文件。
- 单条损坏日志不会阻止 Web 控制面启动。

### `src/core/stats-store.js`

- 只累计 `/cast` 的 `goldGained`、`xpGained`、`relicsGained`、鱼获数量、宝箱、装备和稀有度分类等每竿增量；不使用 `newGold` 等余额字段。
- v2 同时维护累计值、按服务器本地日期划分的每日值、地图×鱼饵 breakdown，以及按地图/鱼饵派生的汇总和最后鱼获。
- 已知鱼饵价格按每竿计入成本；未知价格单独计数，不估算成本。Web 快照派生 `netGold = gold + fishGold - baitCost`。
- 保留最近 90 个每日汇总和对应的每日 breakdown；v1 文件原子迁移并保留原累计/每日数据。
- 数据原子写入 `.data/stats.json`，权限固定为 `0600`。
- Web 读取当前快照，并通过 `stats` SSE 事件实时更新；统计写入失败不阻断自动化循环。

## 关闭流程

SIGINT / SIGTERM 的顺序是：

1. 标记服务停止并记录状态。
2. 关闭所有 SSE 响应和 HTTP server，停止接收新的控制命令。
3. 通过 `WorkerController.stop()` 阻止新页面操作、等待 Engine 退出并关闭浏览器。

## 验证

- `pnpm run smoke:web`：challenge 登录、多终端 session/独立退出、CSRF、配置持久化、收益 API、装备字段归一化、穿戴/批量出售、SSE 和 Worker 控制。
- `pnpm run smoke:reporter`：运行配置快照、结构化输出、重复抑制和连续运行时的每日文件保留。
- `pnpm run smoke:fishing`：默认普通延迟、90%/8%/2% 概率边界和比赛期间长停顿覆盖。
- `pnpm run smoke:scheduler`：active/rest/quiet、比赛延后休息、夜间唤醒和早间延迟恢复。
- `pnpm run smoke:stats`：`/cast` 响应解析、鱼饵余量缓存、每日/地图/鱼饵聚合、最后鱼获、v1 迁移和持久化。
- `pnpm run smoke:map`：公会锦标赛优先级、Derby 报名、活动时间、地图算法、角色/地图快照和可信点击。
- `pnpm run smoke:bait`：跨地图档位、购买、装备、库存缓存和 Equipment 跳过。
- `pnpm run smoke:verification`：真实鼠标验证事件。
- Chromium smoke 在当前环境中串行执行，不并行启动 persistent browser。

`.env`、`.data/`、`artifacts/` 和 `node_modules/` 必须保持在 Git 忽略范围内。
