# Arcane Angler Copilot

Arcane Angler Copilot 是一个适合在 Linux 服务器长期运行的 Arcane Angler 自动钓鱼服务。服务启动后提供 Web 控制台；只有用户登录、保存配置并点击“启动”后，才会创建无头 Chromium 和 Playwright 自动化 Worker。

## 功能

- Web 控制台按概览、收益、装备和日志分区展示日常状态，低频设置使用独立页面；刷新时会先恢复已有 session，不闪现登录表单，并允许多个终端同时登录。
- 从游戏页面已经产生的 `/api/game/cast` 响应统计今日、累计、地图、鱼饵和地图×鱼饵收益，并记录最后一条鱼。
- 概览显示当前金币、当前鱼饵收益、角色等级与升级进度、剩余经验、预计升级时间、每小时经验/升级数、当前地图天气经验加成、世界 Boss、公会锦标赛进度与排名、个人 Derby 和最后鱼获。
- 在运行中修改世界 Boss、地图、鱼饵、钓鱼、Human Verification 和挂机计划，无需重启服务。
- 支持启动、暂停、恢复、停止和重启 Playwright Worker；暂停会关闭浏览器。
- Worker 运行且浏览器打开时，可直接查看已穿戴装备与属性合计、浏览背包装备、穿戴装备，并多选批量出售；不需要停止服务后手动登录游戏。
- 自动登录游戏并选择角色，登录状态保存在服务器。
- 自动抛竿默认等待 500–2,000ms；短停顿和长停顿都可独立开关并设置概率、最短时间和最长时间，默认分别为 8% / 5–10 秒和 2% / 20–40 秒；比赛期间取消长停顿。
- `/api/game/cast` 返回 Softban 时会暂停页面操作直至处罚结束，避免在金币和经验为 0 时继续消耗鱼饵；最后鱼获会明确显示处罚状态。
- 自动钓鱼连续 3 分钟没有收到成功抛竿响应时，会刷新页面并重新初始化钓鱼流程。
- 游戏进入维护页时会单独识别为站点维护，每分钟重新检查，不计入普通连续错误恢复。
- 每轮随机运行 40–70 分钟，再随机休息 5–15 分钟；已参与比赛会把休息延后到比赛结束。
- 夜间休息可关闭。默认按服务器本地时间在 00:00–08:00 停止脚本操作并关闭浏览器；也可让游戏内 Auto-Cast 接管夜间时段，并选择是否在每轮结束后自动续期。夜间比赛会优先停止游戏 Auto-Cast 并恢复脚本参赛，常规挂机延迟到 09:00 恢复。
- 自动切地图和公会锦标赛优先默认开启；支持固定地图，或按公会锦标赛、个人 Derby、天气经验和 Biome 等级自动选择地图。
- 自动参与世界 Boss 默认开启；发现活动后进入 Anomalies 页面，持续选择 Boss 的主要弱点攻击，活动结束后恢复钓鱼。
- 可用 `0..4` 档位分别设置普通挂机、公会锦标赛和个人 Derby 使用的鱼饵，并在库存不足时通过页面购买和装备。
- 支持旧版 SVG 和新版图片拼图 Human Verification；优先通过真实鼠标点击和滑块拖动处理，模拟手操失败时复用当前题目，通过页面验证 API 兜底。基础算术 Staff Question 会自动回答，无法可靠解析的问题转交人工处理。
- 日志同时输出到 stdout/stderr，并保留最近 7 个每日 JSONL 日志文件供 Web 页面查看。

自动抛竿、世界 Boss 攻击、鱼饵购买/装备、Derby 报名和地图切换仍通过 Playwright 页面控件完成。装备管理使用 Playwright 已登录页面提供的 `ApiService` 读取和提交 gear 请求；所有命令仍经过 Web 鉴权、CSRF 校验和 `WorkerController` 串行队列，不会把游戏凭据暴露给控制台。

## 环境要求

- Node.js 20 或更高版本
- pnpm 9
- Linux、macOS，或其他 Playwright 支持的平台

## 安装

```bash
pnpm install
pnpm run install:browser
```

Linux 服务器需要同时安装 Chromium 的系统依赖：

```bash
pnpm exec playwright install --with-deps chromium
```

## 账户配置

复制配置模板：

```bash
cp .env.example .env
chmod 600 .env
```

`.env` 只需要保存 Arcane Angler 登录账户：

```dotenv
ARCANE_USERNAME=your-login-username
ARCANE_PASSWORD=your-password
```

用户名需要填写 Arcane Angler 的 `Username (Login)`，不是公开展示的 Profile Name。同一组账户密码也用于登录 Copilot Web 控制台。

可选的 Web 基础设施变量：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ARCANE_WEB_HOST` | `127.0.0.1` | Web 服务监听地址；建议通过反向代理对外开放 |
| `ARCANE_WEB_PORT` | `3200` | Web 服务监听端口 |
| `ARCANE_URL` | `https://arcaneangler.com/` | 游戏地址，通常不需要修改 |
| `ARCANE_USER_DATA_DIR` | `.data/browser` | Playwright 持久化浏览器目录 |
| `ARCANE_ARTIFACTS_DIR` | `artifacts` | 异常和验证截图目录 |

地图、鱼饵、运行计划等自动化配置不再从 `.env` 读取，统一在 Web 页面管理。

## 启动和首次配置

```bash
pnpm start
```

默认访问地址是：

```text
http://127.0.0.1:3200
```

服务启动时只运行 Web 控制面，不会创建 Chromium，也不会登录游戏。首次使用流程：

1. 使用 `.env` 中的 Arcane Angler 用户名和密码登录 Web 控制台。
2. 首次登录会直接进入独立设置页，检查角色、地图、鱼饵和挂机计划。
3. 点击“保存并进入控制台”。
4. 在概览页点击“启动自动化”，创建 Playwright Worker。

服务进程重启后仍只启动 Web 控制面，需要再次点击“启动”。这样修改服务文件、排障或重启 systemd、PM2 等进程管理器时不会意外消耗游戏资源。

网页配置保存在 `.data/settings.json`，使用原子写入并限制为当前服务用户可读写。账户密码不会写入该文件。
升级时如果抛竿延迟仍是旧默认值 250–800ms，会自动原子迁移为 500–2,000ms；旧配置会补上默认开启的公会锦标赛优先和自动参与世界 Boss 开关，其他自定义范围和地图模式不会改动。

## 远程安全访问

Web 登录使用一次性随机 salt/nonce、PBKDF2 和 HMAC 验证；浏览器不会把原始密码作为请求正文发送。登录成功后，服务端下发带 `HttpOnly`、`SameSite=Strict` 的 31 天 session cookie，修改操作还需要 CSRF token。服务端只把 session token 的哈希和必要的会话信息持久化到 `.data/sessions.json`，因此服务重启后登录态仍然有效，原始 cookie token 不会写入磁盘。同一账号可同时保有多个独立 session；退出某一终端不会退出其他终端。

这些机制不能替代 HTTPS。远程访问时推荐保留 `ARCANE_WEB_HOST=127.0.0.1`，并选择以下方式之一。

### SSH 隧道

```bash
ssh -L 3200:127.0.0.1:3200 your-user@your-server
```

然后在本地浏览器访问 `http://127.0.0.1:3200`。

### Caddy 反向代理

```caddyfile
angler.example.com {
    reverse_proxy 127.0.0.1:3200
}
```

Caddy 会自动申请 HTTPS 证书，并向后端传递安全协议头。也可以使用 Nginx、Tailscale Serve 等同类方案。

不建议直接把 `ARCANE_WEB_HOST` 改成 `0.0.0.0` 后通过公网 HTTP 访问。浏览器的 Web Crypto 登录能力也要求 HTTPS 或 localhost 安全上下文。

## Web 配置

### 地图

- `关闭`：不按固定地图、Derby 或经验权重切图。
- `固定地图`：确保角色位于指定的已解锁 Biome。
- `自动选择`（默认）：每次检查先通过 Events 页的一键报名按钮报名当前可参与的 Derby，并关闭报名成功弹窗，再按个人 Derby 和经验权重选图。
- `优先公会锦标赛`（默认开启）：只要当前公会实际参与进行中的锦标赛，就临时切到锦标赛地图。该开关的优先级高于固定地图和自动选择；关闭自动切地图时也可独立生效，比赛结束后恢复原地图策略。

完整选图优先级为：

1. 开启锦标赛优先时，当前公会已经参与的进行中锦标赛所在地图。
2. 固定地图模式的指定地图。
3. 自动选择模式下，当前已经报名的进行中 Derby 所在地图。
4. 自动选择模式且没有已参与赛事时，比较 `天气经验加成 + (Biome 编号 - 1) × 10%`。
5. 加权经验相同时选择 Biome 编号更高的地图。

程序只切换已解锁地图，不会自动花金币解锁。位于 Party Boat 时不会改变共享地图。

### 鱼饵

鱼饵档位范围为 `0..4`。`0` 对应当前地图的第一张基础鱼饵卡片，`1..4` 对应后续卡片。切图后会保持档位，并重新解析该地图真实使用的鱼饵 ID。

自动鱼饵默认关闭，避免首次配置时自动消费金币。购买数量必须是 100 的倍数。成功抛竿后会直接使用 `/api/game/cast` 返回的 `baitQuantity` 更新当前鱼饵库存；页面购买完成后也会使用 `/api/game/buy-bait` 响应中的 `newBaitQuantity` 确认新库存，响应没有提供库存时才等待 Equipment 页面刷新。库存仍高于补货阈值时不会重复打开 Equipment 页面。

### 运行计划

调度使用 Node.js 服务进程的本地时间。默认每轮运行 40–70 分钟、休息 5–15 分钟；夜间休息默认开启，00:00–08:00 进入 `quiet`，常规挂机延迟到 09:00 恢复。关闭夜间休息后不再进入 `quiet`。

夜间游戏自动钓鱼默认关闭。开启后，quiet 期间保留 Playwright 页面并点击游戏已有的 Auto-Cast 控件；开启自动续期时，每轮游戏 Auto-Cast 结束后会再次启动。quiet 结束、已参与赛事开始或用户关闭该设置时，会先停止仍在运行的游戏 Auto-Cast，再恢复脚本自己的钓鱼流程。游戏 Auto-Cast 暂时不可用时会保持 quiet 并继续等待，不会改走游戏 API。

Worker 会记录下一次世界 Boss、已经报名的 Derby 和公会已参与锦标赛的开始/结束时间。限时活动进行中会取消 20–40 秒长停顿，并把本轮挂机休息延后到活动结束；活动在 quiet 期间开始时会临时重建浏览器参与，结束后再次关闭浏览器，直到延迟后的早间恢复时间。

手动暂停会停止新的页面操作并关闭浏览器；恢复时创建新的浏览器 context。角色名、无头模式或页面操作超时发生变化时，运行中的 Worker 会自动安全重建，Web 服务不会中断。

### 世界 Boss

自动参与世界 Boss 默认开启，也可以在常用设置中独立关闭。Worker 通过游戏的 `getCurrentAnomaly()` 只读接口记录下一次出现时间，并在 Boss 活跃时进入 Anomalies 页面，优先点击主要弱点对应的攻击按钮。首页展示出现/结束时间、生命值、主要弱点、参与人数，以及当前角色的伤害、攻击次数和排名（接口提供排行榜时）。

### 装备管理

装备页从当前 Playwright 登录会话读取游戏的 gear 列表，不切换游戏页面，因此可以在自动钓鱼运行期间使用。页面展示 9 个穿戴槽位、已穿戴装备的 STR / INT / LUK / STA 合计，以及背包中每件装备的名称、稀有度、品质、强化等级、属性和出售价值。

背包支持名称、槽位、稀有度筛选和分页，多选后可批量出售；已穿戴或锁定的装备不能加入出售列表。穿戴戒指时需要明确选择戒指 1 或戒指 2。出售前会再次确认，服务端也会在已登录页面中重新读取装备列表，拒绝已过期、已穿戴或已锁定的选择。

装备管理要求 Worker 处于运行状态且 Playwright 浏览器已打开。手动暂停或 quiet hours 关闭浏览器期间只保留控制台，不会为了装备操作额外唤醒游戏页面。

## 收益统计

`ArcaneAnglerPage` 只观察游戏页面自己发起的成功 `/api/game/cast` 响应，不会主动构造或补发抛竿请求。统计只累计每次响应中的增量字段，不使用 `newGold` 等账户余额字段。

Web 概览保留今日抛竿、鱼获、金币和经验，并显示角色当前金币。当前金币来自角色余额快照和抛竿后的 `newGold`，只用于余额展示，不计入收益累计。升级速度使用最近一小时的连续抛竿样本计算，只累计样本间实际获得的 XP，避免重启、跨天或长时间停机稀释经验速度；至少观察到 2 杆后显示预计升级时间、XP/小时和按当前等级门槛换算的等级/小时。

收益页显示今日特殊收获、累计收益、最近 14 天每日列表、每种鱼饵和每张地图汇总。收入、鱼获价值、成本、净收益、经验和遗物使用不同颜色；各张表都包含每竿净收益。净收益按“直接金币 + 鱼获价值 - 鱼饵成本”计算；价格未知时不会猜测成本。

统计按服务器本地日期分组，保存在 `.data/stats.json`，最多保留 90 个每日汇总。旧版 v1 统计会自动迁移到 v2，并保留原累计和每日数据；旧数据没有逐竿上下文，因此迁移前的地图/鱼饵明细无法回填。

## 日志

Web 页面通过 SSE 实时接收当前状态和结构化日志，最新日志显示在最上方，页面最多保留最近 200 条并支持按级别筛选。断线后浏览器会自动重连并补发进程内保留的日志。

日志同时写入：

- stdout/stderr，供终端、systemd journal 或 PM2 日志使用。
- `.data/logs/YYYY-MM-DD.jsonl`，按 UTC 日期滚动并保留最近 7 个日志文件，供服务重启后在 Web 页面查看。服务连续运行跨日时也会自动清理过期文件，不依赖重启。

页面 console 不会被整体转发，避免登录响应或令牌进入服务日志。

## Linux 常驻运行

服务进程可交给 systemd 或 PM2 托管，选择一种即可，不要同时启动两份实例。无论使用哪一种，进程重启后都只恢复 Web 控制面，不会自动创建 Playwright Worker。

### systemd

项目提供 [systemd 服务示例](deploy/arcaneangler-copilot.service.example)。使用前修改其中的 `User`、`WorkingDirectory` 和 `ExecStart`：

```bash
command -v pnpm
sudo cp deploy/arcaneangler-copilot.service.example \
  /etc/systemd/system/arcaneangler-copilot.service
sudo systemctl daemon-reload
sudo systemctl enable --now arcaneangler-copilot
sudo journalctl -u arcaneangler-copilot -f
```

示例服务使用 `TZ=Asia/Shanghai`。Web 页面中的 quiet hours 也按这个时区计算。

### PM2

已经安装 PM2 时，可在项目目录启动并持久化控制服务：

```bash
pm2 start src/index.js \
  --name arcaneangler-copilot \
  --cwd "$PWD" \
  --interpreter "$(command -v node)" \
  --time
pm2 save
```

如需开机自启，再运行 `pm2 startup` 并按它输出的提示完成系统服务注册。PM2 默认继承服务器进程时区；quiet hours 依赖该时区，部署前应确认服务器时区符合预期。

更新代码后先完成依赖和语法检查，再重启现有进程：

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run check
pm2 restart arcaneangler-copilot --update-env
pm2 logs arcaneangler-copilot --lines 100
```

## 从旧版 `.env` 配置升级

旧版的 `ARCANE_AUTO_FISHING`、`ARCANE_MAP_MODE`、`ARCANE_BAIT_TIER`、调度时间等变量不再读取。升级后登录 Web 控制台，按旧值重新配置并保存即可；确认无误后可以从 `.env` 删除这些旧变量。

## 开发与验证

```bash
pnpm run check
pnpm run smoke:web
pnpm run smoke:reporter
pnpm run smoke:fingerprint
pnpm run smoke:fishing
pnpm run smoke:maintenance
pnpm run smoke:scheduler
pnpm run smoke:stats
pnpm run smoke:map
pnpm run smoke:world-boss
pnpm run smoke:bait
pnpm run smoke:verification
pnpm run smoke
```

`pnpm run smoke:web` 使用本地临时服务验证 challenge 登录、多终端 session、CSRF、配置持久化、收益 API、装备读取/穿戴/批量出售、SSE 和 Worker 控制；`pnpm run smoke:fishing` 验证三档抛竿延迟、验证弹窗点击竞态、独立开关/概率/时间和旧配置迁移；`pnpm run smoke:maintenance` 验证维护页识别和限频重试；`pnpm run smoke:scheduler` 验证夜间关闭、游戏 Auto-Cast 接管/续期及恢复；`pnpm run smoke:map` 还验证游戏 Auto-Cast 启停使用可信页面点击；`pnpm run smoke:world-boss` 验证世界 Boss 调度和首页字段；`pnpm run smoke:bait` 验证购买响应库存、跨地图档位和装备流程；`pnpm run smoke:verification` 验证旧版/新版拼图、Staff Question 和页面 API 兜底；`pnpm run smoke:stats` 验证 `/cast` 增量解析、v1→v2 迁移、每日/地图/鱼饵累计和持久化；`pnpm run smoke:reporter` 验证跨日日志保留。它们不会连接真实游戏账户。

## 本地数据

以下内容已被 `.gitignore` 排除：

- `.env`：Arcane Angler 登录账户和可选基础设施配置。
- `.data/settings.json`：网页自动化配置。
- `.data/sessions.json`：Web session token 的哈希、CSRF token 和过期时间。
- `.data/stats.json`：按天、地图和鱼饵聚合的收益统计。
- `.data/logs/`：Web 可查看的结构化日志。
- `.data/browser/`：Playwright 登录状态。
- `artifacts/`：异常、人机验证和测试截图。
- `node_modules/`：项目依赖。

## 注意事项

- 普通页面点击由 Playwright `Locator.click()` 驱动，产生 `isTrusted=true` 的浏览器可信事件。
- 自动验证只处理页面自行产生的题目；滑块优先通过 Playwright 产生真实鼠标点击和拖动事件，Staff Question 仅回答能够可靠解析的基础算术题。
- 网站更新页面结构后，自动化功能可能需要同步更新。
- 长期运行会持续消耗游戏内体力、鱼饵等资源。

## 免责声明

本项目与 Arcane Angler 官方无关。使用者需要自行确认并遵守 Arcane Angler 的服务条款、使用规则和所在地法律法规，并自行承担使用自动化程序可能产生的账号、游戏资源或其他风险。

## License

MIT
