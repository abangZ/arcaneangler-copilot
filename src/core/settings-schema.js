export const SETTINGS_VERSION = 1;

export class SettingsValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SettingsValidationError';
        this.statusCode = 400;
    }
}

export const DEFAULT_SETTINGS = deepFreeze({
    general: {
        character: null,
    },
    browser: {
        headless: true,
    },
    schedule: {
        activeMinMinutes: 40,
        activeMaxMinutes: 70,
        restMinMinutes: 5,
        restMaxMinutes: 15,
        quietStartHour: 0,
        quietEndHour: 8,
    },
    features: {
        fishing: {
            enabled: true,
            enforceClassicMode: true,
            clickDelayMinMs: 500,
            clickDelayMaxMs: 2_000,
        },
        map: {
            mode: 'off',
            targetBiomeId: null,
            checkIntervalMs: 3_600_000,
        },
        bait: {
            enabled: false,
            selectedBaitTier: 0,
            restockThreshold: 100,
            purchaseQuantity: 1_000,
            checkIntervalMs: 30_000,
        },
        verification: {
            enabled: true,
            stepDelayMinMs: 700,
            stepDelayMaxMs: 1_400,
            maxAttempts: 2,
        },
    },
    advanced: {
        pollIntervalMs: 250,
        stallTimeoutMs: 60_000,
        navigationTimeoutMs: 30_000,
        recoveryErrorCount: 3,
    },
});

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) {
            deepFreeze(child);
        }
    }

    return value;
}

function expectObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new SettingsValidationError(`${label} 必须是对象。`);
    }

    return value;
}

function expectKnownKeys(value, keys, label) {
    const unknownKeys = Object.keys(value).filter(key => !keys.includes(key));

    if (unknownKeys.length > 0) {
        throw new SettingsValidationError(
            `${label} 包含未知字段：${unknownKeys.join('、')}。`,
        );
    }
}

function readBoolean(value, label) {
    if (typeof value !== 'boolean') {
        throw new SettingsValidationError(`${label} 必须是布尔值。`);
    }

    return value;
}

function readInteger(value, label, { min = 0, max = 2_147_483_647 } = {}) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new SettingsValidationError(
            `${label} 必须是 ${min} 到 ${max} 之间的整数。`,
        );
    }

    return value;
}

function readChoice(value, label, choices) {
    if (typeof value !== 'string' || !choices.includes(value)) {
        throw new SettingsValidationError(
            `${label} 必须是 ${choices.join('、')} 之一。`,
        );
    }

    return value;
}

function readCharacter(value) {
    if (value == null || value === '') {
        return null;
    }

    if (typeof value !== 'string') {
        throw new SettingsValidationError('角色名必须是字符串。');
    }

    const character = value.trim();

    if (!character) {
        return null;
    }

    if (character.length > 100) {
        throw new SettingsValidationError('角色名不能超过 100 个字符。');
    }

    return character;
}

export function validateSettings(input) {
    const root = expectObject(input, '配置');
    expectKnownKeys(
        root,
        ['general', 'browser', 'schedule', 'features', 'advanced'],
        '配置',
    );

    const general = expectObject(root.general, '通用配置');
    expectKnownKeys(general, ['character'], '通用配置');

    const browser = expectObject(root.browser, '浏览器配置');
    expectKnownKeys(browser, ['headless'], '浏览器配置');

    const schedule = expectObject(root.schedule, '挂机计划');
    expectKnownKeys(schedule, [
        'activeMinMinutes',
        'activeMaxMinutes',
        'restMinMinutes',
        'restMaxMinutes',
        'quietStartHour',
        'quietEndHour',
    ], '挂机计划');

    const features = expectObject(root.features, '功能配置');
    expectKnownKeys(
        features,
        ['fishing', 'map', 'bait', 'verification'],
        '功能配置',
    );

    const fishing = expectObject(features.fishing, '自动钓鱼配置');
    expectKnownKeys(fishing, [
        'enabled',
        'enforceClassicMode',
        'clickDelayMinMs',
        'clickDelayMaxMs',
    ], '自动钓鱼配置');

    const map = expectObject(features.map, '自动地图配置');
    expectKnownKeys(
        map,
        ['mode', 'targetBiomeId', 'checkIntervalMs'],
        '自动地图配置',
    );

    const bait = expectObject(features.bait, '自动鱼饵配置');
    expectKnownKeys(bait, [
        'enabled',
        'selectedBaitTier',
        'restockThreshold',
        'purchaseQuantity',
        'checkIntervalMs',
    ], '自动鱼饵配置');

    const verification = expectObject(
        features.verification,
        '人机验证配置',
    );
    expectKnownKeys(verification, [
        'enabled',
        'stepDelayMinMs',
        'stepDelayMaxMs',
        'maxAttempts',
    ], '人机验证配置');

    const advanced = expectObject(root.advanced, '高级配置');
    expectKnownKeys(advanced, [
        'pollIntervalMs',
        'stallTimeoutMs',
        'navigationTimeoutMs',
        'recoveryErrorCount',
    ], '高级配置');

    const normalized = {
        general: {
            character: readCharacter(general.character),
        },
        browser: {
            headless: readBoolean(browser.headless, '无头模式'),
        },
        schedule: {
            activeMinMinutes: readInteger(
                schedule.activeMinMinutes,
                '最短运行时间',
                { min: 1, max: 1_440 },
            ),
            activeMaxMinutes: readInteger(
                schedule.activeMaxMinutes,
                '最长运行时间',
                { min: 1, max: 1_440 },
            ),
            restMinMinutes: readInteger(
                schedule.restMinMinutes,
                '最短休息时间',
                { min: 1, max: 1_440 },
            ),
            restMaxMinutes: readInteger(
                schedule.restMaxMinutes,
                '最长休息时间',
                { min: 1, max: 1_440 },
            ),
            quietStartHour: readInteger(
                schedule.quietStartHour,
                '夜间停机开始小时',
                { max: 23 },
            ),
            quietEndHour: readInteger(
                schedule.quietEndHour,
                '夜间停机结束小时',
                { max: 23 },
            ),
        },
        features: {
            fishing: {
                enabled: readBoolean(fishing.enabled, '自动钓鱼开关'),
                enforceClassicMode: readBoolean(
                    fishing.enforceClassicMode,
                    '经典模式开关',
                ),
                clickDelayMinMs: readInteger(
                    fishing.clickDelayMinMs,
                    '最短点击延迟',
                    { max: 60_000 },
                ),
                clickDelayMaxMs: readInteger(
                    fishing.clickDelayMaxMs,
                    '最长点击延迟',
                    { max: 60_000 },
                ),
            },
            map: {
                mode: readChoice(
                    map.mode,
                    '地图模式',
                    ['off', 'fixed', 'auto'],
                ),
                targetBiomeId: map.targetBiomeId == null
                    ? null
                    : readInteger(map.targetBiomeId, '目标地图编号', {
                        min: 1,
                        max: 999,
                    }),
                checkIntervalMs: readInteger(
                    map.checkIntervalMs,
                    '地图检查间隔',
                    { min: 60_000, max: 86_400_000 },
                ),
            },
            bait: {
                enabled: readBoolean(bait.enabled, '自动鱼饵开关'),
                selectedBaitTier: readInteger(
                    bait.selectedBaitTier,
                    '鱼饵档位',
                    { max: 4 },
                ),
                restockThreshold: readInteger(
                    bait.restockThreshold,
                    '鱼饵补货阈值',
                    { max: 999_999 },
                ),
                purchaseQuantity: readInteger(
                    bait.purchaseQuantity,
                    '鱼饵购买数量',
                    { min: 100, max: 999_900 },
                ),
                checkIntervalMs: readInteger(
                    bait.checkIntervalMs,
                    '鱼饵检查间隔',
                    { min: 5_000, max: 3_600_000 },
                ),
            },
            verification: {
                enabled: readBoolean(
                    verification.enabled,
                    '自动验证开关',
                ),
                stepDelayMinMs: readInteger(
                    verification.stepDelayMinMs,
                    '验证最短步骤延迟',
                    { min: 100, max: 60_000 },
                ),
                stepDelayMaxMs: readInteger(
                    verification.stepDelayMaxMs,
                    '验证最长步骤延迟',
                    { min: 100, max: 60_000 },
                ),
                maxAttempts: readInteger(
                    verification.maxAttempts,
                    '验证最大尝试次数',
                    { min: 1, max: 20 },
                ),
            },
        },
        advanced: {
            pollIntervalMs: readInteger(
                advanced.pollIntervalMs,
                '轮询间隔',
                { min: 50, max: 60_000 },
            ),
            stallTimeoutMs: readInteger(
                advanced.stallTimeoutMs,
                '停滞超时',
                { min: 10_000, max: 86_400_000 },
            ),
            navigationTimeoutMs: readInteger(
                advanced.navigationTimeoutMs,
                '页面操作超时',
                { min: 5_000, max: 300_000 },
            ),
            recoveryErrorCount: readInteger(
                advanced.recoveryErrorCount,
                '连续错误恢复阈值',
                { min: 1, max: 100 },
            ),
        },
    };

    if (
        normalized.schedule.activeMinMinutes >
        normalized.schedule.activeMaxMinutes
    ) {
        throw new SettingsValidationError(
            '最短运行时间不能大于最长运行时间。',
        );
    }

    if (
        normalized.schedule.restMinMinutes >
        normalized.schedule.restMaxMinutes
    ) {
        throw new SettingsValidationError(
            '最短休息时间不能大于最长休息时间。',
        );
    }

    if (
        normalized.schedule.quietStartHour ===
        normalized.schedule.quietEndHour
    ) {
        throw new SettingsValidationError(
            '夜间停机的开始和结束小时不能相同。',
        );
    }

    if (
        normalized.features.fishing.clickDelayMinMs >
        normalized.features.fishing.clickDelayMaxMs
    ) {
        throw new SettingsValidationError(
            '最短点击延迟不能大于最长点击延迟。',
        );
    }

    if (
        normalized.features.verification.stepDelayMinMs >
        normalized.features.verification.stepDelayMaxMs
    ) {
        throw new SettingsValidationError(
            '验证最短步骤延迟不能大于最长步骤延迟。',
        );
    }

    if (
        normalized.features.bait.purchaseQuantity % 100 !== 0
    ) {
        throw new SettingsValidationError('鱼饵购买数量必须是 100 的倍数。');
    }

    if (
        normalized.features.map.mode === 'fixed' &&
        normalized.features.map.targetBiomeId == null
    ) {
        throw new SettingsValidationError('固定地图模式必须填写目标地图编号。');
    }

    return deepFreeze(normalized);
}

export function settingsRequireWorkerRestart(previous, next) {
    return (
        previous.browser.headless !== next.browser.headless ||
        previous.general.character !== next.general.character ||
        previous.advanced.navigationTimeoutMs !==
            next.advanced.navigationTimeoutMs
    );
}
