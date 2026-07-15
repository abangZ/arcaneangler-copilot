import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
    DEFAULT_SETTINGS,
    SETTINGS_VERSION,
} from '../src/core/settings-schema.js';
import { SettingsStore } from '../src/core/settings-store.js';
import {
    selectCastDelay,
    waitForCastDelay,
} from '../src/features/fishing-feature.js';

assert.equal(
    DEFAULT_SETTINGS.features.fishing.clickDelayMinMs,
    500,
);
assert.equal(
    DEFAULT_SETTINGS.features.fishing.clickDelayMaxMs,
    2_000,
);

const settings = {
    clickDelayMinMs: 500,
    clickDelayMaxMs: 2_000,
};
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

const tempDirectory = await fs.mkdtemp(path.join(
    os.tmpdir(),
    'arcane-fishing-smoke-',
));

try {
    const filePath = path.join(tempDirectory, 'settings.json');
    const legacySettings = structuredClone(DEFAULT_SETTINGS);

    legacySettings.features.fishing.clickDelayMinMs = 250;
    legacySettings.features.fishing.clickDelayMaxMs = 800;
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

    const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'));

    assert.equal(persisted.revision, 7);
    assert.equal(persisted.settings.features.fishing.clickDelayMinMs, 500);
    assert.equal(persisted.settings.features.fishing.clickDelayMaxMs, 2_000);

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
    'Fishing smoke passed: delay tiers, defaults and legacy migration work.',
);
