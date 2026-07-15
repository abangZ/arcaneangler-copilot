# Arcane Angler Copilot

Arcane Angler Copilot 是一个基于 Playwright 的 Arcane Angler 自动钓鱼程序，适合在本地电脑或 Linux 服务器上长期运行。

程序默认以无头模式启动 Chromium，自动登录 [Arcane Angler](https://arcaneangler.com/)、选择角色、切换到经典固定按钮模式并持续钓鱼。所有运行参数通过环境变量配置，状态和异常会输出到控制台，也可以通过 systemd journal 查看。

## 功能

- 使用账号密码自动登录，并保存浏览器登录状态。
- 自动选择角色；支持指定角色名。
- 自动切换到经典固定按钮模式。
- 自动等待并点击可用的抛竿按钮。
- 每轮随机运行 40–70 分钟，再随机休息 5–15 分钟。
- 按服务器本地时间在 00:00–08:00 完全停止自动页面操作并关闭 Playwright 浏览器。
- 支持固定目标地图，或每小时按已参与赛事、天气经验和 Biome 等级自动选择地图。
- 可用 `0..4` 档位选择当前地图的目标鱼饵，并在库存低于阈值时通过 Equipment 页面自动补货和装备。
- 通过结构化日志输出运行状态、当前功能、当前目标、事件和累计抛竿次数。
- 使用环境变量管理运行开关和参数，适合无头服务部署。
- 使用 Chromium 新无头模式，并保持网络请求与页面环境的 User-Agent 一致。
- 自动优先领取每日登录奖励，并跳过会遮挡操作的新手引导。
- 普通页面点击使用 Playwright 浏览器输入通道，产生 `isTrusted=true` 的可信点击事件；没有调用页面元素的 `HTMLElement.click()`。
- 页面卡住或连续出错时保存截图并自动尝试恢复。
- 检测到 Human Verification 时，通过真实鼠标点击和滑块拖动自动完成；失败后暂停并等待人工处理。
- 支持无头模式和 systemd，适合 Linux 服务器长期运行。
- 不依赖英文界面文本，可与常见汉化脚本同时使用。

## 环境要求

- Node.js 20 或更高版本
- pnpm 9
- Linux、macOS，或其他 Playwright 支持的平台

## 安装

安装项目依赖：

```bash
pnpm install
```

安装 Chromium：

```bash
pnpm run install:browser
```

Linux 服务器需要同时安装 Chromium 的系统依赖：

```bash
pnpm exec playwright install --with-deps chromium
```

## 配置

复制配置模板：

```bash
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，至少填写登录账号和密码：

```dotenv
ARCANE_USERNAME=your-login-username
ARCANE_PASSWORD=your-password
```

这里需要填写 Arcane Angler 的 `Username (Login)`，不是公开展示的 Profile Name。

常用配置：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ARCANE_USERNAME` | 必填 | 登录用户名 |
| `ARCANE_PASSWORD` | 必填 | 登录密码 |
| `ARCANE_CHARACTER` | 空 | 指定角色展示名；为空时选择第一个角色 |
| `ARCANE_HEADLESS` | `true` | 是否使用无头模式 |
| `ARCANE_AUTOMATION_ENABLED` | `true` | 自动化总开关 |
| `ARCANE_AUTO_FISHING` | `true` | 是否启用自动钓鱼 |
| `ARCANE_MAP_MODE` | `off` | 地图模式：`off`、`fixed` 或 `auto` |
| `ARCANE_TARGET_BIOME_ID` | 空 | 固定地图编号；`ARCANE_MAP_MODE=fixed` 时必填 |
| `ARCANE_MAP_CHECK_INTERVAL_MS` | `3600000` | 地图和赛事检查间隔，默认 1 小时 |
| `ARCANE_AUTO_BAIT` | `false` | 是否自动补货并装备目标鱼饵；默认关闭以免首次启动消耗金币 |
| `ARCANE_BAIT_TIER` | `0` | 当前地图的鱼饵档位，范围 `0..4`；`0` 是第一张基础鱼饵，`4` 是第五张鱼饵 |
| `ARCANE_BAIT_RESTOCK_THRESHOLD` | `100` | 库存低于该值时购买一次 |
| `ARCANE_BAIT_PURCHASE_QUANTITY` | `1000` | 每次购买数量，必须是 100 的倍数 |
| `ARCANE_BAIT_CHECK_INTERVAL_MS` | `30000` | 鱼饵库存检查间隔，范围 5000 到 3600000 毫秒 |
| `ARCANE_ACTIVE_MIN_MINUTES` | `40` | 每轮挂机的最短运行分钟数 |
| `ARCANE_ACTIVE_MAX_MINUTES` | `70` | 每轮挂机的最长运行分钟数 |
| `ARCANE_REST_MIN_MINUTES` | `5` | 两轮挂机之间的最短休息分钟数 |
| `ARCANE_REST_MAX_MINUTES` | `15` | 两轮挂机之间的最长休息分钟数 |
| `ARCANE_QUIET_START_HOUR` | `0` | 每日停止自动操作的本地整点小时 |
| `ARCANE_QUIET_END_HOUR` | `8` | 每日恢复自动操作的本地整点小时 |
| `ARCANE_AUTO_VERIFY` | `true` | 是否使用页面控件自动完成人机验证 |
| `ARCANE_ENFORCE_CLASSIC_MODE` | `true` | 是否自动切换经典固定按钮模式 |
| `ARCANE_CLICK_DELAY_MIN_MS` | `250` | 按钮可用后的最小点击延迟 |
| `ARCANE_CLICK_DELAY_MAX_MS` | `800` | 按钮可用后的最大点击延迟 |

其他可选配置请查看 [.env.example](.env.example)。

修改 `.env` 后，需要重启进程或 systemd 服务才能使新配置生效。

固定地图示例：

```dotenv
ARCANE_MAP_MODE=fixed
ARCANE_TARGET_BIOME_ID=12
```

自动选图示例：

```dotenv
ARCANE_MAP_MODE=auto
ARCANE_MAP_CHECK_INTERVAL_MS=3600000
```

自动模式每次检查会先通过 Events 页面的一键报名按钮报名所有当前可参与的 Derby，再按以下优先级选图：

1. 当前进行中且已经报名的 Derby 所在地图。
2. 没有已参与的进行中 Derby 时，在已解锁地图中比较 `天气经验加成 + (Biome 编号 - 1) × 10%`。
3. 加权经验相同时选择 Biome 编号更高的地图。

程序只切换已解锁地图，不会自动花金币解锁。角色位于 Party Boat 时也不会自动切图，避免改变队伍共享地图；离开 Party Boat 后会在下次检查时继续。

自动鱼饵按当前地图 Baits 页的固定顺序选择：`0` 对应第一张基础鱼饵卡片，`1` 到 `4` 依次对应后续四张。切换地图后会保持相同档位，并自动解析该地图实际使用的鱼饵 ID，用户不需要查找 ID。若某张地图没有配置的档位，程序会在控制台列出该地图可用的档位和名称，并等待下次检查。

## 运行

```bash
pnpm start
```

首次使用时可以显示浏览器，方便确认登录和角色选择过程：

```dotenv
ARCANE_HEADLESS=false
```

登录状态保存在 `.data/browser`。登录失效时，程序会使用 `.env` 中的账号密码重新登录。

挂机调度使用 Node.js 进程的本地时间。状态机在 `active`、`rest`、`quiet` 和 `disabled` 状态之间切换：默认每轮运行 40–70 分钟并休息 5–15 分钟；00:00–08:00 进入 `quiet`，关闭持久化浏览器上下文，不登录，也不执行钓鱼、领奖、买饵或验证操作；夜间结束后重新创建 Playwright 页面并开始新一轮挂机。

按 `Ctrl+C` 可以停止程序。程序也支持 `SIGINT` 和 `SIGTERM`，会在退出前关闭浏览器。

## 控制台日志

启动配置、调度状态、当前功能和目标、关键事件、异常以及累计抛竿次数都会输出到标准输出或标准错误，例如：

```text
[2026-07-15T08:00:00.000Z] [RUNNING/fishing] [自动钓鱼] 目标：等待下一次抛竿 完成第 128 次抛竿。 抛竿：128
```

直接运行时可以在终端查看日志；使用 systemd 时执行以下命令持续查看：

```bash
sudo journalctl -u arcaneangler-copilot -f
```

## Linux 服务器运行

建议使用普通用户运行，不要使用 root。完成安装和配置后，可以直接执行：

```bash
pnpm start
```

项目提供了 [systemd 服务示例](deploy/arcaneangler-copilot.service.example)。使用前需要修改其中的 `User`、`WorkingDirectory` 和 `ExecStart`：

```bash
command -v pnpm
timedatectl status
sudo cp deploy/arcaneangler-copilot.service.example \
  /etc/systemd/system/arcaneangler-copilot.service
sudo systemctl daemon-reload
sudo systemctl enable --now arcaneangler-copilot
sudo journalctl -u arcaneangler-copilot -f
```

请保留 `.data/browser`，避免服务重启后重复登录。出现 Human Verification 时，程序会先保存截图并自动操作页面验证；自动验证失败时会暂停，等待人工处理。

调度时间以服务进程的时区为准。示例服务使用 `TZ=Asia/Shanghai`；如果服务器不在该时区，请修改该行，或删除它以使用系统本地时区。夜间关闭浏览器可释放 Chromium 资源，08:00 后会复用 `.data/browser` 登录状态重新启动。服务配置了异常自动重启、启动频率限制、私有文件权限和 journal 日志，浏览器进程意外退出后主进程也会失败退出，由 systemd 拉起新实例。

## 开发与验证

```bash
# 启动程序
pnpm start

# 检查公开登录页面和 Playwright 安装
pnpm run smoke

# 运行语法检查
pnpm run check

# 验证环境变量设置映射和控制台状态输出
pnpm run smoke:reporter

# 验证无头 Chromium 的基础浏览器指纹
pnpm run smoke:fingerprint

# 验证奖励领取与鱼饵购买、装备流程
pnpm run smoke:bait

# 验证赛事一键报名、地图选择算法和可信切图点击
pnpm run smoke:map

# 验证人机验证的真实鼠标事件
pnpm run smoke:verification

# 验证挂机运行、休息和夜间时段边界
pnpm run smoke:scheduler
```

## 本地数据

以下内容已被 `.gitignore` 排除，不应提交到版本库：

- `.env`：账号密码和本地配置。
- `.data/`：浏览器登录状态。
- `artifacts/`：异常、人机验证和测试截图。
- `node_modules/`：项目依赖。

## 注意事项

- 本程序只操作游戏页面，不直接构造 `/api/game/cast` 请求。
- 鱼饵购买和装备只点击 Equipment 页面已有控件；程序不会自行构造购买或装备请求。
- 普通页面点击由 Playwright `Locator.click()` 驱动，它产生浏览器可信事件；代码中不使用 `HTMLElement.click()`。
- 自动验证只读取页面已经渲染的题面，并通过 Playwright 产生真实鼠标点击和拖动事件，不直接调用验证码接口。
- 网站更新页面结构后，自动化功能可能需要同步更新。
- 长期运行会持续消耗游戏内体力、鱼饵等资源。

## 免责声明

本项目与 Arcane Angler 官方无关。使用者需要自行确认并遵守 Arcane Angler 的服务条款、使用规则和所在地法律法规，并自行承担使用自动化程序可能产生的账号、游戏资源或其他风险。

## License

MIT
