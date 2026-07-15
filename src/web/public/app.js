const LOG_LIMIT = 200;

const elementIds = [
    'auth-loading-view', 'login-view', 'login-form', 'login-username',
    'login-password',
    'login-button', 'login-error', 'app-view', 'main-nav', 'session-user',
    'stream-state', 'transport-warning', 'settings-button', 'logout-button',
    'overview-view', 'stats-view', 'logs-view', 'settings-view',
    'worker-mode', 'status-dot', 'status-summary', 'status-message',
    'start-button', 'pause-button', 'resume-button', 'stop-button',
    'today-casts', 'today-gold', 'today-xp', 'today-fish',
    'active-feature', 'active-target', 'current-context', 'browser-mode',
    'schedule-mode', 'worker-since', 'status-updated', 'issue-card',
    'issue-text', 'stats-period', 'stats-today-casts', 'stats-today-fish',
    'stats-today-gold', 'stats-today-xp', 'stats-today-relics',
    'stats-today-chests', 'stats-today-gears', 'stats-gold-average',
    'stats-total-casts', 'stats-total-fish', 'stats-total-gold',
    'stats-total-xp', 'rarity-list', 'daily-stats-body', 'log-count',
    'log-level', 'log-list', 'settings-title', 'settings-subtitle',
    'settings-back', 'load-error-warning', 'settings-form',
    'settings-revision', 'settings-note', 'save-settings', 'character',
    'headless', 'fishing-enabled', 'classic-mode', 'click-delay-min',
    'click-delay-max', 'map-mode', 'target-biome', 'map-check-minutes',
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

function fillSettings(snapshot) {
    const settings = snapshot.settings;

    elements.character.value = settings.general.character || '';
    elements.headless.checked = settings.browser.headless;
    elements['fishing-enabled'].checked = settings.features.fishing.enabled;
    elements['classic-mode'].checked = settings.features.fishing.enforceClassicMode;
    elements['click-delay-min'].value = settings.features.fishing.clickDelayMinMs;
    elements['click-delay-max'].value = settings.features.fishing.clickDelayMaxMs;
    elements['map-mode'].value = settings.features.map.mode;
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
                targetBiomeId: mapMode === 'fixed'
                    ? integer('target-biome')
                    : null,
                checkIntervalMs: integer('map-check-minutes') * 60_000,
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
    const scheduleMode = controller.engine?.scheduleMode;
    const tone = workerTone(controller, status);
    const modeLabel = WORKER_LABELS[controller.mode] || controller.mode;

    elements['worker-mode'].textContent = modeLabel;
    elements['worker-mode'].className = `status-pill ${tone}`;
    elements['status-dot'].className = `status-dot ${tone}`;
    elements['status-summary'].textContent = controller.mode === 'running'
        ? `${modeLabel} · ${status.activeFeature || '自动化'}`
        : controller.mode === 'paused'
            ? '自动化已暂停'
            : controller.mode === 'error'
                ? 'Worker 运行异常'
                : modeLabel === '已停止'
                    ? '自动化已停止'
                    : modeLabel;
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

    const context = stats.lastContext;
    elements['current-context'].textContent = context
        ? [
            context.biomeId ? `Biome ${context.biomeId}` : null,
            context.baitId ? `鱼饵 ${context.baitId}` : null,
        ].filter(Boolean).join(' · ')
        : '暂无收益数据';

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
    elements['stats-total-xp'].textContent = formatNumber(total.xp);

    const rarityEntries = Object.entries(today.rarityCounts || {})
        .sort(([, left], [, right]) => right - left);
    const rarityFragment = document.createDocumentFragment();

    for (const [rarity, count] of rarityEntries) {
        const chip = document.createElement('span');
        const label = document.createElement('span');
        const amount = document.createElement('strong');

        chip.className = 'rarity-chip';
        label.textContent = rarity;
        amount.textContent = formatNumber(count, 0);
        chip.append(label, amount);
        rarityFragment.append(chip);
    }

    if (rarityEntries.length === 0) {
        const empty = document.createElement('span');

        empty.className = 'muted';
        empty.textContent = '暂无数据';
        rarityFragment.append(empty);
    }
    elements['rarity-list'].replaceChildren(rarityFragment);

    const dayFragment = document.createDocumentFragment();
    for (const day of (snapshot.recentDays || []).slice(0, 7)) {
        const row = document.createElement('tr');

        for (const content of [
            day.day,
            formatNumber(day.casts, 0),
            formatNumber(day.fish, 0),
            formatNumber(day.gold),
            formatNumber(day.xp),
        ]) {
            const cell = document.createElement('td');

            cell.textContent = content;
            row.append(cell);
        }
        dayFragment.append(row);
    }

    if ((snapshot.recentDays || []).length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');

        cell.colSpan = 5;
        cell.className = 'muted';
        cell.textContent = '暂无收益数据';
        row.append(cell);
        dayFragment.append(row);
    }
    elements['daily-stats-body'].replaceChildren(dayFragment);
}

function normalizeLogs(logs) {
    return [...logs]
        .sort((left, right) => (right.id || 0) - (left.id || 0))
        .slice(0, LOG_LIMIT);
}

function addLog(entry) {
    if (state.logs.some(candidate => candidate.id === entry.id)) {
        return;
    }

    state.logs = normalizeLogs([entry, ...state.logs]);
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
        api(`/api/logs?limit=${LOG_LIMIT}`),
    ]);

    state.status = current.status;
    state.controller = current.controller;
    state.settings = current.settings;
    state.stats = current.stats;
    state.logs = normalizeLogs(logs.logs);
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
        await loadDashboard();
    } catch {
        showLogin();
    }
}

void initialize();
