import fs from 'node:fs/promises';

import { chromium } from 'playwright';

import { AutomationEngine } from './automation-engine.js';
import { createBrowserProfile } from './browser-profile.js';
import { RuntimeSettings } from './runtime-settings.js';
import { BaitFeature } from '../features/bait-feature.js';
import { FishingFeature } from '../features/fishing-feature.js';
import { MapFeature } from '../features/map-feature.js';
import { VerificationFeature } from '../features/verification-feature.js';
import { ArcaneAnglerPage } from '../site/arcane-angler-page.js';

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

function describeRuntime(settings, profile) {
    const details = [
        `无头模式=${enabledLabel(settings.browser.headless)}`,
        `自动钓鱼=${enabledLabel(settings.features.fishing.enabled)}`,
        `地图模式=${describeMapSettings(settings.features.map)}`,
        `自动鱼饵=${enabledLabel(settings.features.bait.enabled)}`,
        `自动验证=${enabledLabel(settings.features.verification.enabled)}`,
        `Chromium=${profile.browserVersion}`,
        `运行=${settings.schedule.activeMinMinutes}-${settings.schedule.activeMaxMinutes} 分钟`,
        `休息=${settings.schedule.restMinMinutes}-${settings.schedule.restMaxMinutes} 分钟`,
        `夜间停机=${formatHour(settings.schedule.quietStartHour)}-${formatHour(settings.schedule.quietEndHour)}`,
    ];

    if (settings.features.bait.enabled) {
        details.push(
            `目标鱼饵档位=${settings.features.bait.selectedBaitTier}`,
            `补货阈值=${settings.features.bait.restockThreshold}`,
            `购买数量=${settings.features.bait.purchaseQuantity}`,
        );
    }

    return `配置已加载：${details.join('，')}。`;
}

export class AutomationWorker {
    constructor({
        staticConfig,
        settingsStore,
        statsStore,
        reporter,
        chromiumApi = chromium,
    }) {
        this.staticConfig = staticConfig;
        this.settingsStore = settingsStore;
        this.statsStore = statsStore;
        this.settings = new RuntimeSettings(settingsStore);
        this.reporter = reporter;
        this.chromium = chromiumApi;
        this.context = null;
        this.engine = null;
        this.session = null;
        this.browserProfile = null;
        this.stopRequested = false;
        this.runPromise = null;
        this.dynamicConfig = this.createDynamicConfig();
    }

    createDynamicConfig() {
        const read = () => this.settingsStore.getRuntimeSettings();

        return {
            username: this.staticConfig.username,
            password: this.staticConfig.password,
            targetUrl: this.staticConfig.targetUrl,
            userDataDir: this.staticConfig.userDataDir,
            artifactsDir: this.staticConfig.artifactsDir,
            get character() {
                return read().general.character;
            },
            get navigationTimeoutMs() {
                return read().advanced.navigationTimeoutMs;
            },
            get verificationStepDelayMinMs() {
                return read().features.verification.stepDelayMinMs;
            },
            get verificationStepDelayMaxMs() {
                return read().features.verification.stepDelayMaxMs;
            },
            get verificationMaxAttempts() {
                return read().features.verification.maxAttempts;
            },
        };
    }

    getState() {
        return {
            browserOpen: Boolean(this.context),
            ...this.engine?.getState(),
        };
    }

    configurePage(page) {
        const timeout = this.dynamicConfig.navigationTimeoutMs;

        page.setDefaultTimeout(timeout);
        page.setDefaultNavigationTimeout(timeout);
        page.on('pageerror', error => {
            void this.reporter.log({
                level: 'error',
                phase: 'page',
                target: '监控游戏页面',
                message: `页面脚本异常：${error.message}`,
            });
        });
    }

    async launchBrowser() {
        const runtimeSettings = this.settingsStore.getRuntimeSettings();
        const nextContext = await this.chromium.launchPersistentContext(
            this.staticConfig.userDataDir,
            {
                headless: runtimeSettings.browser.headless,
                channel: this.browserProfile.channel,
                userAgent: this.browserProfile.userAgent,
                viewport: {
                    width: 1280,
                    height: 900,
                },
                locale: 'en-US',
                args: this.browserProfile.args,
            },
        );

        if (this.stopRequested) {
            await nextContext.close().catch(() => {});
            throw new Error('Worker 停止期间取消创建浏览器。');
        }

        this.context = nextContext;
        const page = this.context.pages()[0] || await this.context.newPage();

        this.configurePage(page);
        return page;
    }

    async closeBrowser() {
        const currentContext = this.context;

        this.context = null;
        await currentContext?.close().catch(() => {});
    }

    async start() {
        await fs.mkdir(this.staticConfig.userDataDir, {
            recursive: true,
            mode: 0o700,
        });
        await fs.mkdir(this.staticConfig.artifactsDir, {
            recursive: true,
            mode: 0o700,
        });
        await Promise.all([
            fs.chmod(this.staticConfig.userDataDir, 0o700),
            fs.chmod(this.staticConfig.artifactsDir, 0o700),
        ]);

        const runtimeSettings = this.settingsStore.getRuntimeSettings();

        this.browserProfile = createBrowserProfile();
        await this.reporter.update({
            level: 'idle',
            phase: 'starting',
            target: '启动 Playwright Worker',
            activeFeature: '挂机服务',
            message: describeRuntime(runtimeSettings, this.browserProfile),
        });

        const page = await this.launchBrowser();

        this.session = new ArcaneAnglerPage({
            page,
            config: this.dynamicConfig,
            reporter: this.reporter,
            shouldStop: () =>
                this.stopRequested ||
                this.engine?.isStopping() ||
                false,
            canAutomate: () => this.engine?.isOperationAllowed() || false,
            onCastResult: async (result, context) => {
                try {
                    await this.statsStore.recordCast(result, context);
                } catch (error) {
                    await this.reporter.log({
                        level: 'error',
                        phase: 'fishing',
                        target: '记录抛竿收益',
                        message: `收益统计写入失败：${error.message}`,
                    });
                }
            },
        });

        const browserLifecycle = {
            suspend: async () => this.closeBrowser(),
            resume: async () => {
                try {
                    const resumedPage = await this.launchBrowser();

                    this.session.replacePage(resumedPage);
                } catch (error) {
                    await this.closeBrowser();
                    throw error;
                }
            },
        };

        this.engine = new AutomationEngine({
            settings: this.settings,
            reporter: this.reporter,
            session: this.session,
            browserLifecycle,
        });

        this.engine.register(new VerificationFeature({
            session: this.session,
            reporter: this.reporter,
        }));
        this.engine.register(new MapFeature({
            session: this.session,
            reporter: this.reporter,
        }));
        this.engine.register(new BaitFeature({
            session: this.session,
            reporter: this.reporter,
        }));
        this.engine.register(new FishingFeature({
            session: this.session,
            settings: this.settings,
            reporter: this.reporter,
        }));

        this.runPromise = this.engine.start();
    }

    completion() {
        return this.runPromise || Promise.resolve();
    }

    async stop(signal = 'stop') {
        if (this.stopRequested) {
            return;
        }

        this.stopRequested = true;
        await this.engine?.stop(signal);
        await this.runPromise?.catch(() => {});
        await this.closeBrowser();
    }
}
