import fs from 'node:fs/promises';

import { chromium } from 'playwright';

import { config } from './config.js';
import { AutomationEngine } from './core/automation-engine.js';
import { RuntimeSettings } from './core/runtime-settings.js';
import { StatusReporter } from './core/status-reporter.js';
import { BaitFeature } from './features/bait-feature.js';
import { FishingFeature } from './features/fishing-feature.js';
import { VerificationFeature } from './features/verification-feature.js';
import { ArcaneAnglerPage } from './site/arcane-angler-page.js';
import { CopilotPanel } from './ui/copilot-panel.js';

let context = null;
let engine = null;
let panel = null;
let stopRequested = false;

async function close(signal) {
    if (stopRequested) {
        return;
    }

    stopRequested = true;
    await engine?.stop(signal);
    panel?.stop();

    if (context) {
        await context.close().catch(() => {});
    }
}

async function main() {
    await fs.mkdir(config.userDataDir, { recursive: true });
    await fs.mkdir(config.artifactsDir, { recursive: true });

    const settings = await RuntimeSettings.load(config);
    const reporter = new StatusReporter();

    context = await chromium.launchPersistentContext(config.userDataDir, {
        headless: config.headless,
        viewport: {
            width: 1280,
            height: 900,
        },
        locale: 'en-US',
        args: ['--disable-dev-shm-usage'],
    });

    const page = context.pages()[0] || await context.newPage();

    page.setDefaultTimeout(config.navigationTimeoutMs);
    page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
    page.on('pageerror', error => {
        console.log(
            `[${new Date().toISOString()}] 页面脚本异常：${error.message}`,
        );
    });

    panel = new CopilotPanel({ page, settings, reporter });
    await panel.start();

    const session = new ArcaneAnglerPage({
        page,
        config,
        reporter,
        shouldStop: () => stopRequested || engine?.isStopping() || false,
    });

    engine = new AutomationEngine({
        config,
        settings,
        reporter,
        session,
    });

    engine.register(new VerificationFeature({
        session,
        reporter,
    }));
    engine.register(new BaitFeature({
        session,
        reporter,
    }));
    engine.register(new FishingFeature({
        session,
        settings,
        reporter,
        config,
    }));

    await engine.start();
}

process.once('SIGINT', () => {
    void close('SIGINT');
});
process.once('SIGTERM', () => {
    void close('SIGTERM');
});

main()
    .catch(error => {
        if (!stopRequested) {
            console.error(
                `[${new Date().toISOString()}] 程序异常退出：`,
                error.stack || error.message,
            );
            process.exitCode = 1;
        }
    })
    .finally(async () => {
        panel?.stop();

        if (context) {
            await context.close().catch(() => {});
        }
    });
