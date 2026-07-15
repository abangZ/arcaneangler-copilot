import assert from 'node:assert/strict';

import { RuntimeSettings } from '../src/core/runtime-settings.js';
import { StatusReporter } from '../src/core/status-reporter.js';

const settings = RuntimeSettings.fromConfig({
    automationEnabled: true,
    autoFishing: true,
    mapMode: 'auto',
    targetBiomeId: null,
    mapCheckIntervalMs: 3_600_000,
    autoVerify: true,
    autoBait: true,
    baitId: 'bait_default',
    baitRestockThreshold: 100,
    baitPurchaseQuantity: 1_000,
    baitCheckIntervalMs: 30_000,
    enforceClassicMode: true,
    clickDelayMinMs: 250,
    clickDelayMaxMs: 800,
});

assert.deepEqual(settings.get(), {
    automationEnabled: true,
    features: {
        fishing: {
            enabled: true,
            enforceClassicMode: true,
            clickDelayMinMs: 250,
            clickDelayMaxMs: 800,
        },
        map: {
            mode: 'auto',
            targetBiomeId: null,
            checkIntervalMs: 3_600_000,
        },
        verification: { enabled: true },
        bait: {
            enabled: true,
            selectedBaitId: 'bait_default',
            restockThreshold: 100,
            purchaseQuantity: 1_000,
            checkIntervalMs: 30_000,
        },
    },
});

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

console.log(
    'Reporter smoke passed: environment settings, structured output and duplicate suppression work.',
);
