import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);

loadEnv({
    path: path.join(projectRoot, '.env'),
    quiet: true,
});

function readRequired(name, { trim = true } = {}) {
    const rawValue = process.env[name];
    const value = trim ? rawValue?.trim() : rawValue;

    if (!value) {
        throw new Error(
            `缺少环境变量 ${name}。请复制 .env.example 为 .env 后填写。`,
        );
    }

    return value;
}

function readString(name, fallback = '') {
    return process.env[name]?.trim() || fallback;
}

function readBoolean(name, fallback) {
    const value = process.env[name]?.trim().toLowerCase();

    if (value == null || value === '') {
        return fallback;
    }

    if (['1', 'true', 'yes', 'on'].includes(value)) {
        return true;
    }

    if (['0', 'false', 'no', 'off'].includes(value)) {
        return false;
    }

    throw new Error(`${name} 必须是 true 或 false。`);
}

function readChoice(name, fallback, choices) {
    const value = readString(name, fallback).toLowerCase();

    if (!choices.includes(value)) {
        throw new Error(`${name} 必须是 ${choices.join('、')} 之一。`);
    }

    return value;
}

function readInteger(
    name,
    fallback,
    { min = 0, max = Number.MAX_SAFE_INTEGER } = {},
) {
    const rawValue = process.env[name]?.trim();

    if (!rawValue) {
        return fallback;
    }

    const value = Number(rawValue);

    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(
            `${name} 必须是 ${min} 到 ${max} 之间的整数。`,
        );
    }

    return value;
}

function resolveProjectPath(value) {
    return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

const clickDelayMinMs = readInteger(
    'ARCANE_CLICK_DELAY_MIN_MS',
    250,
    { max: 60_000 },
);
const clickDelayMaxMs = readInteger(
    'ARCANE_CLICK_DELAY_MAX_MS',
    800,
    { max: 60_000 },
);

if (clickDelayMinMs > clickDelayMaxMs) {
    throw new Error(
        'ARCANE_CLICK_DELAY_MIN_MS 不能大于 ARCANE_CLICK_DELAY_MAX_MS。',
    );
}

const verificationStepDelayMinMs = readInteger(
    'ARCANE_VERIFICATION_DELAY_MIN_MS',
    700,
    { min: 100 },
);
const verificationStepDelayMaxMs = readInteger(
    'ARCANE_VERIFICATION_DELAY_MAX_MS',
    1_400,
    { min: 100 },
);

if (verificationStepDelayMinMs > verificationStepDelayMaxMs) {
    throw new Error(
        'ARCANE_VERIFICATION_DELAY_MIN_MS 不能大于 ARCANE_VERIFICATION_DELAY_MAX_MS。',
    );
}

const baitPurchaseQuantity = readInteger(
    'ARCANE_BAIT_PURCHASE_QUANTITY',
    1_000,
    { min: 100, max: 999_900 },
);

if (baitPurchaseQuantity % 100 !== 0) {
    throw new Error('ARCANE_BAIT_PURCHASE_QUANTITY 必须是 100 的倍数。');
}

const mapMode = readChoice(
    'ARCANE_MAP_MODE',
    'off',
    ['off', 'fixed', 'auto'],
);
const targetBiomeId = readInteger(
    'ARCANE_TARGET_BIOME_ID',
    0,
    { max: 999 },
);

if (mapMode === 'fixed' && targetBiomeId < 1) {
    throw new Error(
        'ARCANE_MAP_MODE=fixed 时必须配置 ARCANE_TARGET_BIOME_ID。',
    );
}

const activeMinMinutes = readInteger(
    'ARCANE_ACTIVE_MIN_MINUTES',
    40,
    { min: 1, max: 1_440 },
);
const activeMaxMinutes = readInteger(
    'ARCANE_ACTIVE_MAX_MINUTES',
    70,
    { min: 1, max: 1_440 },
);

if (activeMinMinutes > activeMaxMinutes) {
    throw new Error(
        'ARCANE_ACTIVE_MIN_MINUTES 不能大于 ARCANE_ACTIVE_MAX_MINUTES。',
    );
}

const restMinMinutes = readInteger(
    'ARCANE_REST_MIN_MINUTES',
    5,
    { min: 1, max: 1_440 },
);
const restMaxMinutes = readInteger(
    'ARCANE_REST_MAX_MINUTES',
    15,
    { min: 1, max: 1_440 },
);

if (restMinMinutes > restMaxMinutes) {
    throw new Error(
        'ARCANE_REST_MIN_MINUTES 不能大于 ARCANE_REST_MAX_MINUTES。',
    );
}

const quietStartHour = readInteger(
    'ARCANE_QUIET_START_HOUR',
    0,
    { max: 23 },
);
const quietEndHour = readInteger(
    'ARCANE_QUIET_END_HOUR',
    8,
    { max: 23 },
);

if (quietStartHour === quietEndHour) {
    throw new Error('夜间停挂机的开始和结束小时不能相同。');
}

const targetUrl = readString(
    'ARCANE_URL',
    'https://arcaneangler.com/',
);

try {
    new URL(targetUrl);
} catch {
    throw new Error('ARCANE_URL 不是有效 URL。');
}

export const config = Object.freeze({
    targetUrl,
    username: readRequired('ARCANE_USERNAME'),
    password: readRequired('ARCANE_PASSWORD', { trim: false }),
    character: readString('ARCANE_CHARACTER') || null,
    headless: readBoolean('ARCANE_HEADLESS', true),
    automationEnabled: readBoolean('ARCANE_AUTOMATION_ENABLED', true),
    autoFishing: readBoolean('ARCANE_AUTO_FISHING', true),
    mapMode,
    targetBiomeId: targetBiomeId || null,
    mapCheckIntervalMs: readInteger(
        'ARCANE_MAP_CHECK_INTERVAL_MS',
        3_600_000,
        { min: 60_000, max: 86_400_000 },
    ),
    autoBait: readBoolean('ARCANE_AUTO_BAIT', false),
    baitTier: readInteger('ARCANE_BAIT_TIER', 0, { max: 4 }),
    baitRestockThreshold: readInteger(
        'ARCANE_BAIT_RESTOCK_THRESHOLD',
        100,
        { max: 999_999 },
    ),
    baitPurchaseQuantity,
    baitCheckIntervalMs: readInteger(
        'ARCANE_BAIT_CHECK_INTERVAL_MS',
        30_000,
        { min: 5_000, max: 3_600_000 },
    ),
    activeMinMinutes,
    activeMaxMinutes,
    restMinMinutes,
    restMaxMinutes,
    quietStartHour,
    quietEndHour,
    autoVerify: readBoolean('ARCANE_AUTO_VERIFY', true),
    enforceClassicMode: readBoolean(
        'ARCANE_ENFORCE_CLASSIC_MODE',
        true,
    ),
    userDataDir: resolveProjectPath(
        readString('ARCANE_USER_DATA_DIR', '.data/browser'),
    ),
    artifactsDir: resolveProjectPath(
        readString('ARCANE_ARTIFACTS_DIR', 'artifacts'),
    ),
    clickDelayMinMs,
    clickDelayMaxMs,
    pollIntervalMs: readInteger('ARCANE_POLL_INTERVAL_MS', 250, {
        min: 50,
    }),
    stallTimeoutMs: readInteger('ARCANE_STALL_TIMEOUT_MS', 60_000, {
        min: 10_000,
    }),
    navigationTimeoutMs: readInteger(
        'ARCANE_NAVIGATION_TIMEOUT_MS',
        30_000,
        { min: 5_000 },
    ),
    recoveryErrorCount: readInteger(
        'ARCANE_RECOVERY_ERROR_COUNT',
        3,
        { min: 1 },
    ),
    verificationStepDelayMinMs,
    verificationStepDelayMaxMs,
    verificationMaxAttempts: readInteger(
        'ARCANE_VERIFICATION_MAX_ATTEMPTS',
        2,
        { min: 1 },
    ),
});
