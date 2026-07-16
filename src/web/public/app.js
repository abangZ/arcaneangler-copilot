const LOG_LIMIT = 200;
const LOG_HISTORY_FETCH_LIMIT = 2_000;

const elementIds = [
    'auth-loading-view', 'login-view', 'login-form', 'login-username',
    'login-password',
    'login-button', 'login-error', 'app-view', 'main-nav', 'session-user',
    'stream-state', 'transport-warning', 'settings-button', 'logout-button',
    'overview-view', 'stats-view', 'logs-view', 'settings-view',
    'worker-mode', 'status-dot', 'status-message',
    'start-button', 'pause-button', 'resume-button', 'stop-button',
    'today-casts', 'today-gold', 'today-xp', 'today-fish',
    'current-bait-name', 'current-bait-context', 'current-bait-start',
    'current-bait-casts', 'current-bait-fish', 'current-bait-gold',
    'current-bait-fish-gold', 'current-bait-bait-cost',
    'current-bait-net-gold', 'current-bait-xp', 'current-bait-relics',
    'current-bait-chests', 'current-bait-gears',
    'current-bait-net-average', 'current-bait-cost-note',
    'current-bait-rarity-list',
    'player-level', 'player-xp-percent', 'player-xp-bar', 'player-xp-text',
    'level-eta', 'current-biome', 'current-biome-effect',
    'world-boss-status', 'world-boss-title', 'world-boss-time-label',
    'world-boss-time', 'world-boss-hp-row', 'world-boss-hp',
    'world-boss-weakness-row', 'world-boss-weakness',
    'world-boss-standing-row', 'world-boss-standing',
    'world-boss-participants-row', 'world-boss-participants',
    'tournament-status', 'tournament-title', 'tournament-time-label',
    'tournament-time', 'tournament-biome', 'tournament-standing-row',
    'tournament-standing', 'tournament-progress-row',
    'tournament-progress', 'tournament-participants-row',
    'tournament-participants',
    'derby-status', 'derby-title', 'derby-time-label', 'derby-time',
    'derby-biome', 'derby-standing-row', 'derby-standing',
    'derby-participants-row', 'derby-participants',
    'last-fish-empty', 'last-fish-content',
    'last-fish-name', 'last-fish-meta', 'last-fish-reward',
    'last-fish-context', 'last-fish-time',
    'active-feature', 'active-target', 'browser-mode',
    'schedule-mode', 'worker-since', 'status-updated', 'issue-card',
    'issue-text', 'stats-period', 'stats-today-casts', 'stats-today-fish',
    'stats-today-gold', 'stats-today-xp', 'stats-today-relics',
    'stats-today-chests', 'stats-today-gears', 'stats-gold-average',
    'stats-total-casts', 'stats-total-fish', 'stats-total-gold',
    'stats-total-fish-gold', 'stats-total-xp', 'stats-total-bait-cost',
    'stats-total-net-gold',
    'rarity-list', 'daily-stats-body', 'bait-stats-body',
    'biome-stats-body', 'log-count', 'verification-history', 'log-level',
    'log-list', 'settings-title', 'settings-subtitle',
    'settings-back', 'load-error-warning', 'settings-form',
    'settings-revision', 'settings-note', 'save-settings', 'character',
    'headless', 'fishing-enabled', 'world-boss-enabled', 'classic-mode',
    'click-delay-min',
    'click-delay-max', 'map-mode', 'prioritize-tournament',
    'target-biome', 'map-check-minutes',
    'bait-enabled', 'bait-tier', 'bait-threshold', 'bait-quantity',
    'bait-check-seconds', 'active-min', 'active-max', 'rest-min',
    'rest-max', 'quiet-start', 'quiet-end', 'verification-enabled',
    'verification-delay-min', 'verification-delay-max',
    'verification-attempts', 'poll-interval', 'stall-timeout-seconds',
    'navigation-timeout-seconds', 'recovery-error-count', 'toast',
];
const elements = Object.fromEntries(
    elementIds.map(id => [id, document.getElementById(id)]),
);

const state = {
    session: null,
    settings: null,
    controller: null,
    status: null,
    stats: null,
    logs: [],
    verificationHistory: [],
    eventSource: null,
    currentView: null,
    setupMode: false,
    settingsDirty: false,
    savingSettings: false,
    busy: false,
};

const WORKER_LABELS = {
    stopped: '已停止',
    starting: '启动中',
    running: '运行中',
    pausing: '暂停中',
    paused: '已暂停',
    stopping: '停止中',
    error: '运行异常',
};
const BROWSER_LABELS = {
    closed: '已关闭',
    starting: '启动中',
    open: '运行中',
    suspended: '调度关闭',
};
const SCHEDULE_LABELS = {
    idle: '空闲',
    active: '运行',
    competition: '比赛',
    rest: '休息',
    quiet: '夜间停机',
    disabled: '无启用功能',
};
const ACTION_MESSAGES = {
    start: '自动化已启动。',
    pause: '自动化已暂停。',
    resume: '自动化已恢复。',
    stop: '自动化已停止。',
};
const RARITY_DISPLAY = Object.freeze({
    unknown: { label: '未知', tone: 'unknown' },
    common: { label: '普通', tone: 'common' },
    uncommon: { label: '罕见', tone: 'uncommon' },
    fine: { label: '精良', tone: 'fine' },
    rare: { label: '稀有', tone: 'rare' },
    epic: { label: '史诗', tone: 'epic' },
    legendary: { label: '传说', tone: 'legendary' },
    mythic: { label: '神话', tone: 'mythic' },
    exotic: { label: '奇异', tone: 'exotic' },
    arcane: { label: '奥术', tone: 'arcane' },
    relic: { label: '遗物', tone: 'relic' },
    'treasure chest': { label: '宝箱', tone: 'treasure' },
    gears: { label: '装备', tone: 'gear' },
});
const WEATHER_LABELS = Object.freeze({
    clear: '晴朗',
    storm: '暴风雨',
    foggy: '雾天',
    rain: '降雨',
    heatwave: '热浪',
    windy: '大风',
    snow: '降雪',
});
const DERBY_TYPE_LABELS = Object.freeze({
    normal: '普通赛',
    global: '全球赛',
    ironman: '铁人赛',
});
const TOURNAMENT_TYPE_LABELS = DERBY_TYPE_LABELS;
const WORLD_BOSS_STAT_LABELS = Object.freeze({
    strength: '力量',
    intelligence: '智力',
    luck: '幸运',
    stamina: '耐力',
});

function base64UrlToBytes(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
        normalized.length + (4 - normalized.length % 4) % 4,
        '=',
    );

    return Uint8Array.from(
        atob(padded),
        character => character.charCodeAt(0),
    );
}

function bytesToBase64Url(value) {
    let binary = '';

    for (const byte of new Uint8Array(value)) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

async function createLoginProof(password, username, challenge) {
    if (!globalThis.crypto?.subtle) {
        throw new Error(
            '当前浏览器环境不支持安全登录，请使用 HTTPS 或 localhost。',
        );
    }

    const passwordKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits'],
    );
    const derived = await crypto.subtle.deriveBits({
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: base64UrlToBytes(challenge.salt),
        iterations: challenge.iterations,
    }, passwordKey, 256);
    const hmacKey = await crypto.subtle.importKey(
        'raw',
        derived,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const message = [
        challenge.challengeId,
        challenge.nonce,
        username,
    ].join('.');
    const proof = await crypto.subtle.sign(
        'HMAC',
        hmacKey,
        new TextEncoder().encode(message),
    );

    return bytesToBase64Url(proof);
}

async function api(path, options = {}) {
    const method = options.method || 'GET';
    const headers = { ...options.headers };

    if (options.body != null) {
        headers['Content-Type'] = 'application/json';
    }

    if (!['GET', 'HEAD'].includes(method) && state.session?.csrfToken) {
        headers['X-CSRF-Token'] = state.session.csrfToken;
    }

    const response = await fetch(path, {
        ...options,
        method,
        headers,
        body: options.body == null
            ? undefined
            : JSON.stringify(options.body),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        if (response.status === 401 && !path.startsWith('/api/auth/')) {
            showLogin();
        }

        throw new Error(body.error || `请求失败：HTTP ${response.status}`);
    }

    return body;
}

function showToast(message, error = false) {
    elements.toast.textContent = message;
    elements.toast.classList.toggle('error', error);
    elements.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
        elements.toast.hidden = true;
    }, 3_500);
}

function showLogin() {
    state.eventSource?.close();
    state.eventSource = null;
    state.session = null;
    state.currentView = null;
    elements['auth-loading-view'].hidden = true;
    elements['app-view'].hidden = true;
    elements['login-view'].hidden = false;
    elements['login-password'].value = '';
}

function showApp() {
    elements['auth-loading-view'].hidden = true;
    elements['login-view'].hidden = true;
    elements['app-view'].hidden = false;
    elements['session-user'].textContent = state.session.username;
    const localHostnames = ['localhost', '127.0.0.1', '::1'];

    elements['transport-warning'].hidden =
        state.session.secureTransport ||
        localHostnames.includes(location.hostname);
}

function value(id) {
    return elements[id].value;
}

function integer(id) {
    return Number(value(id));
}

function formatNumber(value, maximumFractionDigits = 2) {
    return new Intl.NumberFormat('zh-CN', {
        maximumFractionDigits,
    }).format(Number(value) || 0);
}

function formatDate(value) {
    if (!value) {
        return '—';
    }

    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(new Date(value));
}

function formatFullDate(value) {
    if (!value) {
        return '—';
    }

    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(new Date(value));
}

function formatElapsed(value) {
    if (!value) {
        return '尚未启动';
    }

    const milliseconds = Math.max(0, Date.now() - new Date(value).getTime());
    const minutes = Math.floor(milliseconds / 60_000);

    if (minutes < 1) {
        return '刚刚启动';
    }

    const hours = Math.floor(minutes / 60);
    return hours > 0
        ? `${hours} 小时 ${minutes % 60} 分钟`
        : `${minutes} 分钟`;
}

function rarityDisplay(value) {
    const key = String(value || 'unknown').trim().toLowerCase();

    return RARITY_DISPLAY[key] || {
        label: String(value || '未知'),
        tone: 'unknown',
    };
}

function renderRarityCounts(container, rarityCounts, emptyMessage) {
    const entries = Object.entries(rarityCounts || {})
        .sort(([, left], [, right]) => right - left);
    const fragment = document.createDocumentFragment();

    for (const [rarity, count] of entries) {
        const chip = document.createElement('span');
        const label = document.createElement('span');
        const amount = document.createElement('strong');
        const display = rarityDisplay(rarity);

        chip.className = `rarity-chip ${display.tone}`;
        chip.title = rarity;
        label.textContent = display.label;
        amount.textContent = `×${formatNumber(count, 0)}`;
        chip.append(label, amount);
        fragment.append(chip);
    }

    if (entries.length === 0) {
        const empty = document.createElement('span');

        empty.className = 'muted';
        empty.textContent = emptyMessage;
        fragment.append(empty);
    }

    container.replaceChildren(fragment);
}

function renderSignedTone(element, value) {
    const number = Number(value) || 0;

    element.dataset.tone = number > 0
        ? 'positive'
        : number < 0
            ? 'negative'
            : 'neutral';
}

function formatEstimate(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        return '—';
    }

    const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));

    if (minutes < 60) {
        return `约 ${minutes} 分钟`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours < 24) {
        return remainingMinutes > 0
            ? `约 ${hours} 小时 ${remainingMinutes} 分钟`
            : `约 ${hours} 小时`;
    }

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0
        ? `约 ${days} 天 ${remainingHours} 小时`
        : `约 ${days} 天`;
}

function estimateLevelUp(dashboard, today) {
    const xp = Number(dashboard?.xp);
    const xpToNext = Number(dashboard?.xpToNext);
    const earnedXp = Number(today?.xp);
    const startedAt = Date.parse(today?.startedAt);

    if (
        !Number.isFinite(xp) ||
        !Number.isFinite(xpToNext) ||
        xpToNext <= 0 ||
        !Number.isFinite(earnedXp) ||
        earnedXp <= 0 ||
        !Number.isFinite(startedAt)
    ) {
        return null;
    }

    const remainingXp = Math.max(0, xpToNext - xp);
    const elapsedMs = Math.max(60_000, Date.now() - startedAt);
    const xpPerMs = earnedXp / elapsedMs;

    return xpPerMs > 0 ? remainingXp / xpPerMs : null;
}

function replaceTableRows(body, rows, { colspan, emptyMessage }) {
    const fragment = document.createDocumentFragment();

    for (const values of rows) {
        const row = document.createElement('tr');

        for (const content of values) {
            const cell = document.createElement('td');

            cell.textContent = content;
            row.append(cell);
        }
        fragment.append(row);
    }

    if (rows.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');

        cell.colSpan = colspan;
        cell.className = 'muted';
        cell.textContent = emptyMessage;
        row.append(cell);
        fragment.append(row);
    }

    body.replaceChildren(fragment);
}

function fillSettings(snapshot) {
    const settings = snapshot.settings;

    elements.character.value = settings.general.character || '';
    elements.headless.checked = settings.browser.headless;
    elements['fishing-enabled'].checked = settings.features.fishing.enabled;
    elements['world-boss-enabled'].checked =
        settings.features.worldBoss.enabled;
    elements['classic-mode'].checked = settings.features.fishing.enforceClassicMode;
    elements['click-delay-min'].value = settings.features.fishing.clickDelayMinMs;
    elements['click-delay-max'].value = settings.features.fishing.clickDelayMaxMs;
    elements['map-mode'].value = settings.features.map.mode;
    elements['prioritize-tournament'].checked =
        settings.features.map.prioritizeTournament;
    elements['target-biome'].value = settings.features.map.targetBiomeId || '';
    elements['map-check-minutes'].value = settings.features.map.checkIntervalMs / 60_000;
    elements['bait-enabled'].checked = settings.features.bait.enabled;
    elements['bait-tier'].value = settings.features.bait.selectedBaitTier;
    elements['bait-threshold'].value = settings.features.bait.restockThreshold;
    elements['bait-quantity'].value = settings.features.bait.purchaseQuantity;
    elements['bait-check-seconds'].value = settings.features.bait.checkIntervalMs / 1_000;
    elements['active-min'].value = settings.schedule.activeMinMinutes;
    elements['active-max'].value = settings.schedule.activeMaxMinutes;
    elements['rest-min'].value = settings.schedule.restMinMinutes;
    elements['rest-max'].value = settings.schedule.restMaxMinutes;
    elements['quiet-start'].value = settings.schedule.quietStartHour;
    elements['quiet-end'].value = settings.schedule.quietEndHour;
    elements['verification-enabled'].checked = settings.features.verification.enabled;
    elements['verification-delay-min'].value = settings.features.verification.stepDelayMinMs;
    elements['verification-delay-max'].value = settings.features.verification.stepDelayMaxMs;
    elements['verification-attempts'].value = settings.features.verification.maxAttempts;
    elements['poll-interval'].value = settings.advanced.pollIntervalMs;
    elements['stall-timeout-seconds'].value = settings.advanced.stallTimeoutMs / 1_000;
    elements['navigation-timeout-seconds'].value = settings.advanced.navigationTimeoutMs / 1_000;
    elements['recovery-error-count'].value = settings.advanced.recoveryErrorCount;
    state.settingsDirty = false;
    updateMapTargetState();
    renderSettingsMeta();
}

function collectSettings() {
    const mapMode = value('map-mode');

    return {
        general: {
            character: value('character').trim() || null,
        },
        browser: {
            headless: elements.headless.checked,
        },
        schedule: {
            activeMinMinutes: integer('active-min'),
            activeMaxMinutes: integer('active-max'),
            restMinMinutes: integer('rest-min'),
            restMaxMinutes: integer('rest-max'),
            quietStartHour: integer('quiet-start'),
            quietEndHour: integer('quiet-end'),
        },
        features: {
            fishing: {
                enabled: elements['fishing-enabled'].checked,
                enforceClassicMode: elements['classic-mode'].checked,
                clickDelayMinMs: integer('click-delay-min'),
                clickDelayMaxMs: integer('click-delay-max'),
            },
            map: {
                mode: mapMode,
                prioritizeTournament:
                    elements['prioritize-tournament'].checked,
                targetBiomeId: mapMode === 'fixed'
                    ? integer('target-biome')
                    : null,
                checkIntervalMs: integer('map-check-minutes') * 60_000,
            },
            worldBoss: {
                enabled: elements['world-boss-enabled'].checked,
            },
            bait: {
                enabled: elements['bait-enabled'].checked,
                selectedBaitTier: integer('bait-tier'),
                restockThreshold: integer('bait-threshold'),
                purchaseQuantity: integer('bait-quantity'),
                checkIntervalMs: integer('bait-check-seconds') * 1_000,
            },
            verification: {
                enabled: elements['verification-enabled'].checked,
                stepDelayMinMs: integer('verification-delay-min'),
                stepDelayMaxMs: integer('verification-delay-max'),
                maxAttempts: integer('verification-attempts'),
            },
        },
        advanced: {
            pollIntervalMs: integer('poll-interval'),
            stallTimeoutMs: integer('stall-timeout-seconds') * 1_000,
            navigationTimeoutMs: integer('navigation-timeout-seconds') * 1_000,
            recoveryErrorCount: integer('recovery-error-count'),
        },
    };
}

function updateMapTargetState() {
    const fixed = value('map-mode') === 'fixed';

    elements['target-biome'].disabled = !fixed;
    elements['target-biome'].required = fixed;
}

function renderSettingsMeta() {
    if (!state.settings) {
        return;
    }

    elements['settings-revision'].textContent = state.settings.configured
        ? `版本 ${state.settings.revision}`
        : '首次保存';
    elements['load-error-warning'].hidden = !state.settings.loadError;
    elements['load-error-warning'].textContent = state.settings.loadError
        ? `旧配置读取失败，已显示安全默认值：${state.settings.loadError}`
        : '';
    elements['settings-note'].textContent = state.settingsDirty
        ? '有未保存的修改。'
        : '配置已与服务器同步。';
}

function applySetupMode() {
    state.setupMode = state.settings?.configured !== true;
    elements['main-nav'].hidden = state.setupMode;
    elements['settings-button'].hidden = state.setupMode;
    elements['settings-back'].hidden = state.setupMode;
    elements['settings-title'].textContent = state.setupMode
        ? '首次设置'
        : '自动化设置';
    elements['settings-subtitle'].textContent = state.setupMode
        ? '保存后进入主面板，再启动自动化。'
        : '低频配置集中在这里，保存后返回概览。';
    elements['save-settings'].textContent = state.setupMode
        ? '保存并进入控制台'
        : '保存设置';
}

function setView(view, { force = false } = {}) {
    const nextView = state.setupMode ? 'settings' : view;

    if (
        !force &&
        state.currentView === 'settings' &&
        nextView !== 'settings' &&
        state.settingsDirty &&
        !window.confirm('当前设置尚未保存，确定离开吗？')
    ) {
        return;
    }

    state.currentView = nextView;
    for (const panel of document.querySelectorAll('[data-view-panel]')) {
        panel.hidden = panel.dataset.viewPanel !== nextView;
    }
    for (const button of document.querySelectorAll('.nav-button')) {
        button.classList.toggle('active', button.dataset.view === nextView);
    }

    if (nextView === 'logs') {
        renderLogs();
    } else if (nextView === 'stats') {
        renderStats();
    }
}

function workerTone(controller, status) {
    if (controller.mode === 'error' || status.level === 'error') {
        return 'error';
    }

    if (controller.mode === 'paused') {
        return 'paused';
    }

    if (status.level === 'waiting') {
        return 'waiting';
    }

    return controller.mode === 'running' ? 'running' : 'idle';
}

function renderOverview() {
    const controller = state.controller || {
        mode: 'stopped',
        browser: 'closed',
    };
    const status = state.status || {};
    const stats = state.stats || {};
    const today = stats.today || {};
    const dashboard = status.dashboard || controller.engine?.dashboard || null;
    const scheduleMode = controller.engine?.scheduleMode;
    const tone = workerTone(controller, status);
    const modeLabel = WORKER_LABELS[controller.mode] || controller.mode;

    elements['worker-mode'].textContent = modeLabel;
    elements['worker-mode'].className = `runtime-mode ${tone}`;
    elements['status-dot'].className = `status-dot ${tone}`;
    elements['status-message'].textContent = status.message || '等待操作。';
    elements['active-feature'].textContent = status.activeFeature || '—';
    elements['active-target'].textContent = status.target || '—';
    elements['browser-mode'].textContent =
        BROWSER_LABELS[controller.browser] || controller.browser || '—';
    elements['schedule-mode'].textContent =
        SCHEDULE_LABELS[scheduleMode] || '—';
    elements['worker-since'].textContent = formatElapsed(controller.startedAt);
    elements['status-updated'].textContent = formatDate(status.updatedAt);
    elements['today-casts'].textContent = formatNumber(today.casts, 0);
    elements['today-gold'].textContent = formatNumber(today.gold);
    elements['today-xp'].textContent = formatNumber(today.xp);
    elements['today-fish'].textContent = formatNumber(today.fish, 0);

    const dashboardBaitId = dashboard?.bait?.id != null
        ? String(dashboard.bait.id)
        : null;
    const dashboardBiomeId = dashboard?.biome?.id != null
        ? String(dashboard.biome.id)
        : null;
    const fallbackCurrentBait = stats.currentBait;
    const baitId = dashboardBaitId || fallbackCurrentBait?.baitId;
    const biomeId = dashboardBiomeId || fallbackCurrentBait?.biomeId;
    const matchesFallbackCombination = baitId != null &&
        biomeId != null &&
        fallbackCurrentBait?.baitId === baitId &&
        fallbackCurrentBait?.biomeId === biomeId;
    const currentSummary = (stats.breakdowns || []).find(summary =>
        summary.baitId === baitId && summary.biomeId === biomeId,
    ) || (matchesFallbackCombination
        ? stats.currentCombination?.total
        : null) || {};
    const baitName = dashboard?.bait?.name ||
        currentSummary.baitName ||
        fallbackCurrentBait?.baitName;
    const baitPrice = dashboard?.bait?.price ??
        currentSummary.baitPrice ??
        fallbackCurrentBait?.baitPrice;
    const biomeName = dashboard?.biome?.name ||
        currentSummary.biomeName ||
        fallbackCurrentBait?.biomeName;

    elements['current-bait-name'].textContent = baitName || '暂无鱼饵数据';
    elements['current-bait-context'].textContent = baitId
        ? [
            biomeId && biomeName ? `[B${biomeId}] ${biomeName}` : biomeName,
            baitPrice == null
                ? '鱼饵成本未知'
                : `单价 ${formatNumber(baitPrice)} 金币/竿`,
        ].filter(Boolean).join(' · ')
        : '等待 Worker 读取当前地图和鱼饵。';
    elements['current-bait-start'].textContent = currentSummary.startedAt
        ? `统计起点：${formatFullDate(currentSummary.startedAt)}`
        : '当前范围暂无数据';
    const netAverage = currentSummary.casts > 0
        ? currentSummary.netGold / currentSummary.casts
        : 0;
    const baitValues = {
        'current-bait-casts': [currentSummary.casts, 0],
        'current-bait-fish': [currentSummary.fish, 0],
        'current-bait-gold': [currentSummary.gold, 2],
        'current-bait-fish-gold': [currentSummary.fishGold, 2],
        'current-bait-bait-cost': [currentSummary.baitCost, 2],
        'current-bait-net-gold': [currentSummary.netGold, 2],
        'current-bait-xp': [currentSummary.xp, 2],
        'current-bait-relics': [currentSummary.relics, 0],
        'current-bait-chests': [currentSummary.treasureChests, 0],
        'current-bait-gears': [currentSummary.gears, 0],
        'current-bait-net-average': [netAverage, 1],
    };

    for (const [id, [number, digits]] of Object.entries(baitValues)) {
        elements[id].textContent = formatNumber(number, digits);
    }
    renderSignedTone(elements['current-bait-net-gold'], currentSummary.netGold);
    renderSignedTone(elements['current-bait-net-average'], netAverage);
    const unknownCostCasts = Number(currentSummary.unknownBaitCostCasts) || 0;

    elements['current-bait-cost-note'].hidden = unknownCostCasts === 0;
    elements['current-bait-cost-note'].textContent = unknownCostCasts > 0
        ? `${formatNumber(unknownCostCasts, 0)} 次抛竿未获取到鱼饵价格，成本和净收益暂未包含。`
        : '';
    renderRarityCounts(
        elements['current-bait-rarity-list'],
        currentSummary.rarityCounts,
        '暂无收获',
    );

    const level = Number(dashboard?.level);
    const xp = Number(dashboard?.xp);
    const xpToNext = Number(dashboard?.xpToNext);
    const hasProgress = Number.isFinite(xp) &&
        Number.isFinite(xpToNext) &&
        xpToNext > 0;
    const progress = hasProgress
        ? Math.min(100, Math.max(0, xp / xpToNext * 100))
        : 0;

    elements['player-level'].textContent =
        dashboard?.level != null && Number.isFinite(level)
        ? formatNumber(level, 0)
        : '—';
    elements['player-xp-percent'].textContent = hasProgress
        ? `${Math.floor(progress)}%`
        : '—';
    elements['player-xp-bar'].style.width = `${progress}%`;
    elements['player-xp-text'].textContent = hasProgress
        ? `${formatNumber(xp)} / ${formatNumber(xpToNext)} XP`
        : '等待 Worker 读取角色数据';
    const levelEta = estimateLevelUp(dashboard, today);

    elements['level-eta'].textContent = hasProgress && xp >= xpToNext
        ? '预计升级：即将完成'
        : `预计升级：${formatEstimate(levelEta)}`;
    elements['current-biome'].textContent = dashboard?.biome
        ? `${dashboard.biome.name} · B${dashboard.biome.id}`
        : stats.lastContext?.biomeName || '—';
    const weather = dashboard?.biome?.weather;
    const weatherLabel = weather
        ? WEATHER_LABELS[String(weather).toLowerCase()] || weather
        : null;
    const xpBonusValue = dashboard?.biome?.xpBonus;
    const xpBonus = Number(xpBonusValue);

    elements['current-biome-effect'].textContent = [
        weatherLabel,
        xpBonusValue != null && Number.isFinite(xpBonus)
            ? `经验 ${xpBonus >= 0 ? '+' : ''}${formatNumber(xpBonus)}%`
            : null,
    ].filter(Boolean).join(' · ') || '—';

    const worldBoss = dashboard?.worldBoss;
    const worldBossActive = worldBoss?.status === 'active';

    elements['world-boss-status'].textContent = worldBoss
        ? worldBossActive ? '战斗中' : '等待出现'
        : '暂无';
    elements['world-boss-status'].className = worldBoss
        ? `status-pill ${worldBossActive ? 'running' : 'waiting'}`
        : 'status-pill';
    elements['world-boss-title'].textContent = worldBossActive
        ? worldBoss.name || '世界 Boss'
        : worldBoss
            ? '下一只世界 Boss'
            : '等待下一只世界 Boss';
    elements['world-boss-time-label'].textContent = worldBossActive
        ? '结束时间'
        : '出现时间';
    elements['world-boss-time'].textContent = worldBoss
        ? formatFullDate(worldBossActive ? worldBoss.endAt : worldBoss.startAt)
        : '—';
    const bossCurrentHp = Number(worldBoss?.hp?.current);
    const bossMaxHp = Number(worldBoss?.hp?.max);
    const bossHpPercentage = Number(worldBoss?.hp?.percentage);
    const hasBossCurrentHp = worldBoss?.hp?.current != null &&
        Number.isFinite(bossCurrentHp);
    const hasBossMaxHp = worldBoss?.hp?.max != null &&
        Number.isFinite(bossMaxHp);
    const hasBossHpPercentage = worldBoss?.hp?.percentage != null &&
        Number.isFinite(bossHpPercentage);
    const hasBossHp = worldBossActive && (
        hasBossCurrentHp || hasBossMaxHp || hasBossHpPercentage
    );

    elements['world-boss-hp-row'].hidden = !hasBossHp;
    elements['world-boss-hp'].textContent = hasBossHp
        ? [
            hasBossCurrentHp && hasBossMaxHp
                ? `${formatNumber(bossCurrentHp, 0)} / ${formatNumber(bossMaxHp, 0)}`
                : null,
            hasBossHpPercentage
                ? `${formatNumber(bossHpPercentage, 1)}%`
                : null,
        ].filter(Boolean).join(' · ')
        : '—';
    const bossWeakness = worldBoss?.weakness?.primary;

    elements['world-boss-weakness-row'].hidden =
        !worldBossActive || !bossWeakness;
    elements['world-boss-weakness'].textContent = bossWeakness
        ? WORLD_BOSS_STAT_LABELS[bossWeakness] || bossWeakness
        : '—';
    const bossRank = Number(worldBoss?.standing?.rank);
    const bossDamage = Number(worldBoss?.standing?.damage);
    const bossAttacks = Number(worldBoss?.standing?.attacks);
    const hasBossRank = worldBoss?.standing?.rank != null &&
        Number.isSafeInteger(bossRank) && bossRank > 0;
    const hasBossDamage = worldBoss?.standing?.damage != null &&
        Number.isFinite(bossDamage);
    const hasBossAttacks = worldBoss?.standing?.attacks != null &&
        Number.isFinite(bossAttacks);
    const hasBossStanding = worldBossActive && (
        hasBossRank || hasBossDamage || hasBossAttacks
    );

    elements['world-boss-standing-row'].hidden = !hasBossStanding;
    elements['world-boss-standing'].textContent = hasBossStanding
        ? [
            hasBossRank ? `#${formatNumber(bossRank, 0)}` : null,
            hasBossDamage ? `${formatNumber(bossDamage, 0)} 伤害` : null,
            hasBossAttacks ? `${formatNumber(bossAttacks, 0)} 次攻击` : null,
        ].filter(Boolean).join(' · ')
        : '—';
    const bossParticipants = Number(worldBoss?.participantCount);
    const bossActiveParticipants = Number(
        worldBoss?.activeParticipantCount,
    );
    const hasBossParticipantCount = worldBoss?.participantCount != null &&
        Number.isFinite(bossParticipants);
    const hasBossActiveParticipantCount =
        worldBoss?.activeParticipantCount != null &&
        Number.isFinite(bossActiveParticipants);
    const hasBossParticipants = worldBossActive && (
        hasBossParticipantCount || hasBossActiveParticipantCount
    );

    elements['world-boss-participants-row'].hidden = !hasBossParticipants;
    elements['world-boss-participants'].textContent = hasBossParticipants
        ? [
            hasBossParticipantCount
                ? `${formatNumber(bossParticipants, 0)} 总计`
                : null,
            hasBossActiveParticipantCount
                ? `${formatNumber(bossActiveParticipants, 0)} 活跃`
                : null,
        ].filter(Boolean).join(' · ')
        : '—';

    const tournament = dashboard?.tournament;
    const tournamentActive = tournament?.status === 'active';
    const tournamentType = TOURNAMENT_TYPE_LABELS[tournament?.type] ||
        tournament?.type;
    const tournamentNumber = tournament?.number || tournament?.id;

    elements['tournament-status'].textContent = tournament
        ? tournamentActive ? '进行中' : '等待开始'
        : '暂无';
    elements['tournament-status'].className = tournament
        ? `status-pill ${tournamentActive ? 'running' : 'waiting'}`
        : 'status-pill';
    elements['tournament-title'].textContent = tournament
        ? [
            tournamentNumber ? `锦标赛 #${tournamentNumber}` : '锦标赛',
            tournamentType,
        ].filter(Boolean).join(' · ')
        : '暂无已参与锦标赛';
    elements['tournament-time-label'].textContent = tournamentActive
        ? '结束时间'
        : '开始时间';
    elements['tournament-time'].textContent = tournament
        ? formatFullDate(
            tournamentActive ? tournament.endAt : tournament.startAt,
        )
        : '—';
    elements['tournament-biome'].textContent = tournament?.biome
        ? `${tournament.biome.name} · B${tournament.biome.id}`
        : '—';
    const tournamentRank = Number(tournament?.standing?.rank);
    const tournamentPoints = Number(tournament?.standing?.points);
    const tournamentFishCaught = Number(
        tournament?.standing?.fishCaught,
    );
    const hasTournamentStanding = tournamentActive &&
        Number.isSafeInteger(tournamentRank) && tournamentRank > 0;
    const hasTournamentPoints = tournament?.standing?.points != null &&
        Number.isFinite(tournamentPoints);
    const hasTournamentFish = tournament?.standing?.fishCaught != null &&
        Number.isFinite(tournamentFishCaught);
    const hasTournamentProgress = hasTournamentStanding &&
        (hasTournamentPoints || hasTournamentFish);

    elements['tournament-standing-row'].hidden = !hasTournamentStanding;
    elements['tournament-standing'].textContent = hasTournamentStanding
        ? `#${formatNumber(tournamentRank, 0)}`
        : '—';
    elements['tournament-progress-row'].hidden = !hasTournamentProgress;
    elements['tournament-progress'].textContent = hasTournamentProgress
        ? [
            hasTournamentPoints
                ? `${formatNumber(tournamentPoints)} 分`
                : null,
            hasTournamentFish
                ? `${formatNumber(tournamentFishCaught, 0)} 条鱼`
                : null,
        ].filter(Boolean).join(' · ')
        : '—';
    const tournamentParticipantCount = Number(
        tournament?.participantCount,
    );
    const hasTournamentParticipants =
        tournament?.participantCount != null &&
        Number.isFinite(tournamentParticipantCount);

    elements['tournament-participants-row'].hidden =
        !hasTournamentParticipants;
    elements['tournament-participants'].textContent =
        hasTournamentParticipants
            ? formatNumber(tournamentParticipantCount, 0)
            : '—';

    const derby = dashboard?.derby;
    const derbyActive = derby?.status === 'active';
    const derbyType = DERBY_TYPE_LABELS[derby?.type] || derby?.type;
    const derbyNumber = derby?.number || derby?.id;

    elements['derby-status'].textContent = derby
        ? derbyActive ? '进行中' : '等待开始'
        : '暂无';
    elements['derby-status'].className = derby
        ? `status-pill ${derbyActive ? 'running' : 'waiting'}`
        : 'status-pill';
    elements['derby-title'].textContent = derby
        ? [
            derbyNumber ? `Derby #${derbyNumber}` : 'Derby',
            derbyType,
        ].filter(Boolean).join(' · ')
        : '暂无已参与赛事';
    elements['derby-time-label'].textContent = derbyActive
        ? '结束时间'
        : '开始时间';
    elements['derby-time'].textContent = derby
        ? formatFullDate(derbyActive ? derby.endAt : derby.startAt)
        : '—';
    elements['derby-biome'].textContent = derby?.biome
        ? `${derby.biome.name} · B${derby.biome.id}`
        : '—';
    const rank = Number(derby?.standing?.rank);
    const points = Number(derby?.standing?.points);
    const hasStanding = derbyActive && Number.isSafeInteger(rank) && rank > 0;

    elements['derby-standing-row'].hidden = !hasStanding;
    elements['derby-standing'].textContent = hasStanding
        ? [
            `#${formatNumber(rank, 0)}`,
            derby.standing.points != null && Number.isFinite(points)
                ? `${formatNumber(points)} 分`
                : null,
        ].filter(Boolean).join(' · ')
        : '—';
    const participantCount = Number(derby?.participantCount);
    const hasParticipantCount = derby?.participantCount != null &&
        Number.isFinite(participantCount);

    elements['derby-participants-row'].hidden = !hasParticipantCount;
    elements['derby-participants'].textContent = hasParticipantCount
        ? formatNumber(participantCount, 0)
        : '—';

    const lastFish = stats.lastFish;
    elements['last-fish-empty'].hidden = Boolean(lastFish);
    elements['last-fish-content'].hidden = !lastFish;

    if (lastFish) {
        const display = rarityDisplay(lastFish.rarity);

        elements['last-fish-name'].textContent = lastFish.name;
        elements['last-fish-meta'].textContent =
            `${formatNumber(lastFish.count, 0)} 条 · ${display.label}`;
        elements['last-fish-reward'].textContent =
            `${formatNumber(lastFish.gold)} 金币 · ${formatNumber(lastFish.xp)} XP`;
        elements['last-fish-context'].textContent = [
            lastFish.context?.biomeName,
            lastFish.context?.baitName,
        ].filter(Boolean).join(' · ') || '—';
        elements['last-fish-time'].textContent = formatDate(lastFish.caughtAt);
    }

    const issue = controller.lastError ||
        (status.level === 'error' ? status.message : null) ||
        stats.loadError;
    elements['issue-card'].hidden = !issue;
    elements['issue-text'].textContent = issue || '';

    const mode = controller.mode;
    elements['start-button'].hidden = !['stopped', 'error'].includes(mode);
    elements['pause-button'].hidden = mode !== 'running';
    elements['resume-button'].hidden = mode !== 'paused';
    elements['stop-button'].hidden = !['running', 'paused'].includes(mode);
    elements['start-button'].textContent = mode === 'error'
        ? '重新启动'
        : '启动自动化';

    for (const button of document.querySelectorAll('[data-action]')) {
        button.disabled = state.busy;
    }
}

function renderStats() {
    const snapshot = state.stats || {};
    const today = snapshot.today || {};
    const total = snapshot.total || {};
    const average = today.casts > 0 ? today.gold / today.casts : 0;

    elements['stats-period'].textContent = total.casts > 0
        ? `累计自 ${formatDate(total.startedAt)}，今日按服务器本地时间统计。`
        : '等待第一条成功的抛竿响应。';
    const todayValues = {
        'stats-today-casts': [today.casts, 0],
        'stats-today-fish': [today.fish, 0],
        'stats-today-gold': [today.gold, 2],
        'stats-today-xp': [today.xp, 2],
        'stats-today-relics': [today.relics, 0],
        'stats-today-chests': [today.treasureChests, 0],
        'stats-today-gears': [today.gears, 0],
        'stats-gold-average': [average, 2],
    };

    for (const [id, [number, digits]] of Object.entries(todayValues)) {
        elements[id].textContent = formatNumber(number, digits);
    }
    elements['stats-total-casts'].textContent = formatNumber(total.casts, 0);
    elements['stats-total-fish'].textContent = formatNumber(total.fish, 0);
    elements['stats-total-gold'].textContent = formatNumber(total.gold);
    elements['stats-total-fish-gold'].textContent = formatNumber(total.fishGold);
    elements['stats-total-xp'].textContent = formatNumber(total.xp);
    elements['stats-total-bait-cost'].textContent = formatNumber(total.baitCost);
    elements['stats-total-net-gold'].textContent = formatNumber(total.netGold);
    renderRarityCounts(elements['rarity-list'], today.rarityCounts, '暂无数据');

    const dayRows = (snapshot.recentDays || []).map(day => [
            day.day,
            formatNumber(day.casts, 0),
            formatNumber(day.fish, 0),
            formatNumber(day.gold),
            formatNumber(day.fishGold),
            formatNumber(day.baitCost),
            formatNumber(day.netGold),
            formatNumber(day.xp),
        ]);

    replaceTableRows(elements['daily-stats-body'], dayRows, {
        colspan: 8,
        emptyMessage: '暂无每日收益数据',
    });

    const baitRows = (snapshot.baitSummaries || []).map(summary => [
        summary.baitName || summary.baitId,
        formatNumber(summary.casts, 0),
        formatNumber(summary.fish, 0),
        formatNumber(summary.gold),
        formatNumber(summary.fishGold),
        formatNumber(summary.baitCost),
        formatNumber(summary.netGold),
        formatNumber(summary.xp),
    ]);

    replaceTableRows(elements['bait-stats-body'], baitRows, {
        colspan: 8,
        emptyMessage: '暂无鱼饵收益数据',
    });

    const biomeRows = (snapshot.biomeSummaries || []).map(summary => [
        summary.biomeName || `地图 ${summary.biomeId}`,
        formatNumber(summary.casts, 0),
        formatNumber(summary.fish, 0),
        formatNumber(summary.gold),
        formatNumber(summary.fishGold),
        formatNumber(summary.baitCost),
        formatNumber(summary.netGold),
        formatNumber(summary.xp),
    ]);

    replaceTableRows(elements['biome-stats-body'], biomeRows, {
        colspan: 8,
        emptyMessage: '暂无地图收益数据',
    });
}

function normalizeLogs(logs) {
    return [...logs]
        .sort((left, right) => (right.id || 0) - (left.id || 0))
        .slice(0, LOG_LIMIT);
}

function collectVerificationHistory(logs) {
    const detections = [...logs]
        .filter(entry =>
            entry.phase === 'verification' &&
            /^检测到(?:人机)?验证/.test(String(entry.message || '')),
        )
        .sort((left, right) =>
            Date.parse(left.updatedAt) - Date.parse(right.updatedAt),
        );
    const unique = [];

    for (const entry of detections) {
        const previous = unique.at(-1);
        const elapsed = Date.parse(entry.updatedAt) -
            Date.parse(previous?.updatedAt);
        const isFallbackDuplicate = previous?.target === '自动完成人机验证' &&
            entry.target === '等待人工验证' &&
            elapsed >= 0 &&
            elapsed <= 60_000;

        if (!isFallbackDuplicate) {
            unique.push(entry);
        }
    }

    return unique.slice(-5).reverse();
}

function renderVerificationHistory() {
    const fragment = document.createDocumentFragment();

    for (const entry of state.verificationHistory) {
        const item = document.createElement('li');
        const time = document.createElement('strong');
        const mode = document.createElement('span');

        time.textContent = formatFullDate(entry.updatedAt);
        mode.textContent = entry.target === '等待人工验证'
            ? '等待人工处理'
            : '自动处理';
        item.append(time, mode);
        fragment.append(item);
    }

    if (state.verificationHistory.length === 0) {
        const empty = document.createElement('li');

        empty.className = 'muted';
        empty.textContent = '暂无验证码记录';
        fragment.append(empty);
    }

    elements['verification-history'].replaceChildren(fragment);
}

function addLog(entry) {
    if (state.logs.some(candidate => candidate.id === entry.id)) {
        return;
    }

    state.logs = normalizeLogs([entry, ...state.logs]);
    state.verificationHistory = collectVerificationHistory([
        entry,
        ...state.verificationHistory,
    ]);
    if (state.currentView === 'logs') {
        renderLogs();
    }
}

function renderLogs() {
    const level = value('log-level');
    const filtered = state.logs.filter(entry =>
        level === 'all' || entry.level === level,
    );
    const fragment = document.createDocumentFragment();

    for (const entry of filtered) {
        const item = document.createElement('article');
        const meta = document.createElement('div');
        const levelLabel = document.createElement('span');
        const time = document.createElement('span');
        const feature = document.createElement('span');
        const message = document.createElement('div');

        item.className = `log-entry ${entry.level}`;
        meta.className = 'log-meta';
        levelLabel.className = 'log-level';
        levelLabel.textContent = String(entry.level || 'idle').toUpperCase();
        time.textContent = formatDate(entry.updatedAt);
        feature.textContent = [entry.activeFeature, entry.target]
            .filter(Boolean)
            .join(' · ');
        message.className = 'log-message';
        message.textContent = entry.message || '';
        meta.append(levelLabel, time, feature);
        item.append(meta, message);
        fragment.append(item);
    }

    if (filtered.length === 0) {
        const empty = document.createElement('div');

        empty.className = 'empty-state';
        empty.textContent = '当前筛选条件下没有日志。';
        fragment.append(empty);
    }

    elements['log-list'].replaceChildren(fragment);
    elements['log-count'].textContent = level === 'all'
        ? `最新在前，仅显示最近 ${state.logs.length}/${LOG_LIMIT} 条`
        : `筛选到 ${filtered.length} 条，页面最多保留 ${LOG_LIMIT} 条`;
    renderVerificationHistory();
}

function renderAll() {
    renderOverview();
    renderStats();
    renderLogs();
    renderSettingsMeta();
}

function connectEvents() {
    state.eventSource?.close();
    const latestLogId = state.logs[0]?.id || 0;
    const source = new EventSource(`/api/events?afterId=${latestLogId}`);

    state.eventSource = source;
    source.addEventListener('open', () => {
        elements['stream-state'].textContent = '已连接';
        elements['stream-state'].classList.add('online');
        elements['stream-state'].classList.remove('offline');
    });
    source.addEventListener('error', () => {
        elements['stream-state'].textContent = '重连中';
        elements['stream-state'].classList.remove('online');
        elements['stream-state'].classList.add('offline');
    });
    source.addEventListener('auth', () => {
        showLogin();
        showToast('登录已过期，请重新登录。', true);
    });
    source.addEventListener('status', event => {
        state.status = JSON.parse(event.data);
        renderOverview();
    });
    source.addEventListener('controller', event => {
        state.controller = JSON.parse(event.data);
        renderOverview();
    });
    source.addEventListener('stats', event => {
        state.stats = JSON.parse(event.data);
        renderOverview();
        renderStats();
    });
    source.addEventListener('settings', event => {
        const incoming = JSON.parse(event.data);

        if (state.savingSettings) {
            return;
        }

        if (!state.settingsDirty) {
            state.settings = incoming;
            fillSettings(incoming);

            if (state.setupMode && incoming.configured) {
                applySetupMode();
                setView('overview', { force: true });
            }
        } else if (incoming.revision !== state.settings?.revision) {
            showToast('设置已在其他页面更新，请重新进入设置页。', true);
        }
    });
    source.addEventListener('log', event => addLog(JSON.parse(event.data)));
}

async function loadDashboard() {
    const [current, logs] = await Promise.all([
        api('/api/state'),
        api(`/api/logs?limit=${LOG_HISTORY_FETCH_LIMIT}`),
    ]);

    state.status = current.status;
    state.controller = current.controller;
    state.settings = current.settings;
    state.stats = current.stats;
    state.logs = normalizeLogs(logs.logs);
    state.verificationHistory = collectVerificationHistory(logs.logs);
    fillSettings(state.settings);
    applySetupMode();
    showApp();
    setView(state.setupMode ? 'settings' : 'overview', { force: true });
    renderAll();
    connectEvents();
}

elements['login-form'].addEventListener('submit', async event => {
    event.preventDefault();
    const username = value('login-username').trim();
    const password = value('login-password');

    elements['login-error'].textContent = '';
    elements['login-button'].disabled = true;
    elements['login-button'].textContent = '验证中…';

    try {
        const challenge = await api('/api/auth/challenge', {
            method: 'POST',
            body: { username },
        });
        const proof = await createLoginProof(password, username, challenge);

        state.session = await api('/api/auth/login', {
            method: 'POST',
            body: {
                username,
                challengeId: challenge.challengeId,
                proof,
            },
        });
        elements['login-password'].value = '';
        await loadDashboard();
    } catch (error) {
        elements['login-error'].textContent = error.message;
    } finally {
        elements['login-button'].disabled = false;
        elements['login-button'].textContent = '登录';
    }
});

elements['logout-button'].addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    showLogin();
});

for (const button of document.querySelectorAll('.nav-button')) {
    button.addEventListener('click', () => setView(button.dataset.view));
}
elements['settings-button'].addEventListener('click', () => setView('settings'));
elements['settings-back'].addEventListener('click', () => setView('overview'));
document.querySelector('.topbar .brand-row').addEventListener('click', event => {
    event.preventDefault();
    setView('overview');
});

elements['settings-form'].addEventListener('input', () => {
    state.settingsDirty = true;
    renderSettingsMeta();
});
elements['map-mode'].addEventListener('change', updateMapTargetState);

elements['settings-form'].addEventListener('submit', async event => {
    event.preventDefault();
    if (!elements['settings-form'].reportValidity()) {
        return;
    }

    const wasSetup = state.settings.configured !== true;

    elements['save-settings'].disabled = true;
    elements['save-settings'].textContent = '保存中…';
    state.savingSettings = true;

    try {
        const result = await api('/api/settings', {
            method: 'PUT',
            body: {
                revision: state.settings.revision,
                settings: collectSettings(),
            },
        });

        state.settings = result;
        state.controller = result.controller;
        fillSettings(result);
        applySetupMode();
        setView('overview', { force: true });
        renderAll();
        showToast(wasSetup
            ? '设置已保存，现在可以启动自动化。'
            : '设置已保存并应用。');
    } catch (error) {
        showToast(error.message, true);
    } finally {
        state.savingSettings = false;
        elements['save-settings'].disabled = false;
        elements['save-settings'].textContent = state.setupMode
            ? '保存并进入控制台'
            : '保存设置';
    }
});

for (const button of document.querySelectorAll('[data-action]')) {
    button.addEventListener('click', async () => {
        const action = button.dataset.action;

        state.busy = true;
        renderOverview();
        try {
            const result = await api(`/api/actions/${action}`, {
                method: 'POST',
                body: {},
            });

            state.controller = result.controller;
            renderOverview();
            showToast(ACTION_MESSAGES[action] || '操作已完成。');
        } catch (error) {
            showToast(error.message, true);
        } finally {
            state.busy = false;
            renderOverview();
        }
    });
}

elements['log-level'].addEventListener('change', renderLogs);

async function initialize() {
    try {
        state.session = await api('/api/session');
    } catch {
        showLogin();
        return;
    }

    try {
        await loadDashboard();
    } catch (error) {
        if (!state.session) {
            return;
        }

        showApp();
        showToast(`控制台加载失败：${error.message}`, true);
    }
}

void initialize();
