const elements = Object.fromEntries([
    'login-view', 'dashboard-view', 'login-form', 'login-username',
    'login-password', 'login-button', 'login-error', 'logout-button',
    'session-user', 'stream-state', 'transport-warning',
    'configuration-warning', 'load-error-warning', 'worker-mode',
    'worker-since', 'browser-mode', 'schedule-mode', 'active-feature',
    'active-target', 'cast-count', 'status-updated', 'status-message',
    'settings-form', 'settings-revision', 'settings-note', 'save-settings',
    'character', 'headless', 'fishing-enabled', 'classic-mode',
    'click-delay-min', 'click-delay-max', 'map-mode', 'target-biome',
    'map-check-minutes', 'bait-enabled', 'bait-tier', 'bait-threshold',
    'bait-quantity', 'bait-check-seconds', 'active-min', 'active-max',
    'rest-min', 'rest-max', 'quiet-start', 'quiet-end',
    'verification-enabled', 'verification-delay-min',
    'verification-delay-max', 'verification-attempts', 'poll-interval',
    'stall-timeout-seconds', 'navigation-timeout-seconds',
    'recovery-error-count', 'log-list', 'log-level', 'auto-scroll',
    'clear-logs', 'toast', 'start-button', 'pause-button', 'resume-button',
    'restart-button', 'stop-button',
].map(id => [id, document.getElementById(id)]));

const state = {
    session: null,
    settings: null,
    controller: null,
    status: null,
    logs: [],
    eventSource: null,
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

function base64UrlToBytes(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
        normalized.length + (4 - normalized.length % 4) % 4,
        '=',
    );
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
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
        throw new Error('当前浏览器环境不支持安全登录，请使用 HTTPS 或 localhost 访问。');
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
    elements['dashboard-view'].hidden = true;
    elements['login-view'].hidden = false;
    elements['login-password'].value = '';
}

function showDashboard() {
    elements['login-view'].hidden = true;
    elements['dashboard-view'].hidden = false;
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

function renderSettingsMeta() {
    if (!state.settings) {
        return;
    }

    elements['settings-revision'].textContent = state.settings.configured
        ? `版本 ${state.settings.revision}`
        : '未保存';
    elements['configuration-warning'].hidden = state.settings.configured;
    elements['load-error-warning'].hidden = !state.settings.loadError;
    elements['load-error-warning'].textContent = state.settings.loadError
        ? `旧配置读取失败，已显示安全默认值：${state.settings.loadError}`
        : '';
    elements['settings-note'].textContent = state.settingsDirty
        ? '有未保存的修改。'
        : '配置已与服务器同步。';
}

function updateMapTargetState() {
    const fixed = value('map-mode') === 'fixed';

    elements['target-biome'].disabled = !fixed;
    elements['target-biome'].required = fixed;
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

function renderStatus() {
    const controller = state.controller || { mode: 'stopped', browser: 'closed' };
    const status = state.status || {};
    const scheduleMode = controller.engine?.scheduleMode;

    elements['worker-mode'].textContent = WORKER_LABELS[controller.mode] || controller.mode;
    elements['browser-mode'].textContent = BROWSER_LABELS[controller.browser] || controller.browser;
    elements['worker-since'].textContent = controller.lastError
        ? controller.lastError
        : controller.startedAt
            ? `启动于 ${formatDate(controller.startedAt)}`
            : '等待手动启动';
    elements['schedule-mode'].textContent = `调度：${SCHEDULE_LABELS[scheduleMode] || '—'}`;
    elements['active-feature'].textContent = status.activeFeature || 'Web 控制面';
    elements['active-target'].textContent = status.target || '等待配置';
    elements['cast-count'].textContent = status.castCount || 0;
    elements['status-updated'].textContent = status.updatedAt
        ? `更新于 ${formatDate(status.updatedAt)}`
        : '尚未运行';
    elements['status-message'].textContent = status.message || '等待操作。';

    const mode = controller.mode;
    const configured = state.settings?.configured === true;
    elements['start-button'].disabled = state.busy || !configured || !['stopped', 'error'].includes(mode);
    elements['pause-button'].disabled = state.busy || mode !== 'running';
    elements['resume-button'].disabled = state.busy || mode !== 'paused';
    elements['restart-button'].disabled = state.busy || mode !== 'running';
    elements['stop-button'].disabled = state.busy || mode === 'stopped';
}

function addLog(entry) {
    if (state.logs.some(candidate => candidate.id === entry.id)) {
        return;
    }

    state.logs.push(entry);
    state.logs = state.logs.slice(-1_500);
    renderLogs();
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
        feature.textContent = `${entry.activeFeature || '服务'} · ${entry.target || ''}`;
        message.className = 'log-message';
        message.textContent = entry.message || '';
        meta.append(levelLabel, time, feature);
        item.append(meta, message);
        fragment.append(item);
    }

    elements['log-list'].replaceChildren(fragment);
    if (elements['auto-scroll'].checked) {
        elements['log-list'].scrollTop = elements['log-list'].scrollHeight;
    }
}

function connectEvents() {
    state.eventSource?.close();
    const latestLogId = state.logs.at(-1)?.id || 0;
    const source = new EventSource(`/api/events?afterId=${latestLogId}`);

    state.eventSource = source;
    source.addEventListener('open', () => {
        elements['stream-state'].textContent = 'SSE 已连接';
        elements['stream-state'].classList.add('online');
        elements['stream-state'].classList.remove('offline');
    });
    source.addEventListener('error', () => {
        elements['stream-state'].textContent = 'SSE 重连中';
        elements['stream-state'].classList.remove('online');
        elements['stream-state'].classList.add('offline');
    });
    source.addEventListener('auth', () => {
        showLogin();
        showToast('登录已过期，请重新登录。', true);
    });
    source.addEventListener('status', event => {
        state.status = JSON.parse(event.data);
        renderStatus();
    });
    source.addEventListener('controller', event => {
        state.controller = JSON.parse(event.data);
        renderStatus();
    });
    source.addEventListener('settings', event => {
        const incoming = JSON.parse(event.data);

        if (state.savingSettings) {
            return;
        }

        if (!state.settingsDirty) {
            state.settings = incoming;
            fillSettings(incoming);
        } else if (incoming.revision !== state.settings?.revision) {
            showToast('配置已在其他页面更新，请保存前刷新。', true);
        }
    });
    source.addEventListener('log', event => addLog(JSON.parse(event.data)));
}

async function loadDashboard() {
    const [current, logs] = await Promise.all([
        api('/api/state'),
        api('/api/logs?limit=500'),
    ]);

    state.status = current.status;
    state.controller = current.controller;
    state.settings = current.settings;
    state.logs = logs.logs;
    fillSettings(state.settings);
    renderStatus();
    renderLogs();
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
        showDashboard();
        await loadDashboard();
    } catch (error) {
        elements['login-error'].textContent = error.message;
    } finally {
        elements['login-button'].disabled = false;
        elements['login-button'].textContent = '安全登录';
    }
});

elements['logout-button'].addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    showLogin();
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
        renderStatus();
        showToast('配置已保存并应用。');
    } catch (error) {
        showToast(error.message, true);
    } finally {
        state.savingSettings = false;
        elements['save-settings'].disabled = false;
        elements['save-settings'].textContent = '保存配置';
    }
});

for (const button of document.querySelectorAll('[data-action]')) {
    button.addEventListener('click', async () => {
        const action = button.dataset.action;

        state.busy = true;
        renderStatus();
        try {
            const result = await api(`/api/actions/${action}`, {
                method: 'POST',
                body: {},
            });

            state.controller = result.controller;
            renderStatus();
            showToast(`${button.textContent}操作已完成。`);
        } catch (error) {
            showToast(error.message, true);
        } finally {
            state.busy = false;
            renderStatus();
        }
    });
}

elements['log-level'].addEventListener('change', renderLogs);
elements['clear-logs'].addEventListener('click', () => {
    state.logs = [];
    renderLogs();
});

async function initialize() {
    try {
        state.session = await api('/api/session');
        showDashboard();
        await loadDashboard();
    } catch {
        showLogin();
    }
}

void initialize();
