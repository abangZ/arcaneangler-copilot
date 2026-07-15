import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { LogStore } from '../src/core/log-store.js';
import { RuntimeSettings } from '../src/core/runtime-settings.js';
import { DEFAULT_SETTINGS } from '../src/core/settings-schema.js';
import { StatusReporter } from '../src/core/status-reporter.js';

const runtimeValue = structuredClone(DEFAULT_SETTINGS);
runtimeValue.features.map.mode = 'auto';
runtimeValue.features.bait.enabled = true;

const settings = new RuntimeSettings({
    getRuntimeSettings: () => structuredClone(runtimeValue),
});

assert.equal(settings.get().automationEnabled, true);
assert.equal(settings.get().features.map.mode, 'auto');
assert.equal(settings.get().features.bait.enabled, true);
assert.equal(settings.get().features.bait.selectedBaitTier, 0);
assert.deepEqual(settings.get().schedule, DEFAULT_SETTINGS.schedule);

const output = {
    log: [],
    error: [],
};
const logger = {
    log: line => output.log.push(line),
    error: line => output.error.push(line),
};
const now = new Date('2026-07-15T08:00:00.000Z');
const reporter = new StatusReporter({
    logger,
    now: () => now,
});

await reporter.update({
    level: 'running',
    phase: 'ready',
    target: '启动自动化功能',
    activeFeature: '挂机服务',
    message: '已加载 4 个自动化功能。',
});
await reporter.incrementCast();
await reporter.update({
    level: 'error',
    phase: 'recovery',
    target: '恢复自动化',
    message: '页面恢复失败。',
});
await reporter.update({
    level: 'error',
    phase: 'recovery',
    target: '恢复自动化',
    message: '页面恢复失败。',
});

assert.deepEqual(output.log, [
    '[2026-07-15T08:00:00.000Z] [RUNNING/ready] [挂机服务] 目标：启动自动化功能 已加载 4 个自动化功能。 抛竿：0',
    '[2026-07-15T08:00:00.000Z] [RUNNING/fishing] [自动钓鱼] 目标：等待下一次抛竿 完成第 1 次抛竿。 抛竿：1',
]);
assert.deepEqual(output.error, [
    '[2026-07-15T08:00:00.000Z] [ERROR/recovery] [恢复机制] 目标：恢复自动化 页面恢复失败。 抛竿：1',
]);

const tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'arcane-reporter-smoke-'),
);

try {
    for (let day = 1; day <= 8; day += 1) {
        const timestamp = `2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`;

        await fs.writeFile(
            path.join(tempDirectory, `${timestamp.slice(0, 10)}.jsonl`),
            `${JSON.stringify({ id: day, updatedAt: timestamp })}\n`,
        );
    }

    const logStore = new LogStore({
        directory: tempDirectory,
        retentionDays: 3,
    });

    await logStore.initialize();
    assert.deepEqual(
        (await fs.readdir(tempDirectory)).sort(),
        [
            '2026-07-06.jsonl',
            '2026-07-07.jsonl',
            '2026-07-08.jsonl',
        ],
    );

    await logStore.append({
        level: 'running',
        updatedAt: '2026-07-09T00:00:00.000Z',
        message: '跨日日志。',
    });
    assert.deepEqual(
        (await fs.readdir(tempDirectory)).sort(),
        [
            '2026-07-07.jsonl',
            '2026-07-08.jsonl',
            '2026-07-09.jsonl',
        ],
    );
    assert.equal(
        (await fs.stat(path.join(tempDirectory, '2026-07-09.jsonl')))
            .mode & 0o777,
        0o600,
    );
} finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
}

console.log(
    'Reporter smoke passed: structured output, duplicate suppression and rolling daily logs work.',
);
