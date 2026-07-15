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
    { mode: 'auto' },
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
                    currentBiome: 1,
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
                        biome_id: 3,
                        is_registered: true,
                    },
                    upcoming: [{
                        id: 7,
                        biome_id: 2,
                        derby_type: 'normal',
                        is_registered: false,
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

    assert.equal(initialState.eligibleDerbyCount, 1);
    assert.equal(initialState.activeDerby.isRegistered, true);

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
        'Map smoke passed: derby registration and biome selection clicks are trusted.',
    );
} finally {
    await browser.close();
}
