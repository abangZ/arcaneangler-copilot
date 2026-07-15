import assert from 'node:assert/strict';

import { AutomationEngine } from '../src/core/automation-engine.js';
import {
    OPERATION_STATES,
    OperationScheduler,
} from '../src/core/operation-scheduler.js';

const config = {
    activeMinMinutes: 40,
    activeMaxMinutes: 70,
    restMinMinutes: 5,
    restMaxMinutes: 15,
    quietStartHour: 0,
    quietEndHour: 8,
};

let now = new Date(2026, 6, 14, 9, 0, 0, 0);
const draws = [40, 5, 70];
const scheduler = new OperationScheduler(config, {
    now: () => new Date(now),
    random: (min, max) => {
        const value = draws.shift();
        assert.ok(value >= min && value <= max);
        return value;
    },
});

let gate = scheduler.evaluate();
assert.equal(gate.allowed, true);
assert.equal(gate.mode, OPERATION_STATES.ACTIVE);
assert.equal(gate.durationMinutes, 40);
assert.equal(gate.until.getHours(), 9);
assert.equal(gate.until.getMinutes(), 40);
assert.equal(scheduler.canOperateNow(), true);

now = new Date(2026, 6, 14, 9, 39, 59, 0);
gate = scheduler.evaluate();
assert.equal(gate.allowed, true);
assert.equal(gate.transitioned, false);

now = new Date(2026, 6, 14, 9, 40, 0, 0);
gate = scheduler.evaluate();
assert.equal(gate.allowed, false);
assert.equal(gate.mode, OPERATION_STATES.REST);
assert.equal(gate.durationMinutes, 5);
assert.equal(gate.resumeAt.getHours(), 9);
assert.equal(gate.resumeAt.getMinutes(), 45);
assert.equal(scheduler.canOperateNow(), false);

now = new Date(2026, 6, 14, 9, 44, 0, 0);
gate = scheduler.evaluate();
assert.equal(gate.mode, OPERATION_STATES.REST);
assert.equal(gate.durationMinutes, 5);
assert.equal(gate.transitioned, false);

now = new Date(2026, 6, 14, 9, 45, 0, 0);
gate = scheduler.evaluate();
assert.equal(gate.allowed, true);
assert.equal(gate.durationMinutes, 70);
assert.equal(gate.resumedFrom, OPERATION_STATES.REST);

gate = scheduler.evaluate({ enabled: false });
assert.equal(gate.allowed, false);
assert.equal(gate.mode, OPERATION_STATES.DISABLED);
assert.equal(scheduler.canOperateNow(), false);

let quietNow = new Date(2026, 6, 15, 0, 0, 0, 0);
const quietScheduler = new OperationScheduler(config, {
    now: () => new Date(quietNow),
    random: (_min, max) => max,
});

gate = quietScheduler.evaluate();
assert.equal(gate.allowed, false);
assert.equal(gate.mode, OPERATION_STATES.QUIET);
assert.equal(gate.resumeAt.getHours(), 8);
assert.equal(gate.waitMs, 8 * 60 * 60 * 1_000);
assert.equal(quietScheduler.canOperateNow(), false);

quietNow = new Date(2026, 6, 15, 7, 59, 59, 0);
gate = quietScheduler.evaluate();
assert.equal(gate.mode, OPERATION_STATES.QUIET);
assert.equal(gate.transitioned, false);

quietNow = new Date(2026, 6, 15, 8, 0, 0, 0);
gate = quietScheduler.evaluate();
assert.equal(gate.allowed, true);
assert.equal(gate.mode, OPERATION_STATES.ACTIVE);
assert.equal(gate.durationMinutes, 70);
assert.equal(gate.resumedFrom, OPERATION_STATES.QUIET);
assert.equal(quietScheduler.canOperateNow(), true);

quietNow = new Date(2026, 6, 15, 23, 59, 59, 0);
quietScheduler.reset();
gate = quietScheduler.evaluate();
assert.equal(gate.allowed, true);

quietNow = new Date(2026, 6, 16, 0, 0, 0, 0);
gate = quietScheduler.evaluate();
assert.equal(gate.allowed, false);
assert.equal(gate.mode, OPERATION_STATES.QUIET);
assert.equal(quietScheduler.canOperateNow(), false);

const updatedSchedule = {
    ...config,
    quietStartHour: 9,
    quietEndHour: 10,
};
assert.equal(quietScheduler.updateConfig(updatedSchedule), true);
assert.equal(quietScheduler.mode, OPERATION_STATES.IDLE);
quietNow = new Date(2026, 6, 16, 9, 0, 0, 0);
gate = quietScheduler.evaluate();
assert.equal(gate.mode, OPERATION_STATES.QUIET);
assert.equal(gate.quietStartHour, 9);
assert.equal(gate.quietEndHour, 10);

quietScheduler.updateConfig(config);

let lifecycleNow = new Date(2026, 6, 16, 1, 0, 0, 0);
const lifecycleEvents = [];
const lifecycleScheduler = new OperationScheduler(config, {
    now: () => new Date(lifecycleNow),
    random: min => min,
});
const engine = new AutomationEngine({
    config: {
        ...config,
        pollIntervalMs: 1,
        recoveryErrorCount: 3,
    },
    settings: {
        get: () => ({
            automationEnabled: true,
            schedule: config,
            advanced: { pollIntervalMs: 1, recoveryErrorCount: 3 },
            features: { fishing: { enabled: true } },
        }),
    },
    reporter: {
        update: async () => {},
    },
    session: {
        bootstrap: async () => lifecycleEvents.push('bootstrap'),
    },
    browserLifecycle: {
        suspend: async () => lifecycleEvents.push('suspend'),
        resume: async () => lifecycleEvents.push('resume'),
    },
});

engine.scheduler = lifecycleScheduler;
engine.waitForSchedule = async gateState => {
    lifecycleEvents.push(`wait:${gateState.mode}`);
};
engine.register({
    id: 'fishing',
    label: '自动钓鱼',
    priority: 100,
    isEnabled: () => true,
    reset: () => lifecycleEvents.push('reset'),
    tick: async () => {
        lifecycleEvents.push('tick');
        return true;
    },
});

await engine.runCycle();
assert.deepEqual(lifecycleEvents, [
    'suspend',
    'reset',
    `wait:${OPERATION_STATES.QUIET}`,
]);

await engine.runCycle();
assert.equal(
    lifecycleEvents.filter(event => event === 'suspend').length,
    1,
);

lifecycleNow = new Date(2026, 6, 16, 8, 0, 0, 0);
await engine.runCycle();
assert.deepEqual(lifecycleEvents.slice(-4), [
    'resume',
    'bootstrap',
    'reset',
    'tick',
]);

console.log(
    'Scheduler smoke passed: state transitions, quiet browser suspend/resume and active/rest ranges work.',
);
