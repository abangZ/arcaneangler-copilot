const LOG_LIMIT = 200;
const LOG_HISTORY_FETCH_LIMIT = 2_000;

const elementIds = [
    'auth-loading-view', 'login-view', 'login-form', 'login-username',
    'login-password',
    'login-button', 'login-error', 'app-view', 'main-nav', 'session-user',
    'stream-state', 'transport-warning', 'settings-button', 'logout-button',
    'overview-view', 'stats-view', 'gear-view', 'logs-view', 'settings-view',
    'worker-mode', 'status-dot', 'status-message',
    'start-button', 'pause-button', 'resume-button', 'stop-button',
    'today-casts', 'today-gold', 'today-xp', 'today-fish', 'current-gold',
    'current-bait-name', 'current-bait-meta', 'current-bait-biome',
    'current-bait-tier', 'current-bait-luck', 'current-bait-context',
    'current-bait-start',
    'current-bait-casts', 'current-bait-fish', 'current-bait-gold',
    'current-bait-fish-gold', 'current-bait-bait-cost',
    'current-bait-net-gold', 'current-bait-xp', 'current-bait-relics',
    'current-bait-chests', 'current-bait-gears',
    'current-bait-net-average', 'current-bait-cost-note',
    'current-bait-rarity-list',
    'player-level', 'player-xp-percent', 'player-xp-bar', 'player-xp-text',
    'level-eta', 'level-rate', 'current-biome', 'current-biome-effect',
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
    'gear-status', 'gear-refresh', 'gear-error', 'gear-content',
    'gear-equipped-count', 'gear-observed-at', 'gear-total-strength',
    'gear-total-intelligence', 'gear-total-luck', 'gear-total-stamina',
    'gear-equipped-grid', 'gear-backpack-meta', 'gear-selected-count',
    'gear-select-page', 'gear-clear-selection', 'gear-sell-selected',
    'gear-search', 'gear-slot-filter', 'gear-rarity-filter', 'gear-sort',
    'gear-rule-list', 'gear-rule-only', 'gear-rule-match-count',
    'gear-select-rules',
    'gear-backpack-grid', 'gear-page-prev', 'gear-page-label',
    'gear-page-next',
    'settings-back', 'load-error-warning', 'settings-form',
    'settings-revision', 'settings-note', 'save-settings', 'character',
    'headless', 'fishing-enabled', 'world-boss-enabled', 'classic-mode',
    'click-delay-min',
    'click-delay-max', 'short-pause-enabled', 'short-pause-chance',
    'short-pause-min', 'short-pause-max', 'long-pause-enabled',
    'long-pause-chance', 'long-pause-min', 'long-pause-max',
    'map-mode', 'prioritize-tournament',
    'target-biome', 'map-check-minutes',
    'bait-enabled', 'bait-tier', 'bait-guild-tournament-tier',
    'bait-derby-tier', 'bait-threshold', 'bait-quantity',
    'bait-check-seconds', 'active-min', 'active-max', 'rest-min',
    'rest-max', 'quiet-enabled', 'quiet-start', 'quiet-end',
    'quiet-game-auto-fishing-enabled', 'quiet-game-auto-fishing-auto-renew',
    'verification-enabled',
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
    gear: null,
    gearError: null,
    gearLoading: false,
    gearBusy: false,
    selectedGearIds: new Set(),
    gearPage: 1,
    gearRules: null,
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
const BAIT_TIER_DISPLAY = Object.freeze({
    default: { level: 0, label: '基础', tone: 'default' },
    low: { level: 1, label: '初级', tone: 'low' },
    medium: { level: 2, label: '中级', tone: 'medium' },
    high: { level: 3, label: '高级', tone: 'high' },
    super: { level: 4, label: '顶级', tone: 'super' },
});
const WORLD_BOSS_STAT_LABELS = Object.freeze({
    strength: '力量',
    intelligence: '智力',
    luck: '幸运',
    stamina: '耐力',
});
const GEAR_PAGE_SIZE = 48;
const GEAR_SALE_LIMIT = 500;
const GEAR_SLOTS = Object.freeze([
    'head',
    'torso',
    'legs',
    'boots',
    'gloves',
    'ring_1',
    'ring_2',
    'amulet',
    'charm',
]);
const GEAR_SLOT_DISPLAY = Object.freeze({
    head: { label: '头部', icon: '⛑️' },
    torso: { label: '躯干', icon: '🛡️' },
    legs: { label: '腿部', icon: '👖' },
    boots: { label: '靴子', icon: '👢' },
    gloves: { label: '手套', icon: '🧤' },
    ring: { label: '戒指', icon: '💍' },
    ring_1: { label: '戒指 1', icon: '💍' },
    ring_2: { label: '戒指 2', icon: '💍' },
    amulet: { label: '护符', icon: '📿' },
    charm: { label: '饰品', icon: '🔮' },
    unknown: { label: '未知槽位', icon: '◇' },
});
const GEAR_RARITY_RANK = Object.freeze({
    Common: 1,
    Uncommon: 2,
    Fine: 3,
    Rare: 4,
    Epic: 5,
    Legendary: 6,
    Mythic: 7,
    Exotic: 8,
    Arcane: 9,
});
const GEAR_RARITIES = Object.freeze(Object.keys(GEAR_RARITY_RANK));
const GEAR_RULE_STORAGE_KEY = 'arcane-copilot:gear-rules:v1';
const GEAR_STAT_DISPLAY = Object.freeze([
    ['strength', '力量'],
    ['intelligence', '智力'],
    ['luck', '运气'],
    ['stamina', '耐力'],
]);

function normalizeGearQualityThreshold(value) {
    const number = Math.floor(Number(value));

    return Number.isFinite(number)
        ? Math.min(100, Math.max(0, number))
        : 100;
}

function defaultGearRules() {
    return Object.fromEntries(GEAR_RARITIES.map(rarity => [
        rarity,
        { enabled: false, maxQuality: 100 },
    ]));
}

function loadGearRules() {
    const rules = defaultGearRules();

    try {
        const saved = JSON.parse(localStorage.getItem(GEAR_RULE_STORAGE_KEY));

        for (const rarity of GEAR_RARITIES) {
            if (saved?.[rarity]) {
                rules[rarity] = {
                    enabled: saved[rarity].enabled === true,
                    maxQuality: normalizeGearQualityThreshold(
                        saved[rarity].maxQuality,
                    ),
                };
            }
        }
    } catch {
        // Ignore unavailable storage and malformed older values.
    }

    return rules;
}

function saveGearRules() {
    try {
        localStorage.setItem(
            GEAR_RULE_STORAGE_KEY,
            JSON.stringify(state.gearRules),
        );
    } catch {
        // The current in-memory rules still work when storage is unavailable.
    }
}

state.gearRules = loadGearRules();

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
    state.gear = null;
    state.gearError = null;
    state.selectedGearIds.clear();
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

function gearSlotDisplay(slot) {
    return GEAR_SLOT_DISPLAY[slot] || {
        label: String(slot || '未知槽位'),
        icon: '◇',
    };
}

function createGearText(tag, className, text) {
    const element = document.createElement(tag);

    element.className = className;
    element.textContent = text;
    return element;
}

function formatGearStat(value) {
    const number = Number(value) || 0;

    return `${number > 0 ? '+' : ''}${formatNumber(number, 0)}`;
}

function gearQualityTone(value) {
    const quality = Number(value) || 0;

    if (quality >= 76) {
        return 'excellent';
    }
    if (quality >= 51) {
        return 'good';
    }
    if (quality >= 26) {
        return 'fair';
    }
    return 'low';
}

function createGearSlot(displayedSlot) {
    return createGearText(
        'span',
        'gear-slot-badge',
        `${displayedSlot.icon} ${displayedSlot.label}`,
    );
}

function createGearStats(gear) {
    const stats = document.createElement('dl');

    stats.className = 'gear-card-stats';
    for (const [key, label] of GEAR_STAT_DISPLAY) {
        const entry = document.createElement('div');
        const value = Number(gear.stats[key]) || 0;

        entry.dataset.stat = key;
        if (value !== 0) {
            entry.append(
                createGearText('dt', '', label),
                createGearText('dd', '', formatGearStat(value)),
            );
        } else {
            entry.className = 'gear-stat-empty';
            entry.setAttribute('aria-hidden', 'true');
        }
        stats.append(entry);
    }

    return stats;
}

function createComparisonChange(label, delta, title, key) {
    const change = document.createElement('span');

    change.className = `gear-comparison-change ${delta > 0 ? 'positive' : 'negative'}`;
    change.dataset.comparison = key;
    change.title = title;
    change.append(
        createGearText('b', '', label),
        document.createTextNode(` ${formatGearStat(delta)}`),
    );
    return change;
}

function createGearComparison(gear, { slot, gear: equippedGear }) {
    const comparison = document.createElement('section');
    const displayedSlot = gearSlotDisplay(slot);
    const changes = document.createElement('div');
    let statChangeCount = 0;

    comparison.className = 'gear-comparison';
    comparison.dataset.comparisonSlot = slot;
    comparison.append(createGearText(
        'strong',
        'gear-comparison-title',
        equippedGear
            ? `对比已穿戴 ${displayedSlot.label}`
            : `${displayedSlot.label}未穿戴`,
    ));
    changes.className = 'gear-comparison-changes';

    for (const [key, label] of GEAR_STAT_DISPLAY) {
        const currentValue = Number(gear.stats[key]) || 0;
        const equippedValue = Number(equippedGear?.stats[key]) || 0;
        const delta = currentValue - equippedValue;

        if (delta === 0) {
            const empty = document.createElement('span');

            empty.className = 'gear-comparison-empty';
            empty.dataset.comparison = key;
            empty.setAttribute('aria-hidden', 'true');
            changes.append(empty);
            continue;
        }

        statChangeCount += 1;
        changes.append(createComparisonChange(
            label,
            delta,
            `已穿戴 ${formatNumber(equippedValue, 0)} → 当前 ${formatNumber(currentValue, 0)}`,
            key,
        ));
    }

    if (statChangeCount === 0) {
        const same = createGearText(
            'span',
            'gear-comparison-same',
            '属性无变化',
        );

        changes.replaceChildren(same);
    }

    comparison.append(changes);
    return comparison;
}

function createGearCard(
    gear,
    { equippedSlot = null, comparisonTargets = [] } = {},
) {
    const card = document.createElement('article');
    const header = document.createElement('div');
    const title = document.createElement('div');
    const titleLine = document.createElement('div');
    const subline = document.createElement('div');
    const rarity = rarityDisplay(gear.rarity);
    const displayedSlot = gearSlotDisplay(equippedSlot || gear.slot);

    card.className = [
        'gear-card',
        `rarity-${rarity.tone}`,
        equippedSlot ? 'equipped' : '',
        gear.isLocked ? 'locked' : '',
        state.selectedGearIds.has(gear.id) ? 'selected' : '',
    ].filter(Boolean).join(' ');
    card.dataset.gearId = gear.id;
    header.className = 'gear-card-header';
    title.className = 'gear-card-title';
    titleLine.className = 'gear-card-title-line';
    subline.className = 'gear-card-subline';

    if (!equippedSlot) {
        const selection = document.createElement('input');

        selection.type = 'checkbox';
        selection.className = 'gear-checkbox';
        selection.dataset.gearSelect = gear.id;
        selection.checked = state.selectedGearIds.has(gear.id);
        selection.disabled = gear.isLocked || state.gearBusy ||
            (
                !selection.checked &&
                state.selectedGearIds.size >= GEAR_SALE_LIMIT
            );
        selection.setAttribute('aria-label', `选择分解 ${gear.name}`);
        header.append(selection);
    }

    titleLine.append(
        createGearText(
            'strong',
            `gear-name ${rarity.tone}`,
            gear.name,
        ),
        createGearText(
            'strong',
            `gear-quality ${gearQualityTone(gear.quality)}`,
            `${formatNumber(gear.quality, 0)}%`,
        ),
    );
    if (gear.upgradeLevel > 0) {
        titleLine.append(createGearText(
            'span',
            'gear-upgrade',
            `+${formatNumber(gear.upgradeLevel, 0)}`,
        ));
    }
    subline.append(createGearText(
        'span',
        `gear-rarity ${rarity.tone}`,
        rarity.label,
    ));
    if (!equippedSlot) {
        subline.append(createGearText(
            'span',
            'gear-sell-value',
            gear.sellValue > 0
                ? `${formatNumber(gear.sellValue, 0)} 金币`
                : '价值未知',
        ));
    }
    title.append(titleLine, subline);
    header.append(
        title,
        createGearSlot(displayedSlot),
    );
    const stats = createGearStats(gear);

    let footer = null;

    if (!equippedSlot) {
        footer = document.createElement('div');
        footer.className = 'gear-card-footer';
    }

    if (footer && gear.isLocked) {
        footer.append(createGearText('span', 'gear-locked-mark', '已锁定'));
    } else if (footer) {
        const actions = document.createElement('div');

        actions.className = 'gear-equip-actions';
        const targets = ['ring', 'ring_1', 'ring_2'].includes(gear.slot)
            ? [
                ['ring_1', '戴到戒指 1'],
                ['ring_2', '戴到戒指 2'],
            ]
            : [[null, '穿戴']];

        for (const [targetSlot, label] of targets) {
            const button = createGearText('button', 'button small', label);

            button.type = 'button';
            button.dataset.equipGear = gear.id;
            if (targetSlot) {
                button.dataset.targetSlot = targetSlot;
            }
            button.disabled = state.gearBusy;
            actions.append(button);
        }
        footer.append(actions);
    }

    card.append(header, stats);
    if (comparisonTargets.length > 0) {
        const comparisons = document.createElement('div');

        comparisons.className = 'gear-comparisons';
        for (const target of comparisonTargets) {
            comparisons.append(createGearComparison(gear, target));
        }
        card.append(comparisons);
    }
    if (footer) {
        card.append(footer);
    }
    return card;
}

function equippedGearSlots(gears) {
    const equipped = gears.filter(gear => gear.isEquipped);
    const used = new Set();
    const slots = new Map();

    for (const slot of GEAR_SLOTS) {
        let gear = equipped.find(candidate =>
            !used.has(candidate.id) && candidate.slot === slot,
        );

        if (!gear && ['ring_1', 'ring_2'].includes(slot)) {
            gear = equipped.find(candidate =>
                !used.has(candidate.id) &&
                ['ring', 'ring_1', 'ring_2'].includes(candidate.slot),
            );
        }

        if (gear) {
            used.add(gear.id);
            slots.set(slot, gear);
        }
    }

    return slots;
}

function gearComparisonTargets(gear, slots) {
    if (['ring', 'ring_1', 'ring_2'].includes(gear.slot)) {
        return ['ring_1', 'ring_2'].map(slot => ({
            slot,
            gear: slots.get(slot) || null,
        }));
    }

    return GEAR_SLOTS.includes(gear.slot)
        ? [{ slot: gear.slot, gear: slots.get(gear.slot) || null }]
        : [];
}

function renderEquippedGears(gears) {
    const slots = equippedGearSlots(gears);
    const fragment = document.createDocumentFragment();

    for (const slot of GEAR_SLOTS) {
        const gear = slots.get(slot);

        if (gear) {
            fragment.append(createGearCard(gear, { equippedSlot: slot }));
            continue;
        }

        const empty = document.createElement('article');
        const display = gearSlotDisplay(slot);

        empty.className = 'gear-card empty-slot';
        empty.append(
            createGearText('span', 'gear-empty-icon', display.icon),
            createGearText('strong', '', display.label),
            createGearText('span', 'muted', '未穿戴'),
        );
        fragment.append(empty);
    }

    elements['gear-equipped-grid'].replaceChildren(fragment);
}

function gearMatchesRule(gear) {
    const rule = state.gearRules[gear.rarity];

    return Boolean(
        !gear.isEquipped &&
        !gear.isLocked &&
        rule?.enabled &&
        gear.quality <= rule.maxQuality
    );
}

function gearRuleMatches() {
    return (state.gear?.gears || []).filter(gearMatchesRule);
}

function ensureGearRuleControls() {
    if (elements['gear-rule-list'].childElementCount > 0) {
        return;
    }

    const fragment = document.createDocumentFragment();

    for (const rarity of GEAR_RARITIES) {
        const display = rarityDisplay(rarity);
        const row = document.createElement('label');
        const enabled = document.createElement('input');
        const threshold = document.createElement('input');

        row.className = `gear-rule rarity-${display.tone}`;
        row.dataset.gearRule = rarity;
        enabled.type = 'checkbox';
        enabled.className = 'gear-rule-enabled';
        enabled.dataset.gearRuleEnabled = rarity;
        enabled.setAttribute('aria-label', `启用${display.label}装备规则`);
        threshold.type = 'number';
        threshold.className = 'gear-rule-threshold';
        threshold.dataset.gearRuleThreshold = rarity;
        threshold.min = '0';
        threshold.max = '100';
        threshold.step = '1';
        threshold.inputMode = 'numeric';
        threshold.setAttribute(
            'aria-label',
            `${display.label}装备品质上限`,
        );
        row.append(
            enabled,
            createGearText(
                'strong',
                `gear-rule-rarity ${display.tone}`,
                display.label,
            ),
            createGearText('span', 'gear-rule-quality-label', '品质 ≤'),
            threshold,
            createGearText('span', 'gear-rule-percent', '%'),
        );
        fragment.append(row);
    }

    elements['gear-rule-list'].append(fragment);
}

function renderGearRules() {
    ensureGearRuleControls();

    for (const rarity of GEAR_RARITIES) {
        const rule = state.gearRules[rarity];
        const enabled = elements['gear-rule-list'].querySelector(
            `[data-gear-rule-enabled="${rarity}"]`,
        );
        const threshold = elements['gear-rule-list'].querySelector(
            `[data-gear-rule-threshold="${rarity}"]`,
        );

        enabled.checked = rule.enabled;
        enabled.disabled = state.gearBusy;
        threshold.value = String(rule.maxQuality);
        threshold.disabled = state.gearBusy || !rule.enabled;
    }

    const enabledCount = GEAR_RARITIES.filter(rarity =>
        state.gearRules[rarity].enabled,
    ).length;
    const matches = gearRuleMatches();

    elements['gear-rule-match-count'].textContent = enabledCount > 0
        ? `命中 ${formatNumber(matches.length, 0)} 件可分解装备`
        : '尚未启用规则';
    elements['gear-select-rules'].disabled =
        state.gearBusy || enabledCount === 0 || matches.length === 0;
    elements['gear-rule-only'].disabled = state.gearBusy;
}

function filteredBackpackGears() {
    const search = value('gear-search').trim().toLowerCase();
    const slot = value('gear-slot-filter');
    const rarity = value('gear-rarity-filter');
    const sort = value('gear-sort');
    const gears = (state.gear?.gears || []).filter(gear => {
        if (gear.isEquipped) {
            return false;
        }

        if (elements['gear-rule-only'].checked && !gearMatchesRule(gear)) {
            return false;
        }

        if (search && !gear.name.toLowerCase().includes(search)) {
            return false;
        }

        if (slot !== 'all') {
            const slotMatches = slot === 'ring'
                ? ['ring', 'ring_1', 'ring_2'].includes(gear.slot)
                : gear.slot === slot;

            if (!slotMatches) {
                return false;
            }
        }

        return rarity === 'all' || gear.rarity === rarity;
    });

    return gears.sort((left, right) => {
        if (sort === 'quality') {
            return right.quality - left.quality ||
                right.totalStats - left.totalStats;
        }

        if (sort === 'stats') {
            return right.totalStats - left.totalStats ||
                right.quality - left.quality;
        }

        if (sort === 'sell') {
            return right.sellValue - left.sellValue ||
                right.totalStats - left.totalStats;
        }

        if (sort === 'name') {
            return left.name.localeCompare(right.name);
        }

        return (GEAR_RARITY_RANK[right.rarity] || 0) -
            (GEAR_RARITY_RANK[left.rarity] || 0) ||
            right.quality - left.quality ||
            right.totalStats - left.totalStats;
    });
}

function currentGearPage() {
    const filtered = filteredBackpackGears();
    const pageCount = Math.max(1, Math.ceil(filtered.length / GEAR_PAGE_SIZE));

    state.gearPage = Math.min(Math.max(1, state.gearPage), pageCount);
    const start = (state.gearPage - 1) * GEAR_PAGE_SIZE;

    return {
        filtered,
        pageCount,
        gears: filtered.slice(start, start + GEAR_PAGE_SIZE),
    };
}

function renderBackpackGears() {
    const allBackpack = (state.gear?.gears || [])
        .filter(gear => !gear.isEquipped);
    const { filtered, pageCount, gears } = currentGearPage();
    const equippedSlots = equippedGearSlots(state.gear?.gears || []);
    const fragment = document.createDocumentFragment();

    for (const gear of gears) {
        fragment.append(createGearCard(gear, {
            comparisonTargets: gearComparisonTargets(gear, equippedSlots),
        }));
    }

    if (gears.length === 0) {
        fragment.append(createGearText(
            'div',
            'empty-state gear-empty-state',
            allBackpack.length === 0
                ? '背包中暂无装备。'
                : '当前筛选条件下没有装备。',
        ));
    }

    elements['gear-backpack-grid'].replaceChildren(fragment);
    elements['gear-backpack-meta'].textContent =
        `${formatNumber(allBackpack.length, 0)} 件装备 · 筛选 ${formatNumber(filtered.length, 0)} 件`;
    elements['gear-selected-count'].textContent =
        `已选择 ${formatNumber(state.selectedGearIds.size, 0)} 件`;
    elements['gear-sell-selected'].disabled =
        state.selectedGearIds.size === 0 || state.gearBusy;
    elements['gear-select-page'].disabled =
        state.gearBusy ||
        state.selectedGearIds.size >= GEAR_SALE_LIMIT ||
        !filtered.some(gear => !gear.isLocked);
    elements['gear-clear-selection'].disabled =
        state.gearBusy || state.selectedGearIds.size === 0;
    elements['gear-page-label'].textContent =
        `第 ${state.gearPage} / ${pageCount} 页`;
    elements['gear-page-prev'].disabled =
        state.gearBusy || state.gearPage <= 1;
    elements['gear-page-next'].disabled =
        state.gearBusy || state.gearPage >= pageCount;
    renderGearRules();
}

function renderGear() {
    const snapshot = state.gear;
    const controller = state.controller || {};

    elements['gear-refresh'].disabled = state.gearLoading || state.gearBusy;
    elements['gear-refresh'].textContent = state.gearLoading
        ? '刷新中…'
        : '刷新装备';
    elements['gear-error'].hidden = !state.gearError;
    elements['gear-error'].textContent = state.gearError || '';
    elements['gear-content'].hidden = !snapshot;

    if (state.gearLoading) {
        elements['gear-status'].textContent = '正在从游戏接口读取装备…';
    } else if (snapshot) {
        elements['gear-status'].textContent =
            `共 ${formatNumber(snapshot.gears.length, 0)} 件装备，可在自动钓鱼运行时直接管理。`;
    } else if (controller.mode !== 'running') {
        elements['gear-status'].textContent =
            '请先启动自动化；装备管理需要使用已登录的 Playwright 会话。';
    } else if (controller.browser !== 'open') {
        elements['gear-status'].textContent =
            'Playwright 浏览器当前已关闭，等待调度恢复后可继续管理。';
    } else {
        elements['gear-status'].textContent = '点击刷新读取当前装备。';
    }

    if (!snapshot) {
        return;
    }

    elements['gear-equipped-count'].textContent =
        formatNumber(snapshot.equippedCount, 0);
    elements['gear-observed-at'].textContent =
        `更新于 ${formatDate(snapshot.observedAt)}`;
    for (const stat of ['strength', 'intelligence', 'luck', 'stamina']) {
        const statElement = elements[`gear-total-${stat}`];
        const statValue = Number(snapshot.equippedStats[stat]) || 0;

        statElement.textContent = formatGearStat(statValue);
        statElement.closest('div').hidden = statValue === 0;
    }
    renderEquippedGears(snapshot.gears);
    renderBackpackGears();
}

async function loadGearInventory() {
    if (state.gearLoading || state.gearBusy) {
        return;
    }

    state.gearLoading = true;
    state.gearError = null;
    renderGear();

    try {
        const snapshot = await api('/api/gears');
        const selectableIds = new Set(snapshot.gears
            .filter(gear => !gear.isEquipped && !gear.isLocked)
            .map(gear => gear.id));

        state.gear = snapshot;
        state.selectedGearIds = new Set(
            [...state.selectedGearIds].filter(id => selectableIds.has(id)),
        );
    } catch (error) {
        state.gearError = error.message;
    } finally {
        state.gearLoading = false;
        renderGear();
    }
}

function applyGearSnapshot(snapshot) {
    const selectableIds = new Set(snapshot.gears
        .filter(gear => !gear.isEquipped && !gear.isLocked)
        .map(gear => gear.id));

    state.gear = snapshot;
    state.selectedGearIds = new Set(
        [...state.selectedGearIds].filter(id => selectableIds.has(id)),
    );
}

async function equipGear(gearId, targetSlot = null) {
    if (state.gearBusy) {
        return;
    }

    state.gearBusy = true;
    state.gearError = null;
    renderGear();

    try {
        const snapshot = await api('/api/gears/equip', {
            method: 'POST',
            body: { gearId, targetSlot },
        });

        applyGearSnapshot(snapshot);
        showToast(snapshot.action?.changed === false
            ? '这件装备已经处于穿戴状态。'
            : '装备已穿戴。');
    } catch (error) {
        state.gearError = error.message;
        showToast(error.message, true);
    } finally {
        state.gearBusy = false;
        renderGear();
    }
}

async function sellSelectedGears() {
    if (state.gearBusy || state.selectedGearIds.size === 0) {
        return;
    }

    const selected = (state.gear?.gears || []).filter(gear =>
        state.selectedGearIds.has(gear.id) &&
        !gear.isEquipped &&
        !gear.isLocked,
    );

    if (selected.length === 0) {
        state.selectedGearIds.clear();
        renderGear();
        showToast('当前选择中没有可分解的装备。', true);
        return;
    }

    const estimatedGold = selected.reduce(
        (total, gear) => total + gear.sellValue,
        0,
    );
    const containsHighRarity = selected.some(gear =>
        ['Exotic', 'Arcane'].includes(gear.rarity),
    );
    const message = [
        containsHighRarity ? '所选装备包含奇异或奥术装备。' : null,
        `确认分解 ${selected.length} 件装备？`,
        estimatedGold > 0
            ? `预计获得 ${formatNumber(estimatedGold, 0)} 金币。`
            : null,
        '分解后无法撤销。',
    ].filter(Boolean).join('\n');

    if (!window.confirm(message)) {
        return;
    }

    state.gearBusy = true;
    state.gearError = null;
    renderGear();

    try {
        const snapshot = await api('/api/gears/sell', {
            method: 'POST',
            body: { gearIds: selected.map(gear => gear.id) },
        });

        state.selectedGearIds.clear();
        applyGearSnapshot(snapshot);
        showToast(
            `已分解 ${formatNumber(snapshot.sale?.gearsSold, 0)} 件装备，获得 ${formatNumber(snapshot.sale?.goldEarned, 0)} 金币。`,
        );
    } catch (error) {
        state.gearError = error.message;
        showToast(error.message, true);
    } finally {
        state.gearBusy = false;
        renderGear();
    }
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

function estimateLevelUp(dashboard, experienceRate) {
    const xp = Number(dashboard?.xp);
    const xpToNext = Number(dashboard?.xpToNext);
    const xpPerHour = Number(experienceRate?.xpPerHour);

    if (
        !Number.isFinite(xp) ||
        !Number.isFinite(xpToNext) ||
        xpToNext <= 0 ||
        !Number.isFinite(xpPerHour) ||
        xpPerHour <= 0
    ) {
        return null;
    }

    const remainingXp = Math.max(0, xpToNext - xp);

    return {
        remainingXp,
        remainingMs: remainingXp / xpPerHour * 3_600_000,
        xpPerHour,
        levelsPerHour: xpPerHour / xpToNext,
    };
}

function replaceTableRows(body, rows, { colspan, emptyMessage }) {
    const fragment = document.createDocumentFragment();

    for (const values of rows) {
        const row = document.createElement('tr');

        for (const value of values) {
            const cell = document.createElement('td');
            const content = value && typeof value === 'object'
                ? value.text
                : value;

            if (
                value &&
                typeof value === 'object' &&
                value.detail
            ) {
                const label = document.createElement('span');
                const detail = document.createElement('span');

                cell.className = 'table-label';
                label.textContent = content;
                detail.className = 'table-label-detail';
                detail.textContent = value.detail;
                cell.append(label, detail);
            } else {
                cell.textContent = content;
            }
            if (value && typeof value === 'object' && value.tone) {
                cell.dataset.tone = value.tone;
            }
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

function tableNumber(value, tone, maximumFractionDigits = 2) {
    return {
        text: formatNumber(value, maximumFractionDigits),
        tone: typeof tone === 'function' ? tone(Number(value) || 0) : tone,
    };
}

function baitSummaryLabel(summary) {
    const detail = [];
    const baitBiome = summary.baitBiome;
    const baitTier = BAIT_TIER_DISPLAY[String(summary.baitTier || '')];
    const baitLuck = Number(summary.baitLuck);

    if (baitBiome?.name) {
        detail.push(
            baitBiome.id === 'global'
                ? baitBiome.name
                : `B${baitBiome.id} · ${baitBiome.name}`,
        );
    }
    if (baitTier) {
        detail.push(`等级 ${baitTier.level} · ${baitTier.label}`);
    }
    if (summary.baitLuck != null && Number.isFinite(baitLuck)) {
        detail.push(`幸运 +${formatNumber(baitLuck, 0)}`);
    }

    return {
        text: summary.baitName || summary.baitId,
        detail: detail.join(' · '),
    };
}

function biomeSummaryLabel(summary) {
    return {
        text: summary.biomeName || `地图 ${summary.biomeId}`,
        detail: summary.biomeId ? `层级 B${summary.biomeId}` : '',
    };
}

function signedTone(value) {
    return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
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
    elements['short-pause-enabled'].checked =
        settings.features.fishing.shortPauseEnabled;
    elements['short-pause-chance'].value =
        settings.features.fishing.shortPauseChancePercent;
    elements['short-pause-min'].value =
        settings.features.fishing.shortPauseMinMs;
    elements['short-pause-max'].value =
        settings.features.fishing.shortPauseMaxMs;
    elements['long-pause-enabled'].checked =
        settings.features.fishing.longPauseEnabled;
    elements['long-pause-chance'].value =
        settings.features.fishing.longPauseChancePercent;
    elements['long-pause-min'].value =
        settings.features.fishing.longPauseMinMs;
    elements['long-pause-max'].value =
        settings.features.fishing.longPauseMaxMs;
    elements['map-mode'].value = settings.features.map.mode;
    elements['prioritize-tournament'].checked =
        settings.features.map.prioritizeTournament;
    elements['target-biome'].value = settings.features.map.targetBiomeId || '';
    elements['map-check-minutes'].value = settings.features.map.checkIntervalMs / 60_000;
    elements['bait-enabled'].checked = settings.features.bait.enabled;
    elements['bait-tier'].value = settings.features.bait.selectedBaitTier;
    elements['bait-guild-tournament-tier'].value =
        settings.features.bait.guildTournamentBaitTier;
    elements['bait-derby-tier'].value =
        settings.features.bait.derbyBaitTier;
    elements['bait-threshold'].value = settings.features.bait.restockThreshold;
    elements['bait-quantity'].value = settings.features.bait.purchaseQuantity;
    elements['bait-check-seconds'].value = settings.features.bait.checkIntervalMs / 1_000;
    elements['active-min'].value = settings.schedule.activeMinMinutes;
    elements['active-max'].value = settings.schedule.activeMaxMinutes;
    elements['rest-min'].value = settings.schedule.restMinMinutes;
    elements['rest-max'].value = settings.schedule.restMaxMinutes;
    elements['quiet-enabled'].checked = settings.schedule.quietEnabled;
    elements['quiet-start'].value = settings.schedule.quietStartHour;
    elements['quiet-end'].value = settings.schedule.quietEndHour;
    elements['quiet-game-auto-fishing-enabled'].checked =
        settings.schedule.quietGameAutoFishingEnabled;
    elements['quiet-game-auto-fishing-auto-renew'].checked =
        settings.schedule.quietGameAutoFishingAutoRenew;
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
    updateFishingPauseState();
    updateQuietSettingsState();
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
            quietEnabled: elements['quiet-enabled'].checked,
            quietStartHour: integer('quiet-start'),
            quietEndHour: integer('quiet-end'),
            quietGameAutoFishingEnabled:
                elements['quiet-game-auto-fishing-enabled'].checked,
            quietGameAutoFishingAutoRenew:
                elements['quiet-game-auto-fishing-auto-renew'].checked,
        },
        features: {
            fishing: {
                enabled: elements['fishing-enabled'].checked,
                enforceClassicMode: elements['classic-mode'].checked,
                clickDelayMinMs: integer('click-delay-min'),
                clickDelayMaxMs: integer('click-delay-max'),
                shortPauseEnabled:
                    elements['short-pause-enabled'].checked,
                shortPauseChancePercent: integer('short-pause-chance'),
                shortPauseMinMs: integer('short-pause-min'),
                shortPauseMaxMs: integer('short-pause-max'),
                longPauseEnabled: elements['long-pause-enabled'].checked,
                longPauseChancePercent: integer('long-pause-chance'),
                longPauseMinMs: integer('long-pause-min'),
                longPauseMaxMs: integer('long-pause-max'),
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
                guildTournamentBaitTier: integer(
                    'bait-guild-tournament-tier',
                ),
                derbyBaitTier: integer('bait-derby-tier'),
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

function updateFishingPauseState() {
    const shortEnabled = elements['short-pause-enabled'].checked;
    const longEnabled = elements['long-pause-enabled'].checked;

    for (const id of [
        'short-pause-chance',
        'short-pause-min',
        'short-pause-max',
    ]) {
        elements[id].disabled = !shortEnabled;
    }
    for (const id of [
        'long-pause-chance',
        'long-pause-min',
        'long-pause-max',
    ]) {
        elements[id].disabled = !longEnabled;
    }
}

function updateQuietSettingsState() {
    const quietEnabled = elements['quiet-enabled'].checked;
    const gameAutoFishingEnabled = quietEnabled &&
        elements['quiet-game-auto-fishing-enabled'].checked;

    elements['quiet-start'].disabled = !quietEnabled;
    elements['quiet-end'].disabled = !quietEnabled;
    elements['quiet-game-auto-fishing-enabled'].disabled = !quietEnabled;
    elements['quiet-game-auto-fishing-auto-renew'].disabled =
        !gameAutoFishingEnabled;
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
    } else if (nextView === 'gear') {
        renderGear();
        if (
            !state.gear &&
            state.controller?.mode === 'running' &&
            state.controller?.browser === 'open'
        ) {
            void loadGearInventory();
        }
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
    elements['current-gold'].textContent = dashboard?.gold != null
        ? formatNumber(dashboard.gold)
        : '—';

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
    const baitBiome = dashboard?.bait?.biome;
    const baitTier = BAIT_TIER_DISPLAY[String(
        dashboard?.bait?.tier || '',
    ).toLowerCase()] || null;
    const baitLuck = Number(dashboard?.bait?.luck);
    const hasBaitBiome = Boolean(baitId && baitBiome?.name);
    const hasBaitTier = Boolean(baitId && baitTier);
    const hasBaitLuck = Boolean(
        baitId && dashboard?.bait?.luck != null && Number.isFinite(baitLuck),
    );

    elements['current-bait-name'].textContent = baitName || '暂无鱼饵数据';
    elements['current-bait-meta'].hidden = !(
        hasBaitBiome || hasBaitTier || hasBaitLuck
    );
    elements['current-bait-biome'].hidden = !hasBaitBiome;
    elements['current-bait-biome'].textContent = hasBaitBiome
        ? baitBiome.id === 'global'
            ? baitBiome.name
            : `B${baitBiome.id} · ${baitBiome.name}`
        : '';
    elements['current-bait-tier'].hidden = !hasBaitTier;
    elements['current-bait-tier'].className = hasBaitTier
        ? `bait-meta-chip tier-${baitTier.tone}`
        : 'bait-meta-chip tier-default';
    elements['current-bait-tier'].textContent = hasBaitTier
        ? `等级 ${baitTier.level} · ${baitTier.label}`
        : '';
    elements['current-bait-luck'].hidden = !hasBaitLuck;
    elements['current-bait-luck'].textContent = hasBaitLuck
        ? `幸运 +${formatNumber(baitLuck, 0)}`
        : '';
    elements['current-bait-context'].textContent = baitId
        ? [
            biomeId && biomeName
                ? `当前地图 [B${biomeId}] ${biomeName}`
                : biomeName,
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
    const levelEstimate = estimateLevelUp(dashboard, stats.experienceRate);

    elements['level-eta'].textContent = hasProgress && xp >= xpToNext
        ? '预计升级：即将完成'
        : hasProgress
            ? `剩余 ${formatNumber(Math.max(0, xpToNext - xp))} XP · ${formatEstimate(levelEstimate?.remainingMs)}`
            : '预计升级：—';
    elements['level-rate'].textContent = levelEstimate
        ? `${formatNumber(levelEstimate.xpPerHour, 0)} XP/小时 · ${formatNumber(levelEstimate.levelsPerHour, 2)} 级/小时 · 最近 ${formatNumber(stats.experienceRate.sampleCount, 0)} 杆`
        : '经验速度：等待至少 2 次抛竿';
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
        elements['last-fish-meta'].textContent = [
            `${formatNumber(lastFish.count, 0)} 条`,
            display.label,
            lastFish.isPunished ? 'Softban' : null,
        ].filter(Boolean).join(' · ');
        elements['last-fish-reward'].textContent = [
            `${formatNumber(lastFish.gold)} 金币`,
            `${formatNumber(lastFish.xp)} XP`,
            lastFish.isPunished ? '处罚期间无收益' : null,
        ].filter(Boolean).join(' · ');
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
    const average = today.casts > 0 ? today.netGold / today.casts : 0;

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
    renderSignedTone(elements['stats-gold-average'], average);
    renderSignedTone(elements['stats-total-net-gold'], total.netGold);
    renderRarityCounts(elements['rarity-list'], today.rarityCounts, '暂无数据');

    const dayRows = (snapshot.recentDays || []).map(day => [
            day.day,
            tableNumber(day.casts, 'casts', 0),
            tableNumber(day.fish, 'fish', 0),
            tableNumber(day.gold, 'income'),
            tableNumber(day.fishGold, 'gold'),
            tableNumber(day.baitCost, 'cost'),
            tableNumber(day.netGold, signedTone),
            tableNumber(
                day.casts > 0 ? day.netGold / day.casts : 0,
                signedTone,
            ),
            tableNumber(day.xp, 'xp'),
        ]);

    replaceTableRows(elements['daily-stats-body'], dayRows, {
        colspan: 9,
        emptyMessage: '暂无每日收益数据',
    });

    const baitRows = (snapshot.baitSummaries || []).map(summary => [
        baitSummaryLabel(summary),
        tableNumber(summary.casts, 'casts', 0),
        tableNumber(summary.fish, 'fish', 0),
        tableNumber(summary.gold, 'income'),
        tableNumber(summary.fishGold, 'gold'),
        tableNumber(summary.baitCost, 'cost'),
        tableNumber(summary.netGold, signedTone),
        tableNumber(
            summary.casts > 0 ? summary.netGold / summary.casts : 0,
            signedTone,
        ),
        tableNumber(summary.xp, 'xp'),
    ]);

    replaceTableRows(elements['bait-stats-body'], baitRows, {
        colspan: 9,
        emptyMessage: '暂无鱼饵收益数据',
    });

    const biomeRows = (snapshot.biomeSummaries || []).map(summary => [
        biomeSummaryLabel(summary),
        tableNumber(summary.casts, 'casts', 0),
        tableNumber(summary.fish, 'fish', 0),
        tableNumber(summary.gold, 'income'),
        tableNumber(summary.fishGold, 'gold'),
        tableNumber(summary.baitCost, 'cost'),
        tableNumber(summary.netGold, signedTone),
        tableNumber(
            summary.casts > 0 ? summary.netGold / summary.casts : 0,
            signedTone,
        ),
        tableNumber(summary.xp, 'xp'),
    ]);

    replaceTableRows(elements['biome-stats-body'], biomeRows, {
        colspan: 9,
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
        empty.textContent = '暂无验证记录';
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
    renderGear();
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

        if (
            state.controller.mode !== 'running' ||
            state.controller.browser !== 'open'
        ) {
            state.gear = null;
            state.gearError = null;
            state.selectedGearIds.clear();
        }
        renderOverview();
        if (state.currentView === 'gear') {
            renderGear();
            if (
                !state.gear &&
                !state.gearLoading &&
                state.controller.mode === 'running' &&
                state.controller.browser === 'open' &&
                state.controller.engine?.pageReady !== false
            ) {
                void loadGearInventory();
            }
        }
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

elements['gear-refresh'].addEventListener('click', () => {
    void loadGearInventory();
});
elements['gear-backpack-grid'].addEventListener('change', event => {
    const input = event.target.closest('[data-gear-select]');

    if (!input) {
        return;
    }

    if (input.checked) {
        if (state.selectedGearIds.size >= GEAR_SALE_LIMIT) {
            input.checked = false;
            showToast(`单次最多选择 ${GEAR_SALE_LIMIT} 件装备。`, true);
        } else {
            state.selectedGearIds.add(input.dataset.gearSelect);
        }
    } else {
        state.selectedGearIds.delete(input.dataset.gearSelect);
    }
    renderBackpackGears();
});
elements['gear-backpack-grid'].addEventListener('click', event => {
    const button = event.target.closest('[data-equip-gear]');

    if (button) {
        void equipGear(
            button.dataset.equipGear,
            button.dataset.targetSlot || null,
        );
    }
});
elements['gear-select-page'].addEventListener('click', () => {
    const selectable = filteredBackpackGears().filter(gear => !gear.isLocked);

    for (const gear of selectable) {
        if (
            state.selectedGearIds.size < GEAR_SALE_LIMIT
        ) {
            state.selectedGearIds.add(gear.id);
        }
    }
    if (selectable.length > GEAR_SALE_LIMIT) {
        showToast(`单次最多选择 ${GEAR_SALE_LIMIT} 件装备。`, true);
    }
    renderBackpackGears();
});
elements['gear-rule-list'].addEventListener('change', event => {
    const enabled = event.target.closest('[data-gear-rule-enabled]');
    const threshold = event.target.closest('[data-gear-rule-threshold]');

    if (enabled) {
        state.gearRules[enabled.dataset.gearRuleEnabled].enabled =
            enabled.checked;
    } else if (threshold) {
        const rarity = threshold.dataset.gearRuleThreshold;

        state.gearRules[rarity].maxQuality =
            normalizeGearQualityThreshold(threshold.value);
    } else {
        return;
    }

    saveGearRules();
    state.gearPage = 1;
    renderBackpackGears();
});
elements['gear-rule-only'].addEventListener('change', () => {
    state.gearPage = 1;
    renderBackpackGears();
});
elements['gear-select-rules'].addEventListener('click', () => {
    const matches = gearRuleMatches();

    state.selectedGearIds = new Set(
        matches.slice(0, GEAR_SALE_LIMIT).map(gear => gear.id),
    );
    if (matches.length > GEAR_SALE_LIMIT) {
        showToast(
            `规则命中 ${matches.length} 件，已选择前 ${GEAR_SALE_LIMIT} 件。`,
            true,
        );
    }
    renderBackpackGears();
});
elements['gear-clear-selection'].addEventListener('click', () => {
    state.selectedGearIds.clear();
    renderBackpackGears();
});
elements['gear-sell-selected'].addEventListener('click', () => {
    void sellSelectedGears();
});
for (const id of [
    'gear-search',
    'gear-slot-filter',
    'gear-rarity-filter',
    'gear-sort',
]) {
    elements[id].addEventListener(
        id === 'gear-search' ? 'input' : 'change',
        () => {
            state.gearPage = 1;
            renderBackpackGears();
        },
    );
}
elements['gear-page-prev'].addEventListener('click', () => {
    state.gearPage -= 1;
    renderBackpackGears();
});
elements['gear-page-next'].addEventListener('click', () => {
    state.gearPage += 1;
    renderBackpackGears();
});

elements['settings-form'].addEventListener('input', () => {
    state.settingsDirty = true;
    renderSettingsMeta();
});
elements['map-mode'].addEventListener('change', updateMapTargetState);
elements['short-pause-enabled'].addEventListener(
    'change',
    updateFishingPauseState,
);
elements['long-pause-enabled'].addEventListener(
    'change',
    updateFishingPauseState,
);
elements['quiet-enabled'].addEventListener(
    'change',
    updateQuietSettingsState,
);
elements['quiet-game-auto-fishing-enabled'].addEventListener(
    'change',
    updateQuietSettingsState,
);

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
