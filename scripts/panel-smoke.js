import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { RuntimeSettings } from '../src/core/runtime-settings.js';
import { StatusReporter } from '../src/core/status-reporter.js';
import { CopilotPanel } from '../src/ui/copilot-panel.js';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);
const settingsFile = path.join(
    projectRoot,
    '.data/panel-smoke-settings.json',
);
const migrationSettingsFile = path.join(
    projectRoot,
    '.data/panel-smoke-v1-settings.json',
);

await fs.mkdir(path.dirname(migrationSettingsFile), { recursive: true });
await fs.writeFile(migrationSettingsFile, JSON.stringify({
    version: 1,
    automationEnabled: true,
    features: {
        fishing: {
            enabled: true,
            enforceClassicMode: true,
            clickDelayMinMs: 250,
            clickDelayMaxMs: 800,
        },
        verification: { enabled: true },
    },
}));

try {
    const migrated = await RuntimeSettings.load({
        settingsFile: migrationSettingsFile,
        automationEnabled: true,
        autoFishing: true,
        autoVerify: true,
        autoBait: false,
        baitId: '',
        baitRestockThreshold: 100,
        baitPurchaseQuantity: 1_000,
        baitCheckIntervalMs: 30_000,
        enforceClassicMode: true,
        clickDelayMinMs: 250,
        clickDelayMaxMs: 800,
    });

    assert.equal(migrated.get().version, 2);
    assert.deepEqual(migrated.get().features.bait, {
        enabled: false,
        selectedBaitId: '',
        restockThreshold: 100,
        purchaseQuantity: 1_000,
        checkIntervalMs: 30_000,
    });
} finally {
    await fs.rm(migrationSettingsFile, { force: true });
}

const settings = new RuntimeSettings(settingsFile, {
    version: 2,
    automationEnabled: true,
    features: {
        fishing: {
            enabled: true,
            enforceClassicMode: true,
            clickDelayMinMs: 250,
            clickDelayMaxMs: 800,
        },
        verification: {
            enabled: true,
        },
        bait: {
            enabled: false,
            selectedBaitId: '',
            restockThreshold: 100,
            purchaseQuantity: 1_000,
            checkIntervalMs: 30_000,
        },
    },
});
const reporter = new StatusReporter();
const browser = await chromium.launch({ headless: true });

async function waitForSetting(predicate, message) {
    const deadline = Date.now() + 2_000;

    while (Date.now() < deadline) {
        if (predicate(settings.get())) {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 20));
    }

    throw new Error(message);
}

try {
    const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
    });

    await page.setContent(`
        <main style="min-height:100vh;background:#07111f;color:#fff;padding:40px">
            <h1>Arcane Angler Panel Smoke</h1>
        </main>
    `);
    await page.evaluate(() => {
        window.BIOMES = [{ id: 1 }, { id: 2 }];
        const defaultBait = {
            id: 'bait_default',
            name: 'Stale Bread Crust',
        };
        window.getBaitsForBiome = biomeId => [
            defaultBait,
            {
                id: `bait_${biomeId}_low`,
                name: `Biome ${biomeId} Bait`,
            },
        ];
    });

    const panel = new CopilotPanel({ page, settings, reporter });
    await panel.start();
    await reporter.update({
        level: 'running',
        phase: 'fishing',
        target: '验证面板状态同步',
        message: '面板 smoke 测试正在运行。',
    });

    const host = page.locator('#arcane-copilot-panel-host');
    await host.waitFor({ state: 'attached' });
    assert.equal(
        await host.locator('[data-target]').textContent(),
        '验证面板状态同步',
    );

    const primaryToggle = host.locator('[data-primary-toggle]');
    assert.equal(await primaryToggle.textContent(), '暂停自动化');
    await primaryToggle.click();
    await page.waitForFunction(() => {
        const hostElement = document.getElementById(
            'arcane-copilot-panel-host',
        );
        return hostElement?.shadowRoot
            ?.querySelector('[data-primary-toggle]')
            ?.dataset.enabled === 'false';
    });
    assert.equal(settings.get().automationEnabled, false);
    assert.equal(await primaryToggle.textContent(), '开始自动化');

    await host.locator('[data-tab="settings"]').click();
    await host.locator('[data-subtab="fishing"]').click();

    const classicModeToggle = host.locator(
        '[data-setting="enforceClassicMode"]',
    );
    await classicModeToggle.locator('xpath=..').click();

    await page.waitForFunction(() => {
        const hostElement = document.getElementById(
            'arcane-copilot-panel-host',
        );
        return hostElement?.shadowRoot
            ?.querySelector('[data-setting="enforceClassicMode"]')
            ?.checked === false;
    });

    assert.equal(
        settings.get().features.fishing.enforceClassicMode,
        false,
    );

    await host.locator('[data-subtab="verification"]').click();
    const autoVerificationToggle = host.locator(
        '[data-setting="autoVerificationEnabled"]',
    );
    await autoVerificationToggle.locator('xpath=..').click();
    await waitForSetting(
        snapshot => !snapshot.features.verification.enabled,
        '自动验证开关没有保存',
    );
    assert.equal(settings.get().features.verification.enabled, false);

    await host.locator('[data-subtab="bait"]').click();
    const baitSelect = host.locator(
        '[data-setting="selectedBaitId"]',
    );
    assert.equal(await baitSelect.locator('option').count(), 4);
    await baitSelect.selectOption('bait_1_low');
    await waitForSetting(
        snapshot => snapshot.features.bait.selectedBaitId === 'bait_1_low',
        '目标鱼饵设置没有保存',
    );
    assert.equal(
        settings.get().features.bait.selectedBaitId,
        'bait_1_low',
    );

    const autoBaitToggle = host.locator(
        '[data-setting="autoBaitEnabled"]',
    );
    await autoBaitToggle.locator('xpath=..').click();
    await waitForSetting(
        snapshot => snapshot.features.bait.enabled,
        '自动鱼饵开关没有保存',
    );
    assert.equal(settings.get().features.bait.enabled, true);

    const restockThreshold = host.locator(
        '[data-setting="restockThreshold"]',
    );
    await restockThreshold.fill('75');
    await restockThreshold.press('Tab');
    await waitForSetting(
        snapshot => snapshot.features.bait.restockThreshold === 75,
        '补货阈值没有保存',
    );
    assert.equal(settings.get().features.bait.restockThreshold, 75);

    const purchaseQuantity = host.locator(
        '[data-setting="purchaseQuantity"]',
    );
    await purchaseQuantity.fill('110');
    await purchaseQuantity.press('Tab');
    await page.waitForFunction(() => {
        const hostElement = document.getElementById(
            'arcane-copilot-panel-host',
        );
        return hostElement?.shadowRoot
            ?.querySelector('[data-message]')
            ?.textContent.includes('100 的倍数');
    });
    assert.equal(settings.get().features.bait.purchaseQuantity, 1_000);

    await purchaseQuantity.fill('1200');
    await purchaseQuantity.press('Tab');
    await waitForSetting(
        snapshot => snapshot.features.bait.purchaseQuantity === 1_200,
        '购买数量没有保存',
    );
    assert.equal(settings.get().features.bait.purchaseQuantity, 1_200);

    await host.locator('[data-tab="status"]').click();

    await fs.mkdir(path.join(projectRoot, 'artifacts'), { recursive: true });
    await page.screenshot({
        path: path.join(projectRoot, 'artifacts/panel-smoke.png'),
        fullPage: true,
    });

    panel.stop();
    console.log(
        'Panel smoke passed: main toggle, bait submenu, validation and persistence work.',
    );
} finally {
    await browser.close();
    await fs.rm(settingsFile, { force: true });
}
