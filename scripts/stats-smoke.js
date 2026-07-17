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
        page: {
            on: () => {},
            evaluate: async () => ({
                biomeId: '2',
                biomeName: 'Moonlit Marsh',
                baitId: 'bait-2',
                baitName: 'Glow Worm',
                baitPrice: 10,
            }),
        },
        config: {},
        reporter: { log: async () => {} },
        shouldStop: () => false,
        onCastResult: async result => {
            observedCast = result;
        },
    });
    assert.equal(session.getLastSuccessfulCastAt(), null);
    const punishmentExpiresAt = '2099-07-15T16:30:00.000Z';

    await session.collectCastResponse({
        request: () => ({ method: () => 'POST' }),
        url: () => 'https://arcaneangler.com/api/game/cast',
        ok: () => true,
        json: async () => ({
            success: true,
            result: {
                goldGained: 5,
                currentBiome: 2,
                equippedBait: 'bait-2',
                baitQuantity: 87,
                isPunished: true,
                punishmentExpiresAt,
            },
        }),
    });
    assert.deepEqual(observedCast, {
        goldGained: 5,
        currentBiome: 2,
        equippedBait: 'bait-2',
        baitQuantity: 87,
        isPunished: true,
        punishmentExpiresAt,
    });
    assert.ok(Number.isFinite(session.getLastSuccessfulCastAt()));
    assert.equal(
        session.getActivePunishmentExpiresAt(),
        punishmentExpiresAt,
    );
    session.rememberPunishment({ isPunished: false });
    assert.equal(session.getActivePunishmentExpiresAt(), null);
    const knownBait = session.getKnownBaitQuantity('bait-2');

    assert.equal(knownBait.quantity, 87);
    assert.equal(knownBait.equipped, true);
    assert.ok(Date.parse(knownBait.observedAt));

    const contextSession = new ArcaneAnglerPage({
        page: {
            on: () => {},
            evaluate: async (_callback, ids) => ({
                biomeId: ids.currentBiome,
                biomeName: 'Moonlit Marsh',
                baitId: ids.equippedBait,
                baitName: 'Glow Worm',
                baitPrice: 10,
            }),
        },
        config: {},
        reporter: { log: async () => {} },
        shouldStop: () => false,
    });
    assert.deepEqual(await contextSession.getCastStatsContext({
        currentBiome: 2,
        equippedBait: 'bait-2',
    }), {
        biomeId: '2',
        biomeName: 'Moonlit Marsh',
        baitId: 'bait-2',
        baitName: 'Glow Worm',
        baitPrice: 10,
    });

    assert.deepEqual(summarizeCastResult({
        count: 2,
        rarity: 'Uncommon',
        fish: { id: 'moonfin', name: 'Moonfin', baseGold: 40 },
        goldGained: 97,
        xpGained: 1_241,
        relicsGained: 0,
        currentBiome: 2,
        equippedBait: 'bait-2',
    }, {
        biomeId: '2',
        biomeName: 'Moonlit Marsh',
        baitId: 'bait-2',
        baitName: 'Glow Worm',
        baitPrice: 10,
    }), {
        casts: 1,
        fish: 2,
        gold: 97,
        fishGold: 80,
        baitCost: 10,
        unknownBaitCostCasts: 0,
        xp: 1_241,
        relics: 0,
        treasureChests: 0,
        gears: 0,
        category: 'Uncommon',
        earnedCount: 2,
        context: {
            biomeId: '2',
            biomeName: 'Moonlit Marsh',
            baitId: 'bait-2',
            baitName: 'Glow Worm',
            baitPrice: 10,
        },
        lastFish: {
            name: 'Moonfin',
            fishId: 'moonfin',
            rarity: 'Uncommon',
            count: 2,
            gold: 97,
            xp: 1_241,
            isPunished: false,
            punishmentExpiresAt: null,
        },
    });

    assert.deepEqual(summarizeCastResult({
        count: 1,
        rarity: 'Common',
        fish: { id: 'sprat', name: 'Static Fin Sprat', baseGold: 12 },
        goldGained: 0,
        xpGained: 0,
        isPunished: true,
        punishmentExpiresAt,
    }).lastFish, {
        name: 'Static Fin Sprat',
        fishId: 'sprat',
        rarity: 'Common',
        count: 1,
        gold: 0,
        xp: 0,
        isPunished: true,
        punishmentExpiresAt,
    });

    await store.recordCast({
        count: 2,
        rarity: 'Uncommon',
        fish: { id: 'moonfin', name: 'Moonfin', baseGold: 40 },
        goldGained: 97,
        xpGained: 1_241,
        currentBiome: 2,
        equippedBait: 'bait-2',
    }, {
        biomeId: '2',
        biomeName: 'Moonlit Marsh',
        baitId: 'bait-2',
        baitName: 'Glow Worm',
        baitPrice: 10,
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
    assert.equal(snapshot.today.fishGold, 80);
    assert.equal(snapshot.today.baitCost, 10);
    assert.equal(snapshot.today.netGold, 179);
    assert.equal(snapshot.today.xp, 1_241);
    assert.equal(snapshot.today.treasureChests, 1);
    assert.equal(snapshot.today.gears, 1);
    assert.deepEqual(snapshot.today.rarityCounts, {
        Uncommon: 2,
        'Treasure Chest': 1,
        Gears: 1,
    });
    assert.equal(snapshot.breakdowns.length, 1);
    assert.equal(snapshot.breakdowns[0].biomeName, 'Moonlit Marsh');
    assert.equal(snapshot.breakdowns[0].baitName, 'Glow Worm');
    assert.equal(snapshot.baitSummaries[0].casts, 1);
    assert.equal(snapshot.todayBaitSummaries[0].casts, 1);
    assert.equal(snapshot.biomeSummaries[0].fish, 2);
    assert.equal(snapshot.currentBait.today.gold, 97);
    assert.equal(snapshot.currentBait.today.netGold, 167);
    assert.equal(snapshot.currentCombination.total.casts, 1);
    assert.deepEqual(snapshot.lastFish, {
        name: 'Moonfin',
        fishId: 'moonfin',
        rarity: 'Uncommon',
        count: 2,
        gold: 97,
        xp: 1_241,
        isPunished: false,
        punishmentExpiresAt: null,
        caughtAt: currentTime.toISOString(),
        context: {
            biomeId: '2',
            biomeName: 'Moonlit Marsh',
            baitId: 'bait-2',
            baitName: 'Glow Worm',
            baitPrice: 10,
        },
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
        biomeName: 'Moonlit Marsh',
        baitId: 'bait-2',
        baitName: 'Glow Worm',
        baitPrice: 10,
    });
    assert.equal(reloaded.get().breakdowns[0].casts, 1);
    assert.equal(reloaded.get().lastFish.name, 'Moonfin');

    const ratePath = path.join(tempDirectory, 'rate-stats.json');
    let rateTime = new Date('2026-07-16T01:00:00.000Z');
    const rateStore = new StatsStore({
        filePath: ratePath,
        now: () => new Date(rateTime),
    });

    await rateStore.initialize();
    await rateStore.recordCast({ xpGained: 100 });
    rateTime = new Date('2026-07-16T01:10:00.000Z');
    await rateStore.recordCast({ xpGained: 200 });
    rateTime = new Date('2026-07-16T01:20:00.000Z');
    await rateStore.recordCast({ xpGained: 300 });
    assert.deepEqual(rateStore.get().experienceRate, {
        startedAt: '2026-07-16T01:00:00.000Z',
        updatedAt: '2026-07-16T01:20:00.000Z',
        sampleCount: 3,
        elapsedMs: 20 * 60_000,
        xp: 500,
        xpPerHour: 1_500,
    });
    rateTime = new Date('2026-07-16T03:00:00.000Z');
    await rateStore.recordCast({ xpGained: 400 });
    assert.equal(rateStore.get().experienceRate, null);
    rateTime = new Date('2026-07-16T03:10:00.000Z');
    await rateStore.recordCast({ xpGained: 500 });
    assert.equal(rateStore.get().experienceRate.xpPerHour, 3_000);

    const reloadedRateStore = new StatsStore({
        filePath: ratePath,
        now: () => new Date(rateTime),
    });
    await reloadedRateStore.initialize();
    assert.equal(reloadedRateStore.get().experienceRate.xpPerHour, 3_000);

    const legacyPath = path.join(tempDirectory, 'legacy-stats.json');
    await fs.writeFile(legacyPath, JSON.stringify({
        version: 1,
        total: {
            startedAt: '2026-07-14T00:00:00.000Z',
            updatedAt: '2026-07-14T01:00:00.000Z',
            casts: 3,
            fish: 2,
            gold: 42,
            xp: 100,
            rarityCounts: { Common: 2 },
        },
        days: {
            '2026-07-14': {
                startedAt: '2026-07-14T00:00:00.000Z',
                updatedAt: '2026-07-14T01:00:00.000Z',
                casts: 3,
                fish: 2,
                gold: 42,
                xp: 100,
                rarityCounts: { Common: 2 },
            },
        },
        lastContext: { biomeId: '1', baitId: 'bait-1' },
    }));
    const migrated = new StatsStore({
        filePath: legacyPath,
        now: () => new Date(2026, 6, 16, 0, 10, 0, 0),
    });
    await migrated.initialize();
    const migratedSnapshot = migrated.get();

    assert.equal(migratedSnapshot.version, 2);
    assert.equal(migratedSnapshot.total.gold, 42);
    assert.equal(migratedSnapshot.total.baitCost, 0);
    assert.equal(migratedSnapshot.breakdowns.length, 0);
    assert.equal(JSON.parse(await fs.readFile(legacyPath, 'utf8')).version, 2);
} finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
}

console.log(
    'Stats smoke passed: cast deltas, rolling XP rate, daily totals, persistence and context work.',
);
