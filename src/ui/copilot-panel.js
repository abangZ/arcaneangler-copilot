const BINDING_NAME = '__arcaneCopilotDispatch';

const SETTING_LABELS = {
    automationEnabled: '自动化总开关',
    fishingEnabled: '自动钓鱼',
    autoBaitEnabled: '自动管理鱼饵',
    selectedBaitId: '目标鱼饵',
    restockThreshold: '鱼饵补货阈值',
    purchaseQuantity: '鱼饵购买数量',
    autoVerificationEnabled: '自动过验证',
    enforceClassicMode: '固定按钮模式',
    clickDelayMinMs: '最小点击延迟',
    clickDelayMaxMs: '最大点击延迟',
};

export class CopilotPanel {
    constructor({ page, settings, reporter }) {
        this.page = page;
        this.settings = settings;
        this.reporter = reporter;
        this.unsubscribeSettings = null;
        this.unsubscribeReporter = null;
    }

    async start() {
        await this.page.exposeBinding(
            BINDING_NAME,
            async (_source, action) => this.handleAction(action),
        );

        this.unsubscribeSettings = this.settings.subscribe(
            () => this.render(),
        );
        this.unsubscribeReporter = this.reporter.subscribe(
            () => this.render(),
        );

        await this.render();
    }

    stop() {
        this.unsubscribeSettings?.();
        this.unsubscribeReporter?.();
    }

    async handleAction(action) {
        try {
            let patch;

            switch (action?.key) {
                case 'automationEnabled':
                    patch = { automationEnabled: action.value };
                    break;
                case 'fishingEnabled':
                    patch = {
                        features: {
                            fishing: { enabled: action.value },
                        },
                    };
                    break;
                case 'autoVerificationEnabled':
                    patch = {
                        features: {
                            verification: { enabled: action.value },
                        },
                    };
                    break;
                case 'autoBaitEnabled':
                    patch = {
                        features: {
                            bait: { enabled: action.value },
                        },
                    };
                    break;
                case 'selectedBaitId':
                    patch = {
                        features: {
                            bait: { selectedBaitId: String(action.value) },
                        },
                    };
                    break;
                case 'restockThreshold':
                case 'purchaseQuantity':
                    patch = {
                        features: {
                            bait: { [action.key]: Number(action.value) },
                        },
                    };
                    break;
                case 'enforceClassicMode':
                    patch = {
                        features: {
                            fishing: { enforceClassicMode: action.value },
                        },
                    };
                    break;
                case 'clickDelayMinMs':
                case 'clickDelayMaxMs':
                    patch = {
                        features: {
                            fishing: { [action.key]: Number(action.value) },
                        },
                    };
                    break;
                default:
                    throw new Error('未知的面板设置。');
            }

            await this.settings.update(patch);
            await this.reporter.update({
                message: `${SETTING_LABELS[action.key]}已保存。`,
            });
        } catch (error) {
            await this.reporter.update({
                level: 'error',
                phase: 'settings',
                target: '保存面板设置',
                message: `设置保存失败：${error.message}`,
            });
        }
    }

    async getBaitOptions() {
        return this.page.evaluate(() => {
            if (typeof window.getBaitsForBiome !== 'function') {
                return [];
            }

            const biomeValues = Array.isArray(window.BIOMES)
                ? window.BIOMES
                : Object.values(window.BIOMES || {});
            const biomeIds = biomeValues.map(biome =>
                Number(biome?.id ?? biome?.biome_id ?? biome),
            ).filter(id => Number.isSafeInteger(id) && id > 0);
            const options = new Map();

            for (const biomeId of biomeIds) {
                for (const bait of window.getBaitsForBiome(biomeId) || []) {
                    const value = String(bait.id || '');

                    if (value && !options.has(value)) {
                        options.set(value, {
                            value,
                            label: String(bait.name || value),
                        });
                    }
                }
            }

            return [...options.values()];
        }).catch(() => []);
    }

    async ensureMounted() {
        await this.page.evaluate(bindingName => {
            const hostId = 'arcane-copilot-panel-host';
            let host = document.getElementById(hostId);

            if (host?.shadowRoot) {
                return;
            }

            host?.remove();
            host = document.createElement('div');
            host.id = hostId;
            document.body.append(host);

            const shadow = host.attachShadow({ mode: 'open' });
            const style = document.createElement('style');

            style.textContent = `
                :host {
                    all: initial;
                    color-scheme: dark;
                    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                }
                * { box-sizing: border-box; }
                button, input, select { font: inherit; }
                .panel {
                    position: fixed;
                    top: 16px;
                    right: 16px;
                    z-index: 2147483647;
                    width: min(360px, calc(100vw - 32px));
                    color: #e5edf8;
                    background: rgba(11, 18, 32, 0.96);
                    border: 1px solid rgba(96, 165, 250, 0.34);
                    border-radius: 14px;
                    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.46);
                    overflow: hidden;
                    backdrop-filter: blur(14px);
                }
                .panel.collapsed { width: 230px; }
                .panel.collapsed .body { display: none; }
                .header {
                    display: flex;
                    align-items: center;
                    gap: 9px;
                    min-height: 44px;
                    padding: 10px 12px;
                    background: rgba(30, 41, 59, 0.9);
                    border-bottom: 1px solid rgba(148, 163, 184, 0.18);
                }
                .title { flex: 1; font-size: 14px; font-weight: 750; letter-spacing: 0.01em; }
                .dot { width: 9px; height: 9px; border-radius: 999px; background: #64748b; box-shadow: 0 0 0 3px rgba(100, 116, 139, 0.16); }
                .dot.running { background: #34d399; box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.16); }
                .dot.waiting { background: #fbbf24; box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.16); }
                .dot.error { background: #fb7185; box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.16); }
                .dot.paused { background: #94a3b8; }
                .icon-button {
                    width: 28px;
                    height: 28px;
                    color: #cbd5e1;
                    background: transparent;
                    border: 0;
                    border-radius: 7px;
                    cursor: pointer;
                }
                .icon-button:hover { background: rgba(148, 163, 184, 0.14); }
                .body { padding: 12px; }
                .tabs, .subtabs { display: grid; gap: 6px; }
                .tabs { grid-template-columns: 1fr 1fr; margin-bottom: 12px; }
                .subtabs { grid-template-columns: repeat(4, 1fr); margin-bottom: 10px; }
                .tab, .subtab {
                    padding: 7px 10px;
                    color: #94a3b8;
                    background: rgba(30, 41, 59, 0.68);
                    border: 1px solid transparent;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 700;
                }
                .tab.active, .subtab.active {
                    color: #dbeafe;
                    background: rgba(37, 99, 235, 0.22);
                    border-color: rgba(96, 165, 250, 0.35);
                }
                .view, .settings-view { display: none; }
                .view.active, .settings-view.active { display: block; }
                .card {
                    padding: 11px;
                    background: rgba(30, 41, 59, 0.58);
                    border: 1px solid rgba(148, 163, 184, 0.13);
                    border-radius: 10px;
                }
                .eyebrow { margin-bottom: 5px; color: #60a5fa; font-size: 10px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase; }
                .target { color: #f8fafc; font-size: 14px; font-weight: 760; line-height: 1.35; }
                .message { min-height: 34px; margin-top: 6px; color: #aebed3; font-size: 12px; line-height: 1.45; }
                .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 9px; }
                .metric { padding: 8px; background: rgba(15, 23, 42, 0.72); border-radius: 8px; }
                .metric-label { display: block; margin-bottom: 3px; color: #718096; font-size: 10px; }
                .metric-value { color: #e2e8f0; font-size: 12px; font-weight: 700; }
                .primary-toggle {
                    width: 100%;
                    margin-top: 10px;
                    padding: 9px 12px;
                    color: #fff;
                    background: #dc2626;
                    border: 1px solid rgba(248, 113, 113, 0.5);
                    border-radius: 9px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 800;
                    transition: 150ms ease;
                }
                .primary-toggle:hover { background: #ef4444; }
                .primary-toggle[data-enabled="false"] {
                    color: #052e16;
                    background: #34d399;
                    border-color: rgba(110, 231, 183, 0.7);
                }
                .primary-toggle[data-enabled="false"]:hover { background: #6ee7b7; }
                .primary-toggle:disabled { cursor: wait; opacity: 0.65; }
                .history { display: grid; gap: 6px; margin-top: 10px; max-height: 118px; overflow: auto; }
                .history-item { display: grid; grid-template-columns: 52px 1fr; gap: 7px; color: #94a3b8; font-size: 10px; line-height: 1.35; }
                .history-time { color: #64748b; font-variant-numeric: tabular-nums; }
                .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 38px; padding: 7px 0; border-bottom: 1px solid rgba(148, 163, 184, 0.1); }
                .setting-row:last-child { border-bottom: 0; }
                .setting-copy { min-width: 0; }
                .setting-title { color: #e2e8f0; font-size: 12px; font-weight: 700; }
                .setting-help { margin-top: 2px; color: #718096; font-size: 10px; line-height: 1.3; }
                .switch { position: relative; flex: 0 0 auto; width: 36px; height: 20px; }
                .switch input { position: absolute; opacity: 0; pointer-events: none; }
                .switch span { position: absolute; inset: 0; background: #475569; border-radius: 999px; cursor: pointer; transition: 150ms ease; }
                .switch span::after { content: ""; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; background: white; border-radius: 50%; transition: 150ms ease; }
                .switch input:checked + span { background: #2563eb; }
                .switch input:checked + span::after { transform: translateX(16px); }
                .number { width: 88px; padding: 6px 7px; color: #e2e8f0; background: #0f172a; border: 1px solid #334155; border-radius: 7px; font-size: 11px; text-align: right; }
                .select { width: 154px; min-width: 0; padding: 6px 7px; color: #e2e8f0; background: #0f172a; border: 1px solid #334155; border-radius: 7px; font-size: 11px; }
                .footer { margin-top: 9px; color: #52647a; font-size: 9px; text-align: right; }
                @media (max-width: 600px) {
                    .panel { top: 8px; right: 8px; width: calc(100vw - 16px); }
                }
            `;

            const panel = document.createElement('section');
            panel.className = 'panel';
            panel.innerHTML = `
                <header class="header">
                    <span class="dot" data-status-dot></span>
                    <div class="title">Arcane Angler Copilot</div>
                    <button class="icon-button" type="button" data-collapse aria-label="折叠面板">−</button>
                </header>
                <div class="body">
                    <nav class="tabs">
                        <button class="tab active" type="button" data-tab="status">状态</button>
                        <button class="tab" type="button" data-tab="settings">设置</button>
                    </nav>
                    <section class="view active" data-view="status">
                        <div class="card">
                            <div class="eyebrow">当前目标</div>
                            <div class="target" data-target>初始化中</div>
                            <div class="message" data-message>等待状态更新。</div>
                            <div class="metrics">
                                <div class="metric"><span class="metric-label">功能</span><span class="metric-value" data-feature>自动钓鱼</span></div>
                                <div class="metric"><span class="metric-label">已抛竿</span><span class="metric-value" data-cast-count>0</span></div>
                            </div>
                        </div>
                        <button class="primary-toggle" type="button" data-primary-toggle data-enabled="true">暂停自动化</button>
                        <div class="history" data-history></div>
                    </section>
                    <section class="view" data-view="settings">
                        <nav class="subtabs">
                            <button class="subtab active" type="button" data-subtab="general">通用</button>
                            <button class="subtab" type="button" data-subtab="fishing">钓鱼</button>
                            <button class="subtab" type="button" data-subtab="bait">鱼饵</button>
                            <button class="subtab" type="button" data-subtab="verification">验证</button>
                        </nav>
                        <div class="settings-view active card" data-settings-view="general">
                            <div class="setting-row">
                                <div class="setting-copy"><div class="setting-title">运行控制</div><div class="setting-help">开始和暂停按钮位于状态首页</div></div>
                            </div>
                        </div>
                        <div class="settings-view card" data-settings-view="fishing">
                            <div class="setting-row">
                                <div class="setting-copy"><div class="setting-title">自动钓鱼</div><div class="setting-help">启用当前钓鱼功能模块</div></div>
                                <label class="switch"><input type="checkbox" data-setting="fishingEnabled"><span></span></label>
                            </div>
                            <div class="setting-row">
                                <div class="setting-copy"><div class="setting-title">固定按钮模式</div><div class="setting-help">进入设置并确保使用经典按钮</div></div>
                                <label class="switch"><input type="checkbox" data-setting="enforceClassicMode"><span></span></label>
                            </div>
                            <div class="setting-row">
                                <div class="setting-copy"><div class="setting-title">最小点击延迟</div><div class="setting-help">毫秒</div></div>
                                <input class="number" type="number" min="0" max="60000" step="50" data-setting="clickDelayMinMs">
                            </div>
                            <div class="setting-row">
                                <div class="setting-copy"><div class="setting-title">最大点击延迟</div><div class="setting-help">毫秒</div></div>
                                <input class="number" type="number" min="0" max="60000" step="50" data-setting="clickDelayMaxMs">
                            </div>
                        </div>
                        <div class="settings-view card" data-settings-view="bait">
                            <div class="setting-row">
                                <div class="setting-copy"><div class="setting-title">自动管理鱼饵</div><div class="setting-help">仅在选好目标后主动开启，可能消耗游戏金币</div></div>
                                <label class="switch"><input type="checkbox" data-setting="autoBaitEnabled"><span></span></label>
                            </div>
                            <div class="setting-row">
                                <div class="setting-copy"><div class="setting-title">目标鱼饵</div><div class="setting-help">按稳定鱼饵 ID 保存</div></div>
                                <select class="select" data-setting="selectedBaitId"></select>
                            </div>
                            <div class="setting-row">
                                <div class="setting-copy"><div class="setting-title">低于此库存时补货</div><div class="setting-help">0 到 999999</div></div>
                                <input class="number" type="number" min="0" max="999999" step="1" data-setting="restockThreshold">
                            </div>
                            <div class="setting-row">
                                <div class="setting-copy"><div class="setting-title">每次购买数量</div><div class="setting-help">必须是 100 的倍数</div></div>
                                <input class="number" type="number" min="100" max="999900" step="100" data-setting="purchaseQuantity">
                            </div>
                        </div>
                        <div class="settings-view card" data-settings-view="verification">
                            <div class="setting-row">
                                <div class="setting-copy"><div class="setting-title">自动过验证</div><div class="setting-help">使用页面题面和真实鼠标操作；失败后等待人工处理</div></div>
                                <label class="switch"><input type="checkbox" data-setting="autoVerificationEnabled"><span></span></label>
                            </div>
                        </div>
                    </section>
                    <div class="footer" data-updated-at></div>
                </div>
            `;

            shadow.append(style, panel);

            const select = (attribute, value, activeClass) => {
                shadow.querySelectorAll(`[${attribute}]`).forEach(element => {
                    element.classList.toggle(
                        activeClass,
                        element.getAttribute(attribute) === value,
                    );
                });
            };

            shadow.querySelectorAll('[data-tab]').forEach(button => {
                button.addEventListener('click', () => {
                    const value = button.dataset.tab;
                    select('data-tab', value, 'active');
                    select('data-view', value, 'active');
                });
            });

            shadow.querySelectorAll('[data-subtab]').forEach(button => {
                button.addEventListener('click', () => {
                    const value = button.dataset.subtab;
                    select('data-subtab', value, 'active');
                    select('data-settings-view', value, 'active');
                });
            });

            shadow.querySelector('[data-collapse]').addEventListener('click', event => {
                panel.classList.toggle('collapsed');
                event.currentTarget.textContent = panel.classList.contains('collapsed') ? '+' : '−';
            });

            shadow.querySelector('[data-primary-toggle]').addEventListener('click', async event => {
                const button = event.currentTarget;
                const enabled = button.dataset.enabled === 'true';
                button.disabled = true;

                try {
                    await window[bindingName]({
                        key: 'automationEnabled',
                        value: !enabled,
                    });
                } finally {
                    button.disabled = false;
                }
            });

            shadow.querySelectorAll('[data-setting]').forEach(input => {
                input.addEventListener('change', async () => {
                    const value = input.type === 'checkbox'
                        ? input.checked
                        : input.tagName === 'SELECT'
                            ? input.value
                            : Number(input.value);
                    await window[bindingName]({
                        key: input.dataset.setting,
                        value,
                    });
                });
            });

            window.__arcaneCopilotPanelUpdate = snapshot => {
                const { baitOptions, status, settings } = snapshot;
                const setText = (selector, value) => {
                    const element = shadow.querySelector(selector);
                    if (element) element.textContent = String(value ?? '');
                };
                const setChecked = (key, value) => {
                    const input = shadow.querySelector(`[data-setting="${key}"]`);
                    if (input) input.checked = Boolean(value);
                };
                const setNumber = (key, value) => {
                    const input = shadow.querySelector(`[data-setting="${key}"]`);
                    if (input && shadow.activeElement !== input) input.value = String(value);
                };
                const setSelect = (key, options, value) => {
                    const input = shadow.querySelector(`[data-setting="${key}"]`);

                    if (!input || shadow.activeElement === input) return;

                    const normalizedValue = String(value || '');
                    const normalizedOptions = [...options];

                    if (
                        normalizedValue &&
                        !normalizedOptions.some(option =>
                            option.value === normalizedValue)
                    ) {
                        normalizedOptions.push({
                            value: normalizedValue,
                            label: `${normalizedValue}（当前配置）`,
                        });
                    }

                    const placeholder = document.createElement('option');
                    placeholder.value = '';
                    placeholder.textContent = normalizedOptions.length > 0
                        ? '请选择鱼饵'
                        : '等待游戏目录加载';
                    input.replaceChildren(
                        placeholder,
                        ...normalizedOptions.map(option => {
                            const element = document.createElement('option');
                            element.value = option.value;
                            element.textContent = option.label;
                            return element;
                        }),
                    );
                    input.value = normalizedValue;
                };

                const dot = shadow.querySelector('[data-status-dot]');
                dot.className = `dot ${status.level}`;
                setText('[data-target]', status.target);
                setText('[data-message]', status.message);
                setText('[data-feature]', status.activeFeature);
                setText('[data-cast-count]', status.castCount);
                setText('[data-updated-at]', `更新于 ${new Date(status.updatedAt).toLocaleTimeString()}`);

                const primaryToggle = shadow.querySelector('[data-primary-toggle]');
                primaryToggle.dataset.enabled = String(settings.automationEnabled);
                primaryToggle.textContent = settings.automationEnabled
                    ? '暂停自动化'
                    : '开始自动化';

                const history = shadow.querySelector('[data-history]');
                history.replaceChildren(...status.history.map(item => {
                    const row = document.createElement('div');
                    const time = document.createElement('span');
                    const message = document.createElement('span');
                    row.className = 'history-item';
                    time.className = 'history-time';
                    time.textContent = new Date(item.at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                    });
                    message.textContent = item.message;
                    row.append(time, message);
                    return row;
                }));

                setChecked('fishingEnabled', settings.features.fishing.enabled);
                setChecked('autoBaitEnabled', settings.features.bait.enabled);
                setChecked('autoVerificationEnabled', settings.features.verification.enabled);
                setChecked('enforceClassicMode', settings.features.fishing.enforceClassicMode);
                setSelect('selectedBaitId', baitOptions, settings.features.bait.selectedBaitId);
                setNumber('restockThreshold', settings.features.bait.restockThreshold);
                setNumber('purchaseQuantity', settings.features.bait.purchaseQuantity);
                setNumber('clickDelayMinMs', settings.features.fishing.clickDelayMinMs);
                setNumber('clickDelayMaxMs', settings.features.fishing.clickDelayMaxMs);
            };
        }, BINDING_NAME);
    }

    async render() {
        if (this.page.isClosed()) {
            return;
        }

        try {
            await this.ensureMounted();
            const baitOptions = await this.getBaitOptions();
            await this.page.evaluate(snapshot => {
                window.__arcaneCopilotPanelUpdate?.(snapshot);
            }, {
                status: this.reporter.get(),
                settings: this.settings.get(),
                baitOptions,
            });
        } catch {
            // 导航期间执行上下文会短暂销毁，下一次状态更新会重新注入。
        }
    }
}
