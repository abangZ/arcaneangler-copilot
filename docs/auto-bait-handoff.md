# 登录奖励与自动鱼饵功能交接

## 新会话从这里开始

当前项目已经从 `tampermonkey-scripts/arcaneangler-copilot` 移动到：

```text
/Users/abang/WebstormProjects/arcaneangler-copilot
```

请在该目录开启新会话，先完整阅读本文件，再检查现有代码并继续实现。

当前目录还不是独立 Git 仓库，没有 `.git`。不要回到旧的 `tampermonkey-scripts` 目录继续修改。

## 2026-07-14 实现结果

本交接计划已经完成实现：

- 每日登录奖励会在普通弹窗关闭逻辑之前识别；异步加载完成后优先领取，再关闭弹窗。加载失败不会误报为领取成功。
- 已新增独立 `BaitFeature`，按 `VerificationFeature(0) → BaitFeature(50) → FishingFeature(100)` 调度。
- 自动鱼饵会读取当前 biome、按稳定 bait ID 定位卡片、低库存时通过页面自定义输入和二次确认购买、有库存后装备，并返回 Fishing。
- 购买按钮不可用时按金币不足等待下次检查，不触发恢复重载。
- 面板已增加“鱼饵”二级菜单，支持目标鱼饵、补货阈值、购买数量和功能开关；购买数量继续强制为 100 的倍数。
- README、架构文档、环境变量示例和 smoke 入口均已同步。

已通过：

```text
pnpm run check
pnpm run smoke
pnpm run smoke:panel
pnpm run smoke:verification
pnpm run smoke:bait
```

真实页面复核确认了 21 个侧栏按钮、Equipment 的第二个 Baits 标签、5 张 Biome 1 鱼饵卡片、库存/装备 class、自定义输入和购买/装备按钮结构。测试账号随后已不足以购买 100 个 Tinker Dough，程序按预期报告金币不足、没有点击二次确认、没有产生购买，并返回 Fishing；购买成功和装备成功分支由本地可控 smoke 覆盖。

## 本次需求

1. 登录奖励弹窗出现时，应优先点击领取，不能直接关闭。
2. 实现自动购买和使用鱼饵：
   - 用户可以选择目标鱼饵。
   - 用户可以设置补货阈值。
   - 用户可以设置每次购买数量。
   - 示例：库存低于 100 时购买 1000 个。
   - 购买数量必须是 100 的倍数。
3. 继续遵守既有约束：
   - 使用项目自己的 Playwright 与 pnpm。
   - 通过页面控件操作，不直接调用游戏接口。
   - 尽量不依赖英文文本，兼容汉化脚本。
   - 功能按独立 feature 扩展，设置放在页面注入面板的二级菜单中。

自动鱼饵管理建议默认关闭，避免首次启动就消耗游戏金币。用户选好鱼饵并主动开启后再运行。

## 实现前已经落盘的基础改动（现已完成）

断网前已经修改了以下两个文件；本轮已完成 review、接入和验证：

### `src/config.js`

已增加配置：

```text
ARCANE_AUTO_BAIT=false
ARCANE_BAIT_ID=
ARCANE_BAIT_RESTOCK_THRESHOLD=100
ARCANE_BAIT_PURCHASE_QUANTITY=1000
ARCANE_BAIT_CHECK_INTERVAL_MS=30000
```

代码中已经校验 `ARCANE_BAIT_PURCHASE_QUANTITY` 必须是 100 的倍数。

### `src/core/runtime-settings.js`

- `SETTINGS_VERSION` 已从 `1` 升到 `2`。
- 已增加 v1 到 v2 的轻量迁移。
- 已增加 `features.bait` 默认值、合并、更新和校验：

```json
{
  "enabled": false,
  "selectedBaitId": "",
  "restockThreshold": 100,
  "purchaseQuantity": 1000,
  "checkIntervalMs": 30000
}
```

- `purchaseQuantity` 当前限制为 `100..999900` 且必须是 100 的倍数。
- `restockThreshold` 当前限制为 `0..999999`。

这些改动已经完成 review，并接入其余模块。

## 登录奖励的真实页面结构与根因

现有 `ArcaneAnglerPage.dismissBlockingOverlays()` 会优先查找：

```css
div.fixed.inset-0.z-50 button.text-xl.leading-none
```

然后直接点击关闭。这会把每日登录奖励弹窗也当成普通弹窗关闭。

每日奖励弹窗是异步加载的：

1. 弹窗先出现，内容为 Loading。
2. 请求完成后才渲染奖励网格和领取按钮。
3. 领取成功后弹窗仍会短暂保留，显示领取结果。

真实结构已确认：

```text
div.fixed.inset-0.z-50.flex.items-center.justify-center
└── div.rounded-xl.p-5.max-w-md...w-full
    ├── header
    │   ├── h2
    │   └── button.text-xl.leading-none       # 关闭
    ├── div.flex.flex-wrap...gap-2.mb-4       # 加载完成后的奖励网格
    └── button.w-full.py-2.5.rounded-lg...    # 可领取时出现
```

测试账号的 Day 1 奖励已于 2026-07-14 通过页面按钮真实领取成功。本次检查没有直接调用领取接口。

建议实现：

1. 在 `dismissBlockingOverlays()` 的普通关闭逻辑之前调用独立方法，例如 `claimDailyLoginRewardIfPresent()`。
2. 用弹窗容器、卡片尺寸 class、奖励网格和按钮结构识别，不依赖标题文字。
3. 弹窗处于 Loading 时等待奖励网格或错误状态出现，不能立刻落入普通关闭逻辑。
4. 如果领取按钮存在且可用，点击它并等待按钮消失或领取结果出现。
5. 领取完成后再点击关闭按钮。
6. 如果奖励已经领取，页面没有领取按钮，此时可以直接关闭并记录“今日奖励已领取”。
7. 如果状态请求失败，避免把错误误报为成功领取；可以记录错误后关闭，或抛错交给恢复机制。

## 鱼饵页面的真实结构

鱼饵购买不在侧栏 `Shop`，而在侧栏 `Equipment` 页的第二个标签中。

### 侧栏

桌面布局下侧栏导航有 21 个直接子按钮。已确认的稳定结构索引：

```text
0  Fishing
4  Equipment
20 Options
```

可以把 `getSidebarButton(destination)` 扩展为结构索引映射，并保留英文文本作为最后兜底。主要逻辑不要依赖文本。

### Equipment 标签

```css
div.flex.gap-2.mb-6.border-b.border-gray-700 > button
```

- 第 1 个按钮：Rods
- 第 2 个按钮：Baits

因此可以直接点击 `nth(1)`，不需要匹配 “Baits” 文本。

### 鱼饵卡片

切换到 Baits 标签后，卡片选择器为：

```css
div.max-w-6xl.mx-auto div.space-y-3 > div.p-4.rounded-lg.border-2
```

当前 Biome 1 实际显示 5 张卡片：

1. Stale Bread Crust，免费且当前已装备。
2. Tinker Dough，库存 0。
3. Tinker Larva，库存 0。
4. River Nymph，库存 0。
5. Tinker Jig，库存 0。

页面自身也是通过 `window.getBaitsForBiome(currentBiome).map(...)` 按顺序渲染卡片。因此推荐：

1. 从当前钓鱼页的 `[B1]` 这类稳定编号标记解析 biome ID；只依赖 `B` 和数字，不依赖 biome 英文名。
2. 只读调用页面内已有的 `window.getBaitsForBiome(biomeId)` 获取 `{ id, name, price }` 列表。该操作不发送 HTTP 请求。
3. 根据用户配置的稳定 bait ID 找到列表索引。
4. 用同一索引选择 DOM 卡片。

这样即使汉化脚本修改了卡片文本，仍可按 bait ID 和结构顺序操作。

### 库存与装备状态

- 非免费鱼饵的库存位于卡片右上区域：

```css
div.text-right.ml-2 > span.text-xs
```

如果已经装备，右上区域会先有 EQUIPPED badge；库存是最后一个 `span.text-xs`。只解析其中数字并移除千位逗号，不要依赖 “Owned” 文本。

- 当前已装备卡片包含 class：

```text
border-yellow-400
```

- 装备按钮是卡片中的最后一个全宽按钮：

```css
button.w-full.py-2.rounded.font-bold.text-sm
```

按钮禁用可能表示“已经装备”或“库存为 0”，需要结合卡片装备 class 和库存判断。

### 购买控件与二次确认

每张收费鱼饵卡片包含：

```html
<input type="number" min="1" max="999999" placeholder="Custom amount">
```

输入框与自定义购买按钮在同一个 `div.flex.gap-2` 内。推荐使用自定义输入框，以支持任意 100 倍数的配置：

1. 填入 `purchaseQuantity`。
2. 确认同级购买按钮可用。
3. 第一次点击会进入确认状态，按钮 class 会出现 `bg-red-600`。
4. 第二次点击才真正购买。
5. 可以监听 `/api/game/buy-bait` 响应来确认页面操作结果，但不能自行调用该接口。
6. 等待库存数字至少增加本次购买量。

装备同理：点击页面装备按钮，可以监听 `/api/game/equip-bait` 响应和 `border-yellow-400` 状态变化，但不能直接调用接口。

如果购买按钮因金币不足而禁用，应把状态报告为“金币不足，等待下次检查”，不要让恢复机制反复刷新页面。

## 推荐的实现结构

### 新增 `src/features/bait-feature.js`

建议：

```text
id: bait
label: 自动鱼饵
priority: 50
```

当前优先级：

```text
VerificationFeature  0
BaitFeature         50
FishingFeature     100
```

建议流程：

1. 未到 `checkIntervalMs` 时返回 `false`，继续让钓鱼功能运行。
2. 未选择 `selectedBaitId` 时记录等待状态并返回 `false`。
3. 确认当前在游戏 shell，处理可能存在的奖励/普通弹窗。
4. 从钓鱼页读取 biome ID 和当前 biome 的 bait catalog。
5. 如果目标 bait 在当前 biome 不可用，报告状态并延后检查。
6. 进入 Equipment → Baits，读取库存和装备状态。
7. 当 `stock < restockThreshold` 时，按 `purchaseQuantity` 购买一次。
8. 有库存但尚未装备时，点击装备。
9. 返回 Fishing 页面。
10. 更新下一次检查时间。

配置发生变化时应立即重置检查时间。页面恢复时 `reset()` 也应允许立即检查。

### `src/site/arcane-angler-page.js` 建议增加的方法

名称可调整，但职责应留在页面适配层：

```text
claimDailyLoginRewardIfPresent()
getCurrentBiomeId()
getBaitCatalog(biomeId)
openBaitEquipment()
inspectBait(baitId)
buyBaitThroughUi(card, quantity, previousStock)
equipBaitThroughUi(card)
```

Feature 不应直接持有 Locator。

### 面板设置

在 `src/ui/copilot-panel.js` 增加第 4 个二级菜单“鱼饵”：

```text
自动管理鱼饵      checkbox
目标鱼饵          select
低于此库存时补货  number
每次购买数量      number, step=100
```

购买数量输入建议使用：

```html
min="100" max="999900" step="100"
```

目标鱼饵下拉框可以在 Shadow DOM 内只读枚举所有 biome 的 `window.getBaitsForBiome()`，按 bait ID 去重：

```js
{ value: bait.id, label: bait.name }
```

Shadow DOM 可以避免普通汉化脚本改写这些 option。设置中持久化 bait ID，不持久化可见名称。

需要同步增加 action key、设置 label、render 回填，以及把 subtabs 网格从 3 列改为 4 列。

## 已完成的文件清单

- `.env.example`：已加入 5 个 bait 配置项。
- `src/config.js`：已复核基础改动，并补齐 bait 数值上限校验。
- `src/core/runtime-settings.js`：已复核 v2 迁移与 bait 设置。
- `src/site/arcane-angler-page.js`：已实现登录奖励和鱼饵页面操作。
- `src/features/bait-feature.js`：已新增独立 feature。
- `src/index.js`：已在 FishingFeature 前注册 BaitFeature。
- `src/ui/copilot-panel.js`：已增加鱼饵二级菜单与设置处理。
- `scripts/panel-smoke.js`：已补 bait 设置结构、交互和校验断言。
- `scripts/bait-smoke.js`：已覆盖二次购买确认、库存更新、装备、检查间隔、金币不足和奖励领取优先级。
- `package.json`：已把新文件加入 `check`，并增加 `smoke:bait`。
- `README.md`：已更新用户可见功能、配置表和面板说明。
- `docs/architecture.md`：已改为当前真实架构和执行流。

## 验证清单（已完成）

至少执行：

```bash
pnpm run check
pnpm run smoke
pnpm run smoke:panel
pnpm run smoke:verification
pnpm run smoke:bait
```

后续真实账号回归建议：

1. 使用现有 `.env`，不要在日志或文档中打印密码。
2. 先保持 `ARCANE_AUTO_BAIT=false`，检查面板下拉框和设置持久化。
3. 选择当前 biome 可用的收费鱼饵，将购买量设为 100，做一次小额真实购买和装备验证；这是测试账号，用户已经授权用于登录和测试。
4. 确认购买后库存增加、目标鱼饵已装备、页面返回 Fishing 并继续抛竿。
5. 再把购买量设为 1000，确认面板校验允许；非 100 倍数必须被拒绝且保留原设置。
6. 用金币不足的鱼饵确认不会反复重载页面。
7. 登录奖励今日已经领取，领取分支可用可控 smoke 覆盖；真实页面可验证“已领取时正常关闭”。

## 现有项目状态与注意事项

- `.env` 中已有测试账号，且被 `.gitignore` 排除。不要把账号密码复制到 README、测试或本交接文档。
- `.data/browser` 中已有登录会话。
- 项目内已有真实验证自动化及 `smoke:verification`，不要回退为直接接口调用。
- `README.md` 已改为“自动优先领取每日登录奖励”。
- 当前目录没有 Git 仓库，因此新会话修改前后需要用文件检查和测试确认；如果用户初始化 Git，再按正常 diff 流程处理。
- 临时检查脚本位于 `/tmp/inspect-arcane-bait.mjs`，不是项目文件，不需要迁移或提交。
- 页面结构检查截图：
  - `artifacts/inspect-state.png`：登录奖励弹窗和 Fishing 页。
  - `/tmp/arcane-bait-inspection.png`：Equipment → Baits 的真实页面。

## 后续会话建议

可以直接发送：

```text
请先完整阅读 docs/auto-bait-handoff.md，然后基于现有实现处理后续问题。继续遵守只通过页面控件操作、不直接调用游戏接口、兼容汉化和按独立 feature 扩展的约束。
```
