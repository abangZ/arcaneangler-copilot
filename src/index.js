import fs from 'node:fs/promises';

import { chromium } from 'playwright';

import { config } from './config.js';
import { AutomationEngine } from './core/automation-engine.js';
import { createBrowserProfile } from './core/browser-profile.js';
import { RuntimeSettings } from './core/runtime-settings.js';
import { StatusReporter } from './core/status-reporter.js';
import { BaitFeature } from './features/bait-feature.js';
import { FishingFeature } from './features/fishing-feature.js';
import { MapFeature } from './features/map-feature.js';
import { VerificationFeature } from './features/verification-feature.js';
import { ArcaneAnglerPage } from './site/arcane-angler-page.js';

let context = null;
let engine = null;
let browserProfile = null;
let stopRequested = false;

function enabledLabel(enabled) {
    return enabled ? '开启' : '关闭';
}

function formatHour(hour) {
    return `${String(hour).padStart(2, '0')}:00`;
}

function describeMapSettings(mapSettings) {
    if (mapSettings.mode === 'auto') {
        return '自动';
    }

    if (mapSettings.mode === 'fixed') {
        return `固定 Biome ${mapSettings.targetBiomeId}`;
    }

    return '关闭';
}

function describeRuntime(config, settings, profile) {
    const snapshot = settings.get();
    const details = [
        `无头模式=${enabledLabel(config.headless)}`,
        `自动化=${enabledLabel(snapshot.automationEnabled)}`,
        `自动钓鱼=${enabledLabel(snapshot.features.fishing.enabled)}`,
        `地图模式=${describeMapSettings(snapshot.features.map)}`,
        `自动鱼饵=${enabledLabel(snapshot.features.bait.enabled)}`,
        `自动验证=${enabledLabel(snapshot.features.verification.enabled)}`,
        `Chromium=${profile.browserVersion}`,
        `运行=${config.activeMinMinutes}-${config.activeMaxMinutes} 分钟`,
        `休息=${config.restMinMinutes}-${config.restMaxMinutes} 分钟`,
        `夜间停机=${formatHour(config.quietStartHour)}-${formatHour(config.quietEndHour)}`,
    ];

    if (snapshot.features.bait.enabled) {
        details.push(
            `目标鱼饵档位=${snapshot.features.bait.selectedBaitTier}`,
            `补货阈值=${snapshot.features.bait.restockThreshold}`,
            `购买数量=${snapshot.features.bait.purchaseQuantity}`,
        );
    }

    return `配置已加载：${details.join('，')}。`;
}

function configurePage(page) {
    page.setDefaultTimeout(config.navigationTimeoutMs);
    page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
    page.on('pageerror', error => {
        console.error(
            `[${new Date().toISOString()}] [ERROR/page] 页面脚本异常：${error.message}`,
        );
    });
}

async function launchBrowser() {
    const nextContext = await chromium.launchPersistentContext(
        config.userDataDir,
        {
            headless: config.headless,
            channel: browserProfile.channel,
            userAgent: browserProfile.userAgent,
            viewport: {
                width: 1280,
                height: 900,
            },
            locale: 'en-US',
            args: browserProfile.args,
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

    const currentContext = context;

    context = null;
    await currentContext?.close().catch(() => {});
}

async function main() {
    await fs.mkdir(config.userDataDir, { recursive: true });
    await fs.mkdir(config.artifactsDir, { recursive: true });

    const settings = RuntimeSettings.fromConfig(config);
    const reporter = new StatusReporter();

    browserProfile = createBrowserProfile();

    await reporter.update({
        level: 'idle',
        phase: 'starting',
        target: '启动 Copilot',
        activeFeature: '挂机服务',
        message: describeRuntime(config, settings, browserProfile),
    });

    const page = await launchBrowser();

    const session = new ArcaneAnglerPage({
        page,
        config,
        reporter,
        shouldStop: () => stopRequested || engine?.isStopping() || false,
        canAutomate: () => engine?.isOperationAllowed() || false,
    });

    const browserLifecycle = {
        async suspend() {
            const currentContext = context;

            context = null;
            await currentContext?.close().catch(() => {});
        },
        async resume() {
            try {
                const resumedPage = await launchBrowser();

                session.replacePage(resumedPage);
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
    engine.register(new MapFeature({
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
                `[${new Date().toISOString()}] [ERROR/process] 程序异常退出：`,
                error.stack || error.message,
            );
            process.exitCode = 1;
        }
    })
    .finally(async () => {
        const currentContext = context;

        context = null;
        await currentContext?.close().catch(() => {});
    });
