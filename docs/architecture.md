# 架构与扩展指南

## 目标

Arcane Angler Copilot 将浏览器会话、站点页面操作、自动化功能和控制面板分离。新增功能时不应直接扩展 `src/index.js`，也不应让一个功能读取另一个功能的 DOM Locator。

当前的数据流是：

```text
.env ──> config ──> RuntimeSettings ──> AutomationEngine
                                      ├── FishingFeature
                                      ├── BaitFeature
                                      └── VerificationFeature

AutomationEngine / features ──> ArcaneAnglerPage ──> Playwright Page
              │
              └──> StatusReporter ──> CopilotPanel ──> Shadow DOM
```

## 模块职责

### `src/core/automation-engine.js`

- 注册并按 `priority` 从小到大调度功能。
- 处理总开关、连续异常、截图和页面恢复。
- 不包含钓鱼、商店或背包的 DOM 细节。

每轮调度会调用已启用功能的 `tick(settings)`。返回 `true` 表示本轮已处理，后续低优先级功能不再执行；返回 `false` 时引擎继续尝试下一个功能。

### `src/site/arcane-angler-page.js`

- 封装登录、角色选择、侧栏导航、每日奖励、鱼饵页面操作、经典模式切换和抛竿控件查找。
- 统一处理当前站点 DOM 与 API 响应细节。
- 新功能需要页面能力时，应优先在这里增加语义方法，例如 `openShop()`、`getBaitStock()`、`buyBait()`，而不是把 Locator 写入 feature。

Locator 的优先级：

1. 表单类型、直接父子关系和稳定控件结构。
2. 状态 class、`disabled`、`localStorage` 和请求路径。
3. 图标或不参与翻译的属性。
4. 英文文本只作为兼容兜底。

指定 `ARCANE_CHARACTER` 时必须按角色展示名匹配，这是有意保留的文本依赖；角色名属于用户数据，不是界面翻译文案。

### `src/features/fishing-feature.js`

- 维护自动钓鱼自己的初始化状态与停滞时间。
- 确保经典模式、等待可用按钮并执行点击。
- 不负责登录、全局恢复和面板渲染。

### `src/features/bait-feature.js`

- 优先级为 `50`，位于人机验证之后、自动钓鱼之前。
- 按配置间隔检查当前 biome 的目标鱼饵库存，必要时购买一次并装备。
- 配置变化和页面恢复后允许立即检查；未到检查时间时返回 `false`，不阻塞自动钓鱼。
- 只编排语义操作，不持有 Playwright Locator；所有页面结构和响应确认都留在页面适配层。
- 金币不足或按钮不可用时等待下次检查，不触发页面恢复循环。

### `src/core/runtime-settings.js`

- 合并 `.env` 默认值与 `.data/settings.json` 持久化值。
- 校验来自页面面板的设置更新。
- 只保存非敏感运行设置；账号密码不会进入该文件。

设置结构按 feature 分组：

```json
{
  "version": 2,
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

修改结构时应递增 `version`，并在加载阶段提供旧版本迁移，而不是直接假设本地文件已更新。

### `src/ui/copilot-panel.js`

- 使用 Shadow DOM 隔离游戏样式和汉化脚本的普通 DOM 扫描。
- 通过 Playwright `exposeBinding` 将开关和输入值发送给 Node 进程。
- 只展示状态和修改 `RuntimeSettings`，不直接点击游戏按钮。

新增 feature 时，在设置页增加一个对应二级菜单，并只提交该 feature 的设置 patch。

## 自动鱼饵执行流

1. 在 Fishing 页面读取 `[B数字]` 标记，并通过页面已有的 `getBaitsForBiome()` 获取稳定 ID 目录。
2. 按侧栏结构索引进入 Equipment，再点击第二个标签打开 Baits。
3. 用目录索引定位卡片，通过右上库存数字和 `border-yellow-400` class 读取状态。
4. 库存低于阈值时填写自定义数量，依次点击购买和二次确认按钮，并等待库存增加。
5. 有库存但未装备时点击页面装备按钮，等待卡片装备状态更新。
6. 返回 Fishing 页面，等待下一次检查；购买数量固定校验为 100 的倍数。

面板下拉框通过 `window.BIOMES` 和 `getBaitsForBiome()` 只读枚举所有鱼饵，并将稳定 ID 持久化到设置。默认不开启自动鱼饵，避免首次启动就消费金币。

## 恢复与安全边界

- 连续异常由引擎统一计数，达到阈值后截图并重载页面。
- Human Verification 由独立高优先级 feature 处理，只操作页面已经渲染的入口、滑块和提交按钮；失败后回退人工处理。
- 页面控制台不会被整体转发，因为站点日志可能包含登录响应或令牌。
- 自动化只通过页面 UI 操作，不构造 `/api/game/cast` 请求。
- 每日奖励、鱼饵购买和装备同样只操作页面控件；响应监听只用于确认页面操作结果。
- `.env`、浏览器状态、运行设置和截图都必须保持在 Git 忽略范围内。
