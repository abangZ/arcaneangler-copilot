import assert from 'node:assert/strict';

import { chromium } from 'playwright';

import { createBrowserProfile } from '../src/core/browser-profile.js';
import {
    chooseBestBiome,
    MapFeature,
} from '../src/features/map-feature.js';
import { ArcaneAnglerPage } from '../src/site/arcane-angler-page.js';

const exampleSelection = chooseBestBiome([1, 2], {
    1: { weather: 'heatwave', xpBonus: 30 },
    2: { weather: 'foggy', xpBonus: 20 },
});

assert.deepEqual(exampleSelection, {
    biomeId: 2,
    weather: 'foggy',
    weatherXpBonus: 20,
    biomeXpWeight: 10,
    totalXpScore: 30,
});

const tieSelection = chooseBestBiome([2, 3], {
    2: { weather: 'foggy', xpBonus: 20 },
    3: { weather: 'windy', xpBonus: 10 },
});

assert.equal(tieSelection.biomeId, 3);

const feature = new MapFeature({
    session: {},
    reporter: {},
});
const eventTarget = feature.selectTarget(
    { mode: 'auto', prioritizeTournament: true },
    {
        activeDerby: {
            id: 9,
            number: 42,
            biomeId: 3,
            isRegistered: true,
        },
        unlockedBiomes: [1, 2, 3],
        weatherByBiome: {
            1: { weather: 'storm', xpBonus: 50 },
            2: { weather: 'clear', xpBonus: 0 },
            3: { weather: 'clear', xpBonus: 0 },
        },
    },
);

assert.equal(eventTarget.biomeId, 3);
assert.match(eventTarget.reason, /Derby #42/);
const tournamentTarget = feature.selectTarget(
    { mode: 'auto', prioritizeTournament: true },
    {
        activeTournament: {
            id: 226,
            number: 226,
            biomeId: 2,
            isRegistered: true,
        },
        activeDerby: {
            id: 9,
            number: 42,
            biomeId: 3,
            isRegistered: true,
        },
        unlockedBiomes: [1, 2, 3],
        weatherByBiome: {},
    },
);

assert.equal(tournamentTarget.biomeId, 2);
assert.match(tournamentTarget.reason, /公会正在参与锦标赛 #226/);

const disabledTournamentTarget = feature.selectTarget(
    { mode: 'auto', prioritizeTournament: false },
    {
        activeTournament: {
            id: 226,
            number: 226,
            biomeId: 2,
            isRegistered: true,
        },
        activeDerby: {
            id: 9,
            number: 42,
            biomeId: 3,
            isRegistered: true,
        },
        unlockedBiomes: [1, 2, 3],
        weatherByBiome: {},
    },
);

assert.equal(disabledTournamentTarget.biomeId, 3);
assert.match(disabledTournamentTarget.reason, /Derby #42/);

const tournamentOnlyTarget = feature.selectTarget(
    { mode: 'off', prioritizeTournament: true },
    {
        activeTournament: {
            id: 226,
            number: 226,
            biomeId: 2,
            isRegistered: true,
        },
        unlockedBiomes: [1, 2, 3],
        weatherByBiome: {},
    },
);

assert.equal(tournamentOnlyTarget.biomeId, 2);
assert.equal(feature.isEnabled({
    features: {
        map: { mode: 'off', prioritizeTournament: true },
    },
}), true);
assert.equal(feature.isEnabled({
    features: {
        map: { mode: 'off', prioritizeTournament: false },
    },
}), false);

const profile = createBrowserProfile();
const browser = await chromium.launch({
    headless: true,
    channel: profile.channel,
    args: profile.args,
});

try {
    const page = await browser.newPage({
        userAgent: profile.userAgent,
        viewport: {
            width: 1280,
            height: 900,
        },
    });

    await page.route('https://example.test/api/derby/7/register', route =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true }),
        }),
    );
    await page.setContent(`
        <div class="flex-1 overflow-y-auto py-3" id="sidebar"></div>
        <main id="content"></main>
        <script>
            const sidebar = document.getElementById('sidebar');
            const content = document.getElementById('content');
            const state = {
                player: {
                    userId: 101,
                    level: 27,
                    xp: 450,
                    xpToNext: 900,
                    currentBiome: 1,
                    equippedBait: 'bait-1',
                    baitInventory: { 'bait-1': 73 },
                    unlockedBiomes: [1, 2, 3, 12],
                    is_ironman: false,
                    boat: null,
                },
                weather: {
                    1: { weather: 'storm', xpBonus: 50 },
                    2: { weather: 'foggy', xpBonus: 20 },
                    3: { weather: 'clear', xpBonus: 0 },
                    12: { weather: 'rain', xpBonus: 5 },
                },
                derbies: {
                    active: {
                        id: 8,
                        derby_number: 41,
                        derby_type: 'global',
                        biome_id: 3,
                        is_registered: true,
                        start_time: '2026-07-15T20:00:00.000Z',
                        end_time: '2026-07-16T20:00:00.000Z',
                        participant_count: 118,
                    },
                    upcoming: [{
                        id: 7,
                        derby_number: 42,
                        biome_id: 2,
                        derby_type: 'normal',
                        is_registered: false,
                        start_time: '2026-07-17T20:00:00.000Z',
                        end_time: '2026-07-18T20:00:00.000Z',
                        participant_count: 23,
                    }],
                },
                tournaments: {
                    active: {
                        id: 226,
                        tournament_number: 226,
                        tournament_type: 'normal',
                        biome_id: 12,
                        start_time: '2026-07-16T01:00:00.000Z',
                        end_time: '2026-07-16T02:30:00.000Z',
                        participant_count: 8,
                    },
                    upcoming: [{
                        id: 227,
                        tournament_number: 227,
                        tournament_type: 'normal',
                        biome_id: 2,
                        start_time: '2026-07-17T01:00:00.000Z',
                        end_time: '2026-07-17T02:30:00.000Z',
                        participant_count: 5,
                    }],
                },
                events: [],
            };

            window.BIOMES = Object.fromEntries(
                Array.from({ length: 20 }, (_, index) => {
                    const id = index + 1;
                    return [id, { name: id === 12 ? 'Biome Twelve' : 'Map ' + id }];
                }),
            );
            window.BAITS = [{ id: 'bait-1', name: 'River Grub', price: 12 }];
            window.ApiService = {
                async getPlayerData() {
                    return structuredClone(state.player);
                },
                async getAllBiomeWeather() {
                    return { weather: structuredClone(state.weather) };
                },
                async getCurrentDerbies() {
                    return structuredClone(state.derbies);
                },
                async getCurrentTournaments() {
                    return structuredClone(state.tournaments);
                },
                async getMyGuild() {
                    return { guild: { guild_id: 501 } };
                },
                async getTournamentStandings() {
                    return {
                        standings: [
                            {
                                guild_id: 400,
                                total_points: 20_000,
                                fish_caught: 26,
                            },
                            {
                                guild_id: 501,
                                total_points: 15_000,
                                fish_caught: 19,
                            },
                        ],
                    };
                },
                async getDerbyStandings() {
                    return {
                        standings: [
                            { user_id: 88, total_points: 14_200 },
                            { user_id: 101, total_points: 12_340 },
                        ],
                    };
                },
            };
            window.mapSmoke = state;

            const buttons = Array.from({ length: 21 }, (_, index) => {
                const button = document.createElement('button');
                button.textContent = 'Page ' + index;
                sidebar.appendChild(button);
                return button;
            });

            function setActive(index) {
                buttons.forEach(button => button.className = '');
                buttons[index].className = 'border-l-4';
            }

            function renderFishing() {
                setActive(0);
                content.innerHTML = '<div>[B' + state.player.currentBiome + '] Fishing</div>';
            }

            function renderEvents() {
                setActive(12);
                content.innerHTML = '';
                const registerAll = document.createElement('button');
                registerAll.title = "Register for all derbies you're eligible for";
                registerAll.textContent = 'Register All';
                registerAll.addEventListener('click', async event => {
                    state.events.push({ name: 'register-all', trusted: event.isTrusted });
                    registerAll.disabled = true;
                    await fetch('https://example.test/api/derby/7/register', {
                        method: 'POST',
                    });
                    state.derbies.upcoming[0].is_registered = true;
                    registerAll.disabled = false;
                });
                content.appendChild(registerAll);
            }

            function renderBiomePage(start) {
                setActive(1);
                content.innerHTML = '<div class="max-w-4xl mx-auto"></div>';
                const root = content.firstElementChild;
                const pages = document.createElement('div');
                const firstPage = document.createElement('button');
                const secondPage = document.createElement('button');
                firstPage.textContent = '1-10';
                secondPage.textContent = '11-20';
                firstPage.addEventListener('click', event => {
                    state.events.push({ name: 'page-1', trusted: event.isTrusted });
                    renderBiomePage(1);
                });
                secondPage.addEventListener('click', event => {
                    state.events.push({ name: 'page-2', trusted: event.isTrusted });
                    renderBiomePage(11);
                });
                pages.append(firstPage, secondPage);
                root.appendChild(pages);

                const list = document.createElement('div');
                list.className = 'space-y-4';
                for (let biomeId = start; biomeId < start + 10; biomeId += 1) {
                    const card = document.createElement('div');
                    card.className = 'p-4 sm:p-5 rounded-lg border-2';
                    card.innerHTML = '<h3>' + window.BIOMES[biomeId].name +
                        '</h3><div class="text-sm">Biome ' + biomeId + '</div>';
                    card.addEventListener('click', event => {
                        state.events.push({
                            name: 'biome-' + biomeId,
                            trusted: event.isTrusted,
                        });
                        state.player.currentBiome = biomeId;
                        renderFishing();
                    });
                    list.appendChild(card);
                }
                root.appendChild(list);
            }

            buttons[0].addEventListener('click', renderFishing);
            buttons[1].addEventListener('click', () => renderBiomePage(1));
            buttons[12].addEventListener('click', renderEvents);
            renderFishing();
        </script>
    `);

    const reporter = {
        async update() {},
    };
    const session = new ArcaneAnglerPage({
        page,
        config: {
            navigationTimeoutMs: 2_000,
        },
        reporter,
        shouldStop: () => false,
        canAutomate: () => true,
    });
    const initialState = await session.getMapAutomationState();
    const dashboard = await session.getDashboardSnapshot();

    assert.equal(initialState.eligibleDerbyCount, 1);
    assert.equal(initialState.activeDerby.isRegistered, true);
    assert.equal(initialState.activeTournament.isRegistered, true);
    assert.equal(initialState.activeTournament.biomeId, 12);
    assert.equal(dashboard.level, 27);
    assert.equal(dashboard.xp, 450);
    assert.equal(dashboard.xpToNext, 900);
    assert.deepEqual(dashboard.biome, {
        id: '1',
        name: 'Map 1',
        weather: 'storm',
        xpBonus: 50,
    });
    assert.deepEqual(dashboard.bait, {
        id: 'bait-1',
        name: 'River Grub',
        price: 12,
        quantity: 73,
    });
    assert.deepEqual(dashboard.tournament, {
        status: 'active',
        id: '226',
        number: 226,
        type: 'normal',
        biome: {
            id: '12',
            name: 'Biome Twelve',
        },
        startAt: '2026-07-16T01:00:00.000Z',
        endAt: '2026-07-16T02:30:00.000Z',
        participantCount: 8,
        standing: {
            rank: 2,
            points: 15_000,
            fishCaught: 19,
        },
    });
    await page.evaluate(() => {
        const tournament = window.mapSmoke.tournaments.active;

        tournament.start_time = new Date(Date.now() - 60_000).toISOString();
        tournament.end_time = new Date(Date.now() + 60_000).toISOString();
        window.mapSmoke.tournaments.active = null;
        window.mapSmoke.tournaments.upcoming.unshift(tournament);
    });
    const delayedTournamentState = await session.getMapAutomationState();
    const delayedTournamentDashboard = await session.getDashboardSnapshot();
    const delayedTournamentTarget = feature.selectTarget(
        { mode: 'auto', prioritizeTournament: true },
        delayedTournamentState,
    );

    assert.equal(delayedTournamentState.activeTournament.id, 226);
    assert.equal(delayedTournamentState.activeTournament.isRegistered, true);
    assert.equal(delayedTournamentDashboard.tournament.status, 'active');
    assert.deepEqual(delayedTournamentDashboard.tournament.standing, {
        rank: 2,
        points: 15_000,
        fishCaught: 19,
    });
    assert.equal(delayedTournamentTarget.biomeId, 12);
    assert.equal(
        dashboard.competitions.filter(item =>
            item.type === 'guild-tournament',
        ).length,
        2,
    );
    const knownBait = session.getKnownBaitQuantity('bait-1');

    assert.equal(knownBait.baitId, 'bait-1');
    assert.equal(knownBait.quantity, 73);
    assert.equal(knownBait.equipped, true);
    assert.ok(Date.parse(knownBait.observedAt));
    assert.deepEqual(dashboard.derby, {
        status: 'active',
        id: '8',
        number: 41,
        type: 'global',
        biome: {
            id: '3',
            name: 'Map 3',
        },
        startAt: '2026-07-15T20:00:00.000Z',
        endAt: '2026-07-16T20:00:00.000Z',
        participantCount: 118,
        standing: {
            rank: 2,
            points: 12_340,
        },
    });
    assert.ok(Date.parse(dashboard.observedAt));

    await page.evaluate(() => {
        window.mapSmoke.derbies.active.is_registered = false;
        window.mapSmoke.derbies.upcoming[0].is_registered = true;
    });
    const upcomingDashboard = await session.getDashboardSnapshot();

    assert.deepEqual(upcomingDashboard.derby, {
        status: 'upcoming',
        id: '7',
        number: 42,
        type: 'normal',
        biome: {
            id: '2',
            name: 'Map 2',
        },
        startAt: '2026-07-17T20:00:00.000Z',
        endAt: '2026-07-18T20:00:00.000Z',
        participantCount: 23,
        standing: null,
    });

    await page.evaluate(() => {
        window.mapSmoke.derbies.active.is_registered = true;
        window.mapSmoke.derbies.upcoming[0].is_registered = false;
    });

    const registration = await session.registerEligibleDerbiesThroughUi(1);

    assert.deepEqual(registration, {
        registeredCount: 1,
        remainingCount: 0,
    });

    await session.changeBiomeThroughUi(12, 'Biome Twelve');

    const result = await page.evaluate(() => ({
        currentBiome: window.mapSmoke.player.currentBiome,
        events: window.mapSmoke.events,
    }));

    assert.equal(result.currentBiome, 12);
    assert.deepEqual(
        result.events.map(event => event.name),
        ['register-all', 'page-2', 'biome-12'],
    );
    assert.ok(result.events.every(event => event.trusted));

    console.log(
        'Map smoke passed: guild tournament priority, derby registration, schedules and biome clicks work.',
    );
} finally {
    await browser.close();
}
