import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
    StatsStore,
    summarizeCastResult,
} from '../src/core/stats-store.js';
import { ArcaneAnglerPage } from '../src/site/arcane-angler-page.js';

const tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'arcane-stats-smoke-'),
);
const filePath = path.join(tempDirectory, 'stats.json');
let currentTime = new Date(2026, 6, 15, 23, 50, 0, 0);

try {
    const store = new StatsStore({
        filePath,
        now: () => new Date(currentTime),
    });
    let notificationCount = 0;

    store.subscribe(() => {
        notificationCount += 1;
    });
    await store.initialize();

    let observedCast = null;
    const session = new ArcaneAnglerPage({
        page: { on: () => {} },
        config: {},
        reporter: { log: async () => {} },
        shouldStop: () => false,
        onCastResult: async result => {
            observedCast = result;
        },
    });
    await session.collectCastResponse({
        request: () => ({ method: () => 'POST' }),
        url: () => 'https://arcaneangler.com/api/game/cast',
        ok: () => true,
        json: async () => ({
            success: true,
            result: { goldGained: 5 },
        }),
    });
    assert.deepEqual(observedCast, { goldGained: 5 });

    assert.deepEqual(summarizeCastResult({
        count: 2,
        rarity: 'Uncommon',
        fish: { name: 'Moonfin' },
        goldGained: 97,
        xpGained: 1_241,
        relicsGained: 0,
        currentBiome: 2,
        equippedBait: 'bait-2',
    }), {
        casts: 1,
        fish: 2,
        gold: 97,
        xp: 1_241,
        relics: 0,
        treasureChests: 0,
        gears: 0,
        category: 'Uncommon',
        earnedCount: 2,
        context: { biomeId: '2', baitId: 'bait-2' },
    });

    await store.recordCast({
        count: 2,
        rarity: 'Uncommon',
        fish: { name: 'Moonfin' },
        goldGained: 97,
        xpGained: 1_241,
        currentBiome: 2,
        equippedBait: 'bait-2',
    });
    await store.recordCast({
        rarity: 'Treasure Chest',
        treasureChest: true,
        treasureChestsFound: 1,
        goldGained: 12,
    });
    await store.recordCast({
        rarity: 'Gears',
        gear: { id: 'rod-1' },
        inventoryFull: false,
    });

    let snapshot = store.get();

    assert.equal(snapshot.today.casts, 3);
    assert.equal(snapshot.today.fish, 2);
    assert.equal(snapshot.today.gold, 109);
    assert.equal(snapshot.today.xp, 1_241);
    assert.equal(snapshot.today.treasureChests, 1);
    assert.equal(snapshot.today.gears, 1);
    assert.deepEqual(snapshot.today.rarityCounts, {
        Uncommon: 2,
        'Treasure Chest': 1,
        Gears: 1,
    });
    assert.equal(notificationCount, 3);
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);

    currentTime = new Date(2026, 6, 16, 0, 10, 0, 0);
    await store.recordCast({
        rarity: 'Relic',
        relicsGained: 3,
    });
    snapshot = store.get();

    assert.equal(snapshot.todayKey, '2026-07-16');
    assert.equal(snapshot.today.casts, 1);
    assert.equal(snapshot.today.relics, 3);
    assert.equal(snapshot.total.casts, 4);
    assert.equal(snapshot.recentDays.length, 2);

    const reloaded = new StatsStore({
        filePath,
        now: () => new Date(currentTime),
    });
    await reloaded.initialize();

    assert.equal(reloaded.get().today.relics, 3);
    assert.equal(reloaded.get().total.gold, 109);
    assert.deepEqual(reloaded.get().lastContext, {
        biomeId: '2',
        baitId: 'bait-2',
    });
} finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
}

console.log(
    'Stats smoke passed: cast deltas, daily totals, persistence and context work.',
);
