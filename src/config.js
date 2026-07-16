import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

export const projectRoot = path.resolve(
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

function readString(name, fallback) {
    return process.env[name]?.trim() || fallback;
}

function readInteger(name, fallback, { min = 0, max = 65_535 } = {}) {
    const rawValue = process.env[name]?.trim();

    if (!rawValue) {
        return fallback;
    }

    const value = Number(rawValue);

    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} 必须是 ${min} 到 ${max} 之间的整数。`);
    }

    return value;
}

function resolveProjectPath(value) {
    return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

const targetUrl = readString('ARCANE_URL', 'https://arcaneangler.com/');

try {
    new URL(targetUrl);
} catch {
    throw new Error('ARCANE_URL 不是有效 URL。');
}

export const config = Object.freeze({
    username: readRequired('ARCANE_USERNAME'),
    password: readRequired('ARCANE_PASSWORD', { trim: false }),
    targetUrl,
    webHost: readString('ARCANE_WEB_HOST', '127.0.0.1'),
    webPort: readInteger('ARCANE_WEB_PORT', 3_200, { min: 1 }),
    userDataDir: resolveProjectPath(
        readString('ARCANE_USER_DATA_DIR', '.data/browser'),
    ),
    artifactsDir: resolveProjectPath(
        readString('ARCANE_ARTIFACTS_DIR', 'artifacts'),
    ),
    settingsFile: resolveProjectPath('.data/settings.json'),
    sessionsFile: resolveProjectPath('.data/sessions.json'),
    statsFile: resolveProjectPath('.data/stats.json'),
    logsDir: resolveProjectPath('.data/logs'),
});
