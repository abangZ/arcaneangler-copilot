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

function configurePage(page) {
    page.setDefaultTimeout(config.navigationTimeoutMs);
    page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
    page.on('pageerror', error => {
        console.log(
            `[${new Date().toISOString()}] 页面脚本异常：${error.message}`,
        );
    });
}

async function launchBrowser() {
    const nextContext = await chromium.launchPersistentContext(
        config.userDataDir,
        {
            headless: config.headless,
            viewport: {
                width: 1280,
                height: 900,
            },
            locale: 'en-US',
            args: ['--disable-dev-shm-usage'],
        },
    );

    if (stopRequested) {
        await nextContext.close().catch(() => {});
        throw new Error('程序停止期间取消创建浏览器。');
    }

    context = nextContext;
    const page = context.pages()[0] || await context.newPage();

    configurePage(page);
    return page;
}

async function close(signal) {
    if (stopRequested) {
        return;
    }

    stopRequested = true;
    await engine?.stop(signal);
    panel?.stop();

    const currentContext = context;

    context = null;
    await currentContext?.close().catch(() => {});
}

async function main() {
    await fs.mkdir(config.userDataDir, { recursive: true });
    await fs.mkdir(config.artifactsDir, { recursive: true });

    const settings = await RuntimeSettings.load(config);
    const reporter = new StatusReporter();

    const page = await launchBrowser();

    panel = new CopilotPanel({ page, settings, reporter });
    await panel.start();

    const session = new ArcaneAnglerPage({
        page,
        config,
        reporter,
        shouldStop: () => stopRequested || engine?.isStopping() || false,
        canAutomate: () => engine?.isOperationAllowed() || false,
    });

    const browserLifecycle = {
        async suspend() {
            panel?.stop();
            panel = null;

            const currentContext = context;

            context = null;
            await currentContext?.close().catch(() => {});
        },
        async resume() {
            try {
                const resumedPage = await launchBrowser();
                const resumedPanel = new CopilotPanel({
                    page: resumedPage,
                    settings,
                    reporter,
                });

                session.replacePage(resumedPage);
                await resumedPanel.start();
                panel = resumedPanel;
            } catch (error) {
                const currentContext = context;

                context = null;
                await currentContext?.close().catch(() => {});
                throw error;
            }
        },
    };

    engine = new AutomationEngine({
        config,
        settings,
        reporter,
        session,
        browserLifecycle,
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

        const currentContext = context;

        context = null;
        await currentContext?.close().catch(() => {});
    });
