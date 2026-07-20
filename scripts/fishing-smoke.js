import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
    DEFAULT_SETTINGS,
    SETTINGS_VERSION,
    SettingsValidationError,
    validateSettings,
} from '../src/core/settings-schema.js';
import { SettingsStore } from '../src/core/settings-store.js';
import {
    FishingFeature,
    NO_FISH_REFRESH_MS,
    selectCastDelay,
    waitForCastButtonToLeaveReadyState,
    waitForCastDelay,
} from '../src/features/fishing-feature.js';
import { ArcaneAnglerPage } from '../src/site/arcane-angler-page.js';

assert.equal(
    DEFAULT_SETTINGS.features.fishing.clickDelayMinMs,
    500,
);
assert.equal(
    DEFAULT_SETTINGS.features.fishing.clickDelayMaxMs,
    2_000,
);

const clickPositions = [];
const clickSession = new ArcaneAnglerPage({
    page: { on: () => {} },
    config: {},
    reporter: {},
    shouldStop: () => false,
});
const clickTarget = {
    boundingBox: async () => ({ x: 100, y: 200, width: 200, height: 80 }),
    click: async options => clickPositions.push(options.position),
};
const randomValues = [0, 0, 1, 1];

await clickSession.trustedClickRandomPosition(clickTarget, {
    random: () => randomValues.shift(),
});
await clickSession.trustedClickRandomPosition(clickTarget, {
    random: () => randomValues.shift(),
});
assert.deepEqual(clickPositions, [
    { x: 40, y: 16 },
    { x: 160, y: 64 },
]);

let loginResponseBodyRead = false;
const usernameInput = { fill: async () => {} };
const submitButton = { click: async () => {} };
const passwordInput = {
    fill: async () => {},
    locator: () => ({
        locator: selector => selector === 'button[type="submit"]'
            ? submitButton
            : { first: () => usernameInput },
    }),
};
const failedLoginSession = new ArcaneAnglerPage({
    page: {
        on: () => {},
        waitForResponse: async () => ({
            ok: () => false,
            status: () => 503,
            statusText: () => 'Service Unavailable',
            json: async () => {
                loginResponseBodyRead = true;
                return { error: 'temporarily unavailable' };
            },
        }),
    },
    config: {
        username: 'smoke-user',
        password: 'smoke-password',
        navigationTimeoutMs: 100,
    },
    reporter: { update: async () => {} },
    shouldStop: () => false,
    canAutomate: () => true,
});

failedLoginSession.openLoginForm = async () => passwordInput;
await assert.rejects(
    () => failedLoginSession.login(),
    /登录失败：HTTP 503 Service Unavailable/,
);
assert.equal(loginResponseBodyRead, false);

const settings = structuredClone(DEFAULT_SETTINGS.features.fishing);
const counts = {
    '较长停顿': 0,
    '短暂停顿': 0,
    '常规延迟': 0,
};

for (let index = 0; index < 100; index += 1) {
    const delay = selectCastDelay(settings, {
        chance: () => index / 100,
        integer: (min, max) => {
            assert.ok(min <= max);
            return min;
        },
    });

    counts[delay.label] += 1;

    if (delay.label === '较长停顿') {
        assert.equal(delay.durationMs, 20_000);
    } else if (delay.label === '短暂停顿') {
        assert.equal(delay.durationMs, 5_000);
    } else {
        assert.equal(delay.durationMs, 500);
    }
}

assert.deepEqual(counts, {
    '较长停顿': 2,
    '短暂停顿': 8,
    '常规延迟': 90,
});

assert.deepEqual(
    selectCastDelay(settings, {
        chance: () => 0,
        integer: (_min, max) => max,
    }),
    {
        durationMs: 40_000,
        label: '较长停顿',
    },
);

const invalidPauseSettings = structuredClone(DEFAULT_SETTINGS);

invalidPauseSettings.features.fishing.shortPauseChancePercent = 60;
invalidPauseSettings.features.fishing.longPauseChancePercent = 50;
assert.throws(
    () => validateSettings(invalidPauseSettings),
    SettingsValidationError,
);
invalidPauseSettings.features.fishing.longPauseEnabled = false;
assert.equal(
    validateSettings(invalidPauseSettings).features.fishing
        .shortPauseChancePercent,
    60,
);

const disabledQuietSettings = structuredClone(DEFAULT_SETTINGS);

disabledQuietSettings.schedule.quietEnabled = false;
disabledQuietSettings.schedule.quietEndHour =
    disabledQuietSettings.schedule.quietStartHour;
assert.equal(
    validateSettings(disabledQuietSettings).schedule.quietEnabled,
    false,
);
assert.deepEqual(
    selectCastDelay({
        ...settings,
        shortPauseEnabled: false,
        longPauseEnabled: false,
    }, {
        chance: () => 0,
        integer: (_min, max) => max,
    }),
    {
        durationMs: 2_000,
        label: '常规延迟',
    },
);
assert.deepEqual(
    selectCastDelay({
        ...settings,
        longPauseEnabled: false,
        shortPauseChancePercent: 25,
        shortPauseMinMs: 1_200,
        shortPauseMaxMs: 1_800,
    }, {
        chance: () => 0.24,
        integer: (_min, max) => max,
    }),
    {
        durationMs: 1_800,
        label: '短暂停顿',
    },
);
assert.deepEqual(
    selectCastDelay(settings, {
        chance: () => 0.02,
        integer: (_min, max) => max,
    }),
    {
        durationMs: 10_000,
        label: '短暂停顿',
    },
);
assert.deepEqual(
    selectCastDelay(settings, {
        chance: () => 0.10,
        integer: (_min, max) => max,
    }),
    {
        durationMs: 2_000,
        label: '常规延迟',
    },
);
assert.deepEqual(
    selectCastDelay(settings, {
        chance: () => 0,
        integer: (_min, max) => max,
        competitionActive: true,
    }),
    {
        durationMs: 10_000,
        label: '短暂停顿',
    },
);

let currentTime = 1_000;
let gateChecks = 0;
const sleepChunks = [];

await waitForCastDelay(1_200, {
    assertAllowed: () => {
        gateChecks += 1;
    },
    sleepFor: async milliseconds => {
        sleepChunks.push(milliseconds);
        currentTime += milliseconds;
    },
    now: () => currentTime,
});

assert.deepEqual(sleepChunks, [500, 500, 200]);
assert.equal(gateChecks, 4);

currentTime = 1_000;
const cancelledSleepChunks = [];
await waitForCastDelay(20_000, {
    assertAllowed: () => {},
    shouldCancel: () => currentTime >= 1_500,
    sleepFor: async milliseconds => {
        cancelledSleepChunks.push(milliseconds);
        currentTime += milliseconds;
    },
    now: () => currentTime,
});
assert.deepEqual(cancelledSleepChunks, [500]);
assert.equal(NO_FISH_REFRESH_MS, 180_000);

currentTime = 1_000;
let castButtonEnabled = true;
const buttonWaitChunks = [];
await waitForCastButtonToLeaveReadyState({
    isVisible: async () => true,
    isEnabled: async () => castButtonEnabled,
}, {
    sleepFor: async milliseconds => {
        buttonWaitChunks.push(milliseconds);
        currentTime += milliseconds;
        castButtonEnabled = false;
    },
    now: () => currentTime,
});
assert.deepEqual(buttonWaitChunks, [50]);

const verificationRaceSettings = structuredClone(DEFAULT_SETTINGS);
verificationRaceSettings.automationEnabled = true;
verificationRaceSettings.features.fishing.clickDelayMinMs = 0;
verificationRaceSettings.features.fishing.clickDelayMaxMs = 0;
verificationRaceSettings.features.fishing.shortPauseEnabled = false;
verificationRaceSettings.features.fishing.longPauseEnabled = false;
verificationRaceSettings.advanced.pollIntervalMs = 0;
let verificationCheckIndex = 0;
let verificationRaceClicks = 0;
let verificationRaceCasts = 0;
const verificationRaceSession = {
    hasActiveVerification: async () => [false, false, true][
        verificationCheckIndex++
    ] ?? true,
    dismissBlockingOverlays: async () => false,
    isCharacterPickerVisible: async () => false,
    isGameShellVisible: async () => true,
    ensureClassicCastMode: async () => {},
    isFishingPage: async () => true,
    getLastSuccessfulCastAt: () => null,
    getReadyCastButton: async () => ({
        isVisible: async () => true,
        isEnabled: async () => true,
    }),
    getActiveCompetition: () => null,
    assertAutomationAllowed: () => {},
    trustedClickRandomPosition: async () => {
        verificationRaceClicks += 1;
    },
};
const verificationRaceFeature = new FishingFeature({
    session: verificationRaceSession,
    settings: { get: () => verificationRaceSettings },
    reporter: {
        update: async () => {},
        incrementCast: async () => {
            verificationRaceCasts += 1;
        },
    },
});

await verificationRaceFeature.tick(verificationRaceSettings);
await verificationRaceFeature.tick(verificationRaceSettings);
assert.equal(verificationCheckIndex, 3);
assert.equal(verificationRaceClicks, 0);
assert.equal(verificationRaceCasts, 0);

let fishingNow = 1_000;
let lastSuccessfulCastAt = null;
const recoveryActions = [];
const recoveryReporter = {
    state: null,
    update: async function update(state) {
        this.state = state;
    },
};
const recoverySession = {
    dismissBlockingOverlays: async () => false,
    isCharacterPickerVisible: async () => false,
    isGameShellVisible: async () => true,
    ensureClassicCastMode: async () => {},
    isFishingPage: async () => true,
    getLastSuccessfulCastAt: () => lastSuccessfulCastAt,
    getReadyCastButton: async () => null,
    captureScreenshot: async reason => recoveryActions.push(
        `screenshot:${reason}`,
    ),
    bootstrap: async options => recoveryActions.push(
        `bootstrap:${options.reload}`,
    ),
};
const recoverySettings = {
    features: {
        fishing: {
            enabled: true,
            enforceClassicMode: true,
            clickDelayMinMs: 500,
            clickDelayMaxMs: 2_000,
        },
    },
    advanced: {
        pollIntervalMs: 0,
        stallTimeoutMs: 1_000_000,
    },
};
const recoveryFeature = new FishingFeature({
    session: recoverySession,
    settings: { get: () => recoverySettings },
    reporter: recoveryReporter,
    now: () => fishingNow,
});

await recoveryFeature.tick(recoverySettings);
lastSuccessfulCastAt = 120_000;
fishingNow = lastSuccessfulCastAt + NO_FISH_REFRESH_MS - 1;
await recoveryFeature.tick(recoverySettings);
assert.deepEqual(recoveryActions, []);

fishingNow += 1;
await recoveryFeature.tick(recoverySettings);
assert.deepEqual(recoveryActions, [
    'screenshot:no-fish-timeout',
    'bootstrap:true',
]);
assert.equal(recoveryReporter.state.target, '刷新停滞的钓鱼页面');
assert.match(recoveryReporter.state.message, /连续 3 分钟/);

const tempDirectory = await fs.mkdtemp(path.join(
    os.tmpdir(),
    'arcane-fishing-smoke-',
));

try {
    const filePath = path.join(tempDirectory, 'settings.json');
    const legacySettings = structuredClone(DEFAULT_SETTINGS);

    legacySettings.features.fishing.clickDelayMinMs = 250;
    legacySettings.features.fishing.clickDelayMaxMs = 800;
    legacySettings.features.bait.selectedBaitTier = 3;
    delete legacySettings.features.bait.guildTournamentBaitTier;
    delete legacySettings.features.bait.derbyBaitTier;
    delete legacySettings.features.map.prioritizeTournament;
    delete legacySettings.features.worldBoss;
    delete legacySettings.schedule.quietEnabled;
    delete legacySettings.schedule.quietGameAutoFishingEnabled;
    delete legacySettings.schedule.quietGameAutoFishingAutoRenew;
    delete legacySettings.features.fishing.shortPauseEnabled;
    delete legacySettings.features.fishing.shortPauseChancePercent;
    delete legacySettings.features.fishing.shortPauseMinMs;
    delete legacySettings.features.fishing.shortPauseMaxMs;
    delete legacySettings.features.fishing.longPauseEnabled;
    delete legacySettings.features.fishing.longPauseChancePercent;
    delete legacySettings.features.fishing.longPauseMinMs;
    delete legacySettings.features.fishing.longPauseMaxMs;
    await fs.writeFile(filePath, JSON.stringify({
        version: SETTINGS_VERSION,
        configured: true,
        revision: 7,
        settings: legacySettings,
    }));

    const store = new SettingsStore({ filePath });
    const snapshot = await store.initialize();

    assert.equal(snapshot.revision, 7);
    assert.equal(snapshot.settings.features.fishing.clickDelayMinMs, 500);
    assert.equal(snapshot.settings.features.fishing.clickDelayMaxMs, 2_000);
    assert.equal(
        snapshot.settings.features.map.prioritizeTournament,
        true,
    );
    assert.equal(snapshot.settings.features.worldBoss.enabled, true);
    assert.equal(snapshot.settings.schedule.quietEnabled, true);
    assert.equal(
        snapshot.settings.schedule.quietGameAutoFishingEnabled,
        false,
    );
    assert.equal(
        snapshot.settings.schedule.quietGameAutoFishingAutoRenew,
        false,
    );
    assert.equal(
        snapshot.settings.features.fishing.shortPauseChancePercent,
        8,
    );
    assert.equal(
        snapshot.settings.features.fishing.longPauseChancePercent,
        2,
    );
    assert.equal(
        snapshot.settings.features.bait.guildTournamentBaitTier,
        3,
    );
    assert.equal(snapshot.settings.features.bait.derbyBaitTier, 3);

    const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'));

    assert.equal(persisted.revision, 7);
    assert.equal(persisted.settings.features.fishing.clickDelayMinMs, 500);
    assert.equal(persisted.settings.features.fishing.clickDelayMaxMs, 2_000);
    assert.equal(
        persisted.settings.features.map.prioritizeTournament,
        true,
    );
    assert.equal(persisted.settings.features.worldBoss.enabled, true);
    assert.equal(persisted.settings.schedule.quietEnabled, true);
    assert.equal(
        persisted.settings.features.fishing.shortPauseEnabled,
        true,
    );
    assert.equal(
        persisted.settings.features.fishing.longPauseEnabled,
        true,
    );
    assert.equal(
        persisted.settings.features.bait.guildTournamentBaitTier,
        3,
    );
    assert.equal(persisted.settings.features.bait.derbyBaitTier, 3);

    const customSettings = structuredClone(DEFAULT_SETTINGS);

    customSettings.features.fishing.clickDelayMinMs = 750;
    customSettings.features.fishing.clickDelayMaxMs = 1_500;
    await fs.writeFile(filePath, JSON.stringify({
        version: SETTINGS_VERSION,
        configured: true,
        revision: 8,
        settings: customSettings,
    }));

    const customStore = new SettingsStore({ filePath });
    const customSnapshot = await customStore.initialize();

    assert.equal(
        customSnapshot.settings.features.fishing.clickDelayMinMs,
        750,
    );
    assert.equal(
        customSnapshot.settings.features.fishing.clickDelayMaxMs,
        1_500,
    );
} finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
}

console.log(
    'Fishing smoke passed: delay tiers, competition override, no-fish refresh and legacy migration work.',
);
