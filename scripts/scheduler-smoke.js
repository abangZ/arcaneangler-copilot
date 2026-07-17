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
assert.equal(gate.resumeAt.getHours(), 9);
assert.equal(gate.waitMs, 9 * 60 * 60 * 1_000);
assert.equal(quietScheduler.canOperateNow(), false);

quietNow = new Date(2026, 6, 15, 7, 59, 59, 0);
gate = quietScheduler.evaluate();
assert.equal(gate.mode, OPERATION_STATES.QUIET);
assert.equal(gate.transitioned, false);

quietNow = new Date(2026, 6, 15, 8, 0, 0, 0);
gate = quietScheduler.evaluate();
assert.equal(gate.allowed, false);
assert.equal(gate.mode, OPERATION_STATES.QUIET);
assert.equal(gate.resumeAt.getHours(), 9);

quietNow = new Date(2026, 6, 15, 9, 0, 0, 0);
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

let competitionNow = new Date(2026, 6, 16, 10, 0, 0, 0);
const competitionScheduler = new OperationScheduler(config, {
    now: () => new Date(competitionNow),
    random: min => min,
});
const overlappingCompetitions = [
    {
        type: 'world-boss',
        id: 'anomaly-9',
        startAt: '2026-07-16T02:35:00.000Z',
        endAt: '2026-07-16T02:50:00.000Z',
    },
    {
        type: 'derby',
        id: '17',
        number: 17,
        biomeId: 2,
        startAt: '2026-07-16T02:30:00.000Z',
        endAt: '2026-07-16T03:30:00.000Z',
    },
    {
        type: 'guild-tournament',
        id: '226',
        number: 226,
        biomeId: 4,
        startAt: '2026-07-16T02:30:00.000Z',
        endAt: '2026-07-16T03:30:00.000Z',
    },
];

gate = competitionScheduler.evaluate();
assert.equal(gate.mode, OPERATION_STATES.ACTIVE);
competitionNow = new Date(2026, 6, 16, 10, 40, 0, 0);
gate = competitionScheduler.evaluate({
    competitions: overlappingCompetitions,
});
assert.equal(gate.allowed, true);
assert.equal(gate.mode, OPERATION_STATES.COMPETITION);
assert.equal(gate.competition.type, 'world-boss');
assert.equal(gate.competition.biomeId, null);
competitionNow = new Date(2026, 6, 16, 10, 50, 0, 0);
gate = competitionScheduler.evaluate({
    competitions: overlappingCompetitions,
});
assert.equal(gate.competition.type, 'guild-tournament');
assert.equal(gate.competition.biomeId, 4);
assert.equal(competitionScheduler.canOperateNow(), true);

competitionNow = new Date(2026, 6, 16, 11, 30, 0, 0);
gate = competitionScheduler.evaluate({
    competitions: overlappingCompetitions,
});
assert.equal(gate.allowed, false);
assert.equal(gate.mode, OPERATION_STATES.REST);
assert.equal(gate.durationMinutes, 5);

let nightNow = new Date(2026, 6, 17, 0, 30, 0, 0);
const nightScheduler = new OperationScheduler(config, {
    now: () => new Date(nightNow),
    random: min => min,
});
const nightCompetitions = [{
    type: 'guild-tournament',
    id: 'night-1',
    number: 301,
    biomeId: 6,
    startAt: '2026-07-16T17:00:00.000Z',
    endAt: '2026-07-16T18:00:00.000Z',
}];

gate = nightScheduler.evaluate({ competitions: nightCompetitions });
assert.equal(gate.mode, OPERATION_STATES.QUIET);
nightNow = new Date(2026, 6, 17, 1, 0, 0, 0);
gate = nightScheduler.evaluate({ competitions: nightCompetitions });
assert.equal(gate.mode, OPERATION_STATES.COMPETITION);
assert.equal(gate.allowed, true);
nightNow = new Date(2026, 6, 17, 2, 0, 0, 0);
gate = nightScheduler.evaluate({ competitions: nightCompetitions });
assert.equal(gate.mode, OPERATION_STATES.QUIET);
assert.equal(gate.resumeAt.getHours(), 9);

let lifecycleNow = new Date(2026, 6, 16, 1, 0, 0, 0);
const lifecycleEvents = [];
let lifecycleCompetitions = [];
let lifecyclePunishmentExpiresAt = null;
let baitCheckDue = true;
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
            features: {
                bait: { enabled: true },
                fishing: { enabled: true },
            },
        }),
    },
    reporter: {
        update: async () => {},
    },
    session: {
        bootstrap: async () => lifecycleEvents.push('bootstrap'),
        getCompetitionSchedule: () => lifecycleCompetitions,
        getActivePunishmentExpiresAt: () =>
            lifecyclePunishmentExpiresAt,
    },
    browserLifecycle: {
        suspend: async () => lifecycleEvents.push('suspend'),
        resume: async () => lifecycleEvents.push('resume'),
    },
    onPageReady: async () => lifecycleEvents.push('snapshot'),
});

engine.scheduler = lifecycleScheduler;
engine.waitForSchedule = async gateState => {
    lifecycleEvents.push(`wait:${gateState.mode}`);
};
engine.register({
    id: 'bait',
    label: '自动鱼饵',
    priority: 50,
    isEnabled: () => true,
    reset: () => {
        baitCheckDue = true;
        lifecycleEvents.push('reset:bait');
    },
    tick: async () => {
        lifecycleEvents.push('tick:bait');
        if (!baitCheckDue) {
            return false;
        }

        baitCheckDue = false;
        return true;
    },
});
engine.register({
    id: 'fishing',
    label: '自动钓鱼',
    priority: 100,
    isEnabled: () => true,
    reset: () => lifecycleEvents.push('reset:fishing'),
    tick: async () => {
        lifecycleEvents.push('tick:fishing');
        return true;
    },
});

await engine.runCycle();
assert.deepEqual(lifecycleEvents, [
    'suspend',
    'reset:bait',
    'reset:fishing',
    `wait:${OPERATION_STATES.QUIET}`,
]);

await engine.runCycle();
assert.equal(
    lifecycleEvents.filter(event => event === 'suspend').length,
    1,
);

lifecycleNow = new Date(2026, 6, 16, 8, 0, 0, 0);
await engine.runCycle();
assert.equal(lifecycleEvents.at(-1), `wait:${OPERATION_STATES.QUIET}`);

lifecycleCompetitions = [{
    type: 'guild-tournament',
    id: 'night-engine',
    number: 302,
    biomeId: 7,
    startAt: '2026-07-16T00:00:00.000Z',
    endAt: '2026-07-16T00:30:00.000Z',
}];
await engine.runCycle();
assert.deepEqual(lifecycleEvents.slice(-6), [
    'resume',
    'bootstrap',
    'snapshot',
    'reset:bait',
    'reset:fishing',
    'tick:bait',
]);

await engine.runCycle();
assert.deepEqual(lifecycleEvents.slice(-2), [
    'tick:bait',
    'tick:fishing',
]);

lifecycleNow = new Date(2026, 6, 16, 8, 30, 0, 0);
await engine.runCycle();
assert.deepEqual(lifecycleEvents.slice(-4), [
    'suspend',
    'reset:bait',
    'reset:fishing',
    `wait:${OPERATION_STATES.QUIET}`,
]);

lifecycleNow = new Date(2026, 6, 16, 9, 0, 0, 0);
await engine.runCycle();
assert.deepEqual(lifecycleEvents.slice(-6), [
    'resume',
    'bootstrap',
    'snapshot',
    'reset:bait',
    'reset:fishing',
    'tick:bait',
]);

lifecyclePunishmentExpiresAt = '2099-07-16T02:00:00.000Z';
const punishmentEventCount = lifecycleEvents.length;
await engine.runCycle();
assert.deepEqual(lifecycleEvents.slice(punishmentEventCount), []);
assert.equal(
    engine.getState().punishmentExpiresAt,
    lifecyclePunishmentExpiresAt,
);

lifecyclePunishmentExpiresAt = null;
await engine.runCycle();
assert.deepEqual(lifecycleEvents.slice(-3), [
    'reset:bait',
    'reset:fishing',
    'tick:bait',
]);
assert.equal(engine.getState().punishmentExpiresAt, null);

console.log(
    'Scheduler smoke passed: world boss priority, deferred rest, night wakeup and delayed morning resume work.',
);
