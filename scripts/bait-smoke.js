import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { chromium } from 'playwright';

import { createBrowserProfile } from '../src/core/browser-profile.js';
import { StatusReporter } from '../src/core/status-reporter.js';
import {
    BaitFeature,
    selectBaitTier,
} from '../src/features/bait-feature.js';
import { ArcaneAnglerPage } from '../src/site/arcane-angler-page.js';

const artifactsDir = await fs.mkdtemp('/tmp/arcaneangler-bait-smoke-');
const reporter = new StatusReporter();
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

    await page.route('https://game.test/api/game/**', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{"success":true}',
        });
    });

    const sidebarButtons = Array.from({ length: 21 }, (_, index) =>
        `<button data-sidebar-index="${index}"${index === 0 ? ' class="border-l-4"' : ''}>${index}</button>`,
    ).join('');

    await page.setContent(`
        <div id="reward-modal" class="fixed inset-0 z-50 flex items-center justify-center">
            <div class="rounded-xl p-5 max-w-md w-full">
                <header><button id="reward-close" class="text-xl leading-none">×</button></header>
                <div id="reward-content">Loading</div>
            </div>
        </div>
        <nav class="flex-1 overflow-y-auto py-3">${sidebarButtons}</nav>
        <main id="game-view"></main>
    `);

    await page.evaluate(() => {
        window.BIOMES = [{ id: 1 }, { id: 2 }];
        window.baitSmoke = {
            currentBiomeId: 1,
            equippedBaitId: 'bait_1_default',
            events: [],
            purchaseClicks: 0,
            consumeBeforePurchase: true,
            trustedClicks: [],
            stocks: {
                bait_1_low: 98,
                bait_1_high: 0,
                bait_2_low: 0,
                bait_2_high: 0,
            },
        };

        const catalogs = {
            1: [
                {
                    id: 'bait_1_default',
                    name: 'Stale Bread Crust',
                    price: 0,
                },
                {
                    id: 'bait_1_low',
                    name: 'Tinker Dough',
                    price: 40,
                },
                {
                    id: 'bait_1_high',
                    name: 'River Nymph',
                    price: 200,
                },
            ],
            2: [
                {
                    id: 'bait_2_default',
                    name: 'Cave Crumb',
                    price: 0,
                },
                {
                    id: 'bait_2_low',
                    name: 'Glow Dough',
                    price: 50,
                },
                {
                    id: 'bait_2_high',
                    name: 'Crystal Nymph',
                    price: 250,
                },
            ],
        };

        window.getBaitsForBiome = biomeId => catalogs[biomeId] || [];

        const view = document.getElementById('game-view');
        const sidebar = [...document.querySelectorAll(
            '[data-sidebar-index]',
        )];

        const activateSidebar = index => {
            sidebar.forEach((button, buttonIndex) => {
                button.classList.toggle('border-l-4', buttonIndex === index);
            });
        };
        const recordTrustedClick = (name, event) => {
            window.baitSmoke.trustedClicks.push({
                name,
                trusted: event.isTrusted,
            });
        };

        const renderFishing = () => {
            view.innerHTML = `<section><span>[B${window.baitSmoke.currentBiomeId}]</span></section>`;
        };

        const renderBaits = () => {
            const catalog = window.getBaitsForBiome(
                window.baitSmoke.currentBiomeId,
            );
            const cards = catalog.map(bait => {
                const equipped = window.baitSmoke.equippedBaitId === bait.id;
                const stock = window.baitSmoke.stocks[bait.id] ?? null;
                const isExpensive = bait.id.endsWith('_high');
                const purchaseControls = bait.price > 0
                    ? [
                        '<div class="text-right ml-2">',
                        `<span class="text-xs">Owned: ${stock.toLocaleString('en-US')}</span>`,
                        '</div>',
                        '<div class="flex gap-2">',
                        '<input type="number" min="1" max="999999">',
                        `<button data-buy="${bait.id}"${isExpensive ? ' disabled' : ''}>Buy</button>`,
                        '</div>',
                    ].join('')
                    : '';
                const equipDisabled = bait.price > 0 && stock <= 0
                    ? ' disabled'
                    : '';

                return [
                    `<div class="p-4 rounded-lg border-2${equipped ? ' border-yellow-400' : ''}" data-bait-id="${bait.id}">`,
                    purchaseControls,
                    `<button class="w-full py-2 rounded font-bold text-sm" data-equip="${bait.id}"${equipDisabled}>Equip</button>`,
                    '</div>',
                ].join('');
            }).join('');

            view.innerHTML = [
                '<div class="flex gap-2 mb-6 border-b border-gray-700">',
                '<button>Rods</button><button>Baits</button>',
                '</div>',
                '<div class="max-w-6xl mx-auto">',
                `<div class="space-y-3">${cards}</div>`,
                '</div>',
            ].join('');

            view.querySelectorAll('[data-buy]').forEach(button => {
                const input = button.parentElement.querySelector('input');

                input.addEventListener('input', () => {
                    button.disabled = button.dataset.buy.endsWith('_high') ||
                        Number(input.value) < 1;
                });
                button.addEventListener('click', async event => {
                    recordTrustedClick(`buy:${button.dataset.buy}`, event);
                    window.baitSmoke.purchaseClicks += 1;

                    if (!button.classList.contains('bg-red-600')) {
                        button.classList.add('bg-red-600');
                        return;
                    }

                    await fetch('https://game.test/api/game/buy-bait', {
                        method: 'POST',
                    });
                    const baitId = button.dataset.buy;

                    if (
                        baitId === 'bait_1_low' &&
                        window.baitSmoke.consumeBeforePurchase
                    ) {
                        window.baitSmoke.stocks[baitId] -= 1;
                        window.baitSmoke.consumeBeforePurchase = false;
                    }

                    window.baitSmoke.stocks[baitId] += Number(input.value);
                    renderBaits();
                });
            });

            view.querySelectorAll('[data-equip]').forEach(button => {
                button.addEventListener('click', async event => {
                    recordTrustedClick(`equip:${button.dataset.equip}`, event);
                    await fetch('https://game.test/api/game/equip-bait', {
                        method: 'POST',
                    });
                    window.baitSmoke.equippedBaitId = button.dataset.equip;
                    window.baitSmoke.events.push(
                        `equip:${button.dataset.equip}`,
                    );
                    renderBaits();
                });
            });
        };

        window.baitSmoke.switchBiome = biomeId => {
            window.baitSmoke.currentBiomeId = biomeId;
            window.baitSmoke.equippedBaitId = `bait_${biomeId}_default`;
            activateSidebar(0);
            renderFishing();
        };

        const renderEquipment = () => {
            view.innerHTML = [
                '<div class="flex gap-2 mb-6 border-b border-gray-700">',
                '<button>Rods</button><button id="bait-tab">Baits</button>',
                '</div>',
            ].join('');
            document.getElementById('bait-tab').addEventListener(
                'click',
                event => {
                    recordTrustedClick('tab:baits', event);
                    renderBaits();
                },
            );
        };

        sidebar[0].addEventListener('click', event => {
            recordTrustedClick('sidebar:fishing', event);
            activateSidebar(0);
            renderFishing();
        });
        sidebar[4].addEventListener('click', event => {
            recordTrustedClick('sidebar:equipment', event);
            activateSidebar(4);
            renderEquipment();
        });
        renderFishing();

        document.getElementById('reward-close').addEventListener(
            'click',
            event => {
                recordTrustedClick('reward:close', event);
                window.baitSmoke.events.push('reward:close');
                document.getElementById('reward-modal').remove();
            },
        );

        setTimeout(() => {
            const content = document.getElementById('reward-content');

            if (!content) return;

            content.innerHTML = [
                '<div class="flex flex-wrap gap-2 mb-4"><span>Day 1</span></div>',
                '<button id="reward-claim" class="w-full py-2.5 rounded-lg">Claim</button>',
            ].join('');
            document.getElementById('reward-claim').addEventListener(
                'click',
                event => {
                    recordTrustedClick('reward:claim', event);
                    window.baitSmoke.events.push('reward:claim');
                    event.currentTarget.remove();
                },
            );
        }, 80);
    });

    let automationAllowed = true;
    const session = new ArcaneAnglerPage({
        page,
        reporter,
        shouldStop: () => false,
        canAutomate: () => automationAllowed,
        config: {
            artifactsDir,
            navigationTimeoutMs: 2_000,
        },
    });

    assert.equal(await session.dismissBlockingOverlays(), true);
    assert.deepEqual(
        await page.evaluate(() => window.baitSmoke.events),
        ['reward:claim', 'reward:close'],
    );

    const settingsSnapshot = {
        automationEnabled: true,
        features: {
            bait: {
                enabled: true,
                selectedBaitTier: 1,
                guildTournamentBaitTier: 2,
                derbyBaitTier: 3,
                restockThreshold: 100,
                purchaseQuantity: 100,
                checkIntervalMs: 30_000,
            },
        },
    };

    assert.equal(selectBaitTier(settingsSnapshot.features.bait), 1);
    assert.equal(selectBaitTier(settingsSnapshot.features.bait, {
        type: 'guild-tournament',
    }), 2);
    assert.equal(selectBaitTier(settingsSnapshot.features.bait, {
        type: 'derby',
    }), 3);
    assert.equal(selectBaitTier(settingsSnapshot.features.bait, {
        type: 'world-boss',
    }), 1);

    const feature = new BaitFeature({ session, reporter });

    assert.equal(await feature.tick(settingsSnapshot), true);

    const result = await page.evaluate(() => ({
        equippedBaitId: window.baitSmoke.equippedBaitId,
        events: window.baitSmoke.events,
        fishingActive: document.querySelector(
            '[data-sidebar-index="0"]',
        ).classList.contains('border-l-4'),
        purchaseClicks: window.baitSmoke.purchaseClicks,
        stock: window.baitSmoke.stocks.bait_1_low,
    }));

    assert.equal(result.stock, 197);
    assert.equal(result.purchaseClicks, 2);
    assert.equal(result.equippedBaitId, 'bait_1_low');
    assert.equal(result.events.at(-1), 'equip:bait_1_low');
    assert.equal(result.fishingActive, true);
    const trustedClicks = await page.evaluate(() =>
        window.baitSmoke.trustedClicks,
    );

    assert.ok(trustedClicks.length > 0, '测试必须实际触发页面点击');
    assert.ok(
        trustedClicks.every(event => event.trusted),
        '所有生产页面点击都必须产生可信事件',
    );
    assert.equal(await feature.tick(settingsSnapshot), false);
    assert.equal(
        await page.evaluate(() => window.baitSmoke.purchaseClicks),
        2,
    );
    const equipmentClickCount = await page.evaluate(() =>
        window.baitSmoke.events.filter(event =>
            event === 'sidebar:equipment',
        ).length,
    );

    feature.reset();
    assert.equal(await feature.tick(settingsSnapshot), true);
    assert.equal(
        await page.evaluate(() =>
            window.baitSmoke.events.filter(event =>
                event === 'sidebar:equipment',
            ).length,
        ),
        equipmentClickCount,
    );
    assert.match(reporter.get().message, /最近响应显示当前库存 197/);

    await page.evaluate(() => window.baitSmoke.switchBiome(2));
    feature.reset();
    assert.equal(await feature.tick(settingsSnapshot), true);

    const biomeTwoResult = await page.evaluate(() => ({
        equippedBaitId: window.baitSmoke.equippedBaitId,
        purchaseClicks: window.baitSmoke.purchaseClicks,
        stock: window.baitSmoke.stocks.bait_2_low,
    }));

    assert.equal(biomeTwoResult.stock, 100);
    assert.equal(biomeTwoResult.purchaseClicks, 4);
    assert.equal(biomeTwoResult.equippedBaitId, 'bait_2_low');

    const unavailableFeature = new BaitFeature({ session, reporter });
    const unavailableSettings = structuredClone(settingsSnapshot);

    unavailableSettings.features.bait.selectedBaitTier = 4;
    assert.equal(
        await unavailableFeature.tick(unavailableSettings),
        false,
    );
    assert.equal(reporter.get().target, '等待目标鱼饵档位可用');
    assert.match(reporter.get().message, /1: Glow Dough/);

    const catalog = await session.getBaitCatalog(2);
    await session.openBaitEquipment();
    assert.deepEqual(
        await session.buyBaitThroughUi(
            'bait_2_high',
            catalog,
            100,
            0,
        ),
        { purchased: false, reason: 'insufficient-funds' },
    );
    await session.openFishingPage();

    const trustedClickCount = await page.evaluate(() =>
        window.baitSmoke.trustedClicks.length,
    );
    automationAllowed = false;
    await assert.rejects(
        () => session.navigateToSidebarPage('equipment'),
        error => error.code === 'AUTOMATION_SCHEDULE_PAUSED',
    );
    assert.equal(
        await page.evaluate(() => window.baitSmoke.trustedClicks.length),
        trustedClickCount,
    );

    console.log(
        'Bait smoke passed: reward priority, cross-biome tiers, two-step purchase, stock, equip, interval and insufficient funds work.',
    );
} finally {
    await browser.close();
    await fs.rm(artifactsDir, { recursive: true, force: true });
}
