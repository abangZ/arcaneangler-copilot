import assert from 'node:assert/strict';

import { chromium } from 'playwright';

import { createBrowserProfile } from '../src/core/browser-profile.js';
import { WorldBossFeature } from '../src/features/world-boss-feature.js';
import { ArcaneAnglerPage } from '../src/site/arcane-angler-page.js';

const profile = createBrowserProfile();
const browser = await chromium.launch({
    headless: true,
    channel: profile.channel,
    args: profile.args,
});

try {
    const page = await browser.newPage({
        userAgent: profile.userAgent,
        viewport: { width: 1280, height: 900 },
    });

    await page.route('https://example.test/api/anomalies/attack', async route => {
        const body = route.request().postDataJSON();
        const result = await page.evaluate(statUsed => {
            const state = window.worldBossSmoke;

            state.attacks.push(statUsed);
            state.response.event.currentHp -= 1_500;
            state.response.event.hpPercentage = 65;
            state.response.playerParticipation.damageDealt += 1_500;
            state.response.playerParticipation.attacksMade += 1;

            return structuredClone(state.response);
        }, body.statUsed);

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                attack: { finalDamage: 1_500 },
                anomaly: {
                    name: result.event.anomaly.name,
                    currentHp: result.event.currentHp,
                    hpPercentage: result.event.hpPercentage,
                    defeated: false,
                },
            }),
        });
    });

    await page.setContent(`
        <div class="flex-1 overflow-y-auto py-3" id="sidebar"></div>
        <main id="content"></main>
        <script>
            const sidebar = document.getElementById('sidebar');
            const content = document.getElementById('content');
            const buttons = Array.from({ length: 21 }, (_, index) => {
                const button = document.createElement('button');
                const image = document.createElement('img');
                image.alt = index === 0 ? 'Fishing' :
                    index === 15 ? 'Anomalies' : 'Page ' + index;
                button.append(image);
                sidebar.append(button);
                return button;
            });
            const response = {
                active: true,
                event: {
                    id: 'event-9',
                    startTime: '2026-07-16T03:00:00.000Z',
                    endTime: '2026-07-16T04:00:00.000Z',
                    currentHp: 10_000,
                    maxHp: 30_000,
                    hpPercentage: 70,
                    activeParticipants: 7,
                    totalParticipants: 12,
                    totalDamage: 20_000,
                    anomaly: {
                        id: 4,
                        name: 'Abyssal Maw',
                        primaryWeakness: 'intelligence',
                        secondaryWeakness: 'luck',
                        resistantStat: 'strength',
                    },
                },
                playerParticipation: {
                    damageDealt: 3_000,
                    attacksMade: 2,
                },
                leaderboard: [
                    { user_id: 88, damage_dealt: 9_000, attacks_made: 4 },
                    { user_id: 101, damage_dealt: 3_000, attacks_made: 2 },
                ],
            };

            window.BIOMES = { 1: { name: 'Map 1' } };
            window.BAITS = [{ id: 'bait-1', name: 'River Grub', price: 12 }];
            window.worldBossSmoke = {
                response,
                attacks: [],
                trusted: [],
                fallbackRequests: [],
            };
            window.ApiService = {
                async getPlayerData() {
                    return {
                        userId: 101,
                        level: 27,
                        xp: 450,
                        xpToNext: 900,
                        currentBiome: 1,
                        equippedBait: 'bait-1',
                        baitInventory: { 'bait-1': 73 },
                    };
                },
                async getAllBiomeWeather() { return {}; },
                async getCurrentDerbies() { return {}; },
                async getCurrentTournaments() { return {}; },
                async getMyGuild() { return {}; },
                async getCurrentAnomaly() {
                    return structuredClone(window.worldBossSmoke.response);
                },
            };

            function setActive(index) {
                buttons.forEach(button => button.className = '');
                buttons[index].className = 'border-l-4';
            }

            function renderFishing() {
                setActive(0);
                content.textContent = 'Fishing';
            }

            function renderAnomalies() {
                setActive(15);
                content.innerHTML = '<div class="grid grid-cols-2 md:grid-cols-2"></div>';
                const grid = content.firstElementChild;
                const attacks = [
                    ['strength', 'Harpoon Strike'],
                    ['intelligence', 'Arcane Bolt'],
                    ['luck', 'Lucky Strike'],
                    ['stamina', 'Tidal Surge'],
                ];
                for (const [stat, label] of attacks) {
                    const button = document.createElement('button');
                    button.textContent = label;
                    button.addEventListener('click', async event => {
                        window.worldBossSmoke.trusted.push(event.isTrusted);
                        button.disabled = true;
                        await fetch('https://example.test/api/anomalies/attack', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ statUsed: stat }),
                        });
                    });
                    grid.append(button);
                }
            }

            buttons[0].addEventListener('click', renderFishing);
            buttons[15].addEventListener('click', renderAnomalies);
            renderFishing();
        </script>
    `);

    const updates = [];
    const session = new ArcaneAnglerPage({
        page,
        config: { navigationTimeoutMs: 2_000 },
        reporter: { async update(update) { updates.push(update); } },
        shouldStop: () => false,
        canAutomate: () => true,
    });
    const dashboard = await session.getDashboardSnapshot();

    assert.deepEqual(dashboard.worldBoss, {
        status: 'active',
        id: 'event-9',
        bossId: '4',
        name: 'Abyssal Maw',
        startAt: '2026-07-16T03:00:00.000Z',
        endAt: '2026-07-16T04:00:00.000Z',
        hp: { current: 10_000, max: 30_000, percentage: 70 },
        weakness: {
            primary: 'intelligence',
            secondary: 'luck',
            resistant: 'strength',
        },
        participantCount: 12,
        activeParticipantCount: 7,
        totalDamage: 20_000,
        standing: { rank: 2, damage: 3_000, attacks: 2 },
    });
    assert.equal(
        dashboard.competitions.find(item => item.type === 'world-boss').id,
        'event-9',
    );

    const states = [];
    const feature = new WorldBossFeature({
        session,
        reporter: { async update(update) { updates.push(update); } },
        onState: async state => states.push(state),
    });

    assert.equal(feature.isEnabled({
        features: { worldBoss: { enabled: true } },
    }), true);
    assert.equal(await feature.tick(), true);
    const result = await page.evaluate(() => ({
        attacks: window.worldBossSmoke.attacks,
        trusted: window.worldBossSmoke.trusted,
        currentHp: window.worldBossSmoke.response.event.currentHp,
    }));

    assert.deepEqual(result.attacks, ['intelligence']);
    assert.deepEqual(result.trusted, [true]);
    assert.equal(result.currentHp, 8_500);
    assert.equal(states.at(-1).standing.damage, 4_500);
    assert.equal(states.at(-1).standing.attacks, 3);

    await page.evaluate(() => {
        window.worldBossSmoke.response = {
            active: false,
            nextSpawnTime: '2026-07-17T01:23:24.000Z',
        };
    });
    const upcoming = await session.getWorldBossAutomationState();

    assert.equal(upcoming.status, 'upcoming');
    assert.equal(upcoming.startAt, '2026-07-17T01:23:24.000Z');
    assert.equal(
        session.getCompetitionSchedule()
            .find(item => item.type === 'world-boss').startAt,
        '2026-07-17T01:23:24.000Z',
    );

    await page.evaluate(() => {
        window.worldBossSmoke.response = {
            active: false,
            nextSpawnTime: '2026-07-18T02:34:56.000Z',
        };
        window.ApiService.getCurrentAnomaly = undefined;
        window.ApiService.request = async (pathname, options) => {
            window.worldBossSmoke.fallbackRequests.push({
                pathname,
                method: options?.method,
            });
            return structuredClone(window.worldBossSmoke.response);
        };
    });

    const fallbackDashboard = await session.getDashboardSnapshot();
    const fallbackAutomation = await session.getWorldBossAutomationState();
    const fallbackRequests = await page.evaluate(() =>
        window.worldBossSmoke.fallbackRequests,
    );

    assert.equal(
        fallbackDashboard.worldBoss.startAt,
        '2026-07-18T02:34:56.000Z',
    );
    assert.equal(
        fallbackAutomation.startAt,
        '2026-07-18T02:34:56.000Z',
    );
    assert.deepEqual(fallbackRequests, [
        { pathname: '/anomalies/current', method: 'GET' },
        { pathname: '/anomalies/current', method: 'GET' },
    ]);

    console.log(
        'World boss smoke passed: schedule, dashboard, API fallback and trusted weak-point attacks work.',
    );
} finally {
    await browser.close();
}
