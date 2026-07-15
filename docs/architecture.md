# 架构与扩展指南

## 目标

Arcane Angler Copilot 将浏览器会话、站点页面操作、自动化功能和状态报告分离。新增功能时不应直接扩展 `src/index.js`，也不应让一个功能读取另一个功能的 DOM Locator。

当前的数据流是：

```text
.env ──> config ──> RuntimeSettings（只读）──> AutomationEngine
                                           ├── OperationScheduler
                                           ├── FishingFeature
                                           ├── BaitFeature
                                           └── VerificationFeature

AutomationEngine / features ──> ArcaneAnglerPage ──> Playwright Page
              ├──> browserProfile / browserLifecycle ──> Playwright Context
              └──> StatusReporter ──> stdout / stderr ──> systemd journal
```

## 模块职责

### `src/core/automation-engine.js`

- 注册并按 `priority` 从小到大调度功能。
- 处理总开关、连续异常、截图和页面恢复。
- 不包含钓鱼、商店或背包的 DOM 细节。
- 在任何页面初始化或 feature 调度前执行挂机时间门禁。
- 进入夜间状态时关闭 Playwright 持久化上下文，退出夜间状态时重建页面和页面适配器引用。
- 浏览器页面不可恢复地关闭时让进程失败退出，交给 systemd 重启。

### `src/core/operation-scheduler.js`

- 默认随机运行 40–70 分钟，再随机休息 5–15 分钟。
- 按 Node.js 进程本地时间在 00:00–08:00 禁止自动操作；开始、结束小时可通过环境变量调整。
- 配置关闭自动化或没有启用 feature 时重置当前运行周期，重启并恢复配置后开始新的随机周期。
- 对页面点击暴露实时许可状态，避免一个较长 feature 跨过休息或夜间边界后继续点击。
- 状态机包含 `idle`、`active`、`rest`、`quiet` 和 `disabled`；夜间状态优先于其他状态。

每轮调度会调用已启用功能的 `tick(settings)`。返回 `true` 表示本轮已处理，后续低优先级功能不再执行；返回 `false` 时引擎继续尝试下一个功能。

### `src/core/browser-profile.js`

- 使用 Playwright 内置完整 Chromium 的新无头模式，不使用默认 Headless Shell。
- 从实际 Chromium 可执行文件读取版本，生成同平台、同主版本的桌面 Chrome User-Agent。
- 统一设置 context UA，保证网络请求头和 `navigator.userAgent` 一致。
- 关闭 Blink 的 `AutomationControlled` 标记，减少默认 `navigator.webdriver` 暴露。
- 这里只处理稳定的基础浏览器身份，不做随机 canvas、WebGL、音频或字体伪装。

### `src/site/arcane-angler-page.js`

- 封装登录、角色选择、侧栏导航、每日奖励、鱼饵页面操作、经典模式切换和抛竿控件查找。
- 统一处理当前站点 DOM 与 API 响应细节。
- 新功能需要页面能力时，应优先在这里增加语义方法，例如 `openShop()`、`getBaitStock()`、`buyBait()`，而不是把 Locator 写入 feature。

Locator 的优先级：

1. 表单类型、直接父子关系和稳定控件结构。
2. 状态 class、`disabled`、`localStorage` 和请求路径。
3. 图标或不参与翻译的属性。
4. 英文文本只作为兼容兜底。

普通页面操作通过 Playwright `Locator.click()` 进入浏览器输入通道，事件为 `isTrusted=true`；禁止在页面上下文调用 `HTMLElement.click()`。只有 Human Verification 需要额外的拟人鼠标轨迹和滑块拖动。

指定 `ARCANE_CHARACTER` 时必须按角色展示名匹配，这是有意保留的文本依赖；角色名属于用户数据，不是界面翻译文案。

### `src/features/fishing-feature.js`

- 维护自动钓鱼自己的初始化状态与停滞时间。
- 确保经典模式、等待可用按钮并执行点击。
- 不负责登录、全局恢复和日志格式化。

### `src/features/bait-feature.js`

- 优先级为 `50`，位于人机验证之后、自动钓鱼之前。
- 按配置间隔检查当前 biome 的目标鱼饵库存，必要时购买一次并装备。
- 配置变化和页面恢复后允许立即检查；未到检查时间时返回 `false`，不阻塞自动钓鱼。
- 只编排语义操作，不持有 Playwright Locator；所有页面结构和响应确认都留在页面适配层。
- 金币不足或按钮不可用时等待下次检查，不触发页面恢复循环。

### `src/core/runtime-settings.js`

- 将已经由 `config` 校验过的 `.env` 参数映射为按 feature 分组的只读快照。
- 不持久化设置，也不在运行中动态修改；变更配置需要重启服务。
- 不包含账号密码等站点认证数据。

设置结构按 feature 分组：

```json
{
  "automationEnabled": true,
  "features": {
    "fishing": {
      "enabled": true,
      "enforceClassicMode": true,
      "clickDelayMinMs": 250,
      "clickDelayMaxMs": 800
    },
    "verification": {
      "enabled": true
    },
    "bait": {
      "enabled": false,
      "selectedBaitId": "",
      "restockThreshold": 100,
      "purchaseQuantity": 1000,
      "checkIntervalMs": 30000
    }
  }
}
```

`.env` 是唯一配置来源，旧版 `.data/settings.json` 不再读取。

### `src/core/status-reporter.js`

- 汇总 level、phase、当前 feature、目标、事件和累计抛竿次数。
- 将普通状态写入 stdout，将错误状态写入 stderr，方便 systemd journal 收集。
- `record: false` 仅用于不需要落日志的高频瞬时状态；关键状态更新必须保留默认输出。
- 对完全相同的连续状态去重，避免配置关闭时的轮询刷屏。

新增 feature 时应增加清晰的 `activeFeature`、`target` 和 `message`，不要把页面 console 整体转发到服务端。

## 自动鱼饵执行流

1. 在 Fishing 页面读取 `[B数字]` 标记，并通过页面已有的 `getBaitsForBiome()` 获取稳定 ID 目录。
2. 按侧栏结构索引进入 Equipment，再点击第二个标签打开 Baits。
3. 用目录索引定位卡片，通过右上库存数字和 `border-yellow-400` class 读取状态。
4. 库存低于阈值时填写自定义数量，依次点击购买和二次确认按钮，并等待库存增加。
5. 有库存但未装备时点击页面装备按钮，等待卡片装备状态更新。
6. 返回 Fishing 页面，等待下一次检查；购买数量固定校验为 100 的倍数。

目标鱼饵的稳定 ID 通过 `ARCANE_BAIT_ID` 配置。页面仍通过 `window.BIOMES` 和 `getBaitsForBiome()` 获取当前 biome 的鱼饵目录；配置缺失或不可用时，控制台会列出当前 biome 的可选名称和稳定 ID。默认不开启自动鱼饵，避免首次启动就消费金币。

## 恢复与安全边界

- 连续异常由引擎统一计数，达到阈值后截图并重载页面。
- Human Verification 由独立高优先级 feature 处理，只操作页面已经渲染的入口、滑块和提交按钮；失败后回退人工处理。
- 页面控制台不会被整体转发，因为站点日志可能包含登录响应或令牌。
- 自动化只通过页面 UI 操作，不构造 `/api/game/cast` 请求。
- 每日奖励、鱼饵购买和装备同样只操作页面控件；响应监听只用于确认页面操作结果。
- `.env`、浏览器状态和截图都必须保持在 Git 忽略范围内。
