import {
    isVisible,
    randomInteger,
    sleep,
} from '../core/browser-utils.js';

export class FishingFeature {
    constructor({ session, settings, reporter, config }) {
        this.id = 'fishing';
        this.label = '自动钓鱼';
        this.priority = 100;
        this.session = session;
        this.settings = settings;
        this.reporter = reporter;
        this.config = config;
        this.initialized = false;
        this.lastClassicSetting = null;
        this.lastProgressAt = Date.now();
    }

    isEnabled(settings) {
        return settings.features.fishing.enabled;
    }

    reset() {
        this.initialized = false;
        this.lastClassicSetting = null;
        this.lastProgressAt = Date.now();
    }

    async initialize(settings) {
        const { enforceClassicMode } = settings.features.fishing;

        await this.session.ensureClassicCastMode(enforceClassicMode);
        this.initialized = true;
        this.lastClassicSetting = enforceClassicMode;
        this.lastProgressAt = Date.now();

        await this.reporter.update({
            level: 'running',
            phase: 'fishing',
            target: '等待可用的抛竿按钮',
            activeFeature: this.label,
            message: '自动钓鱼功能已就绪。',
        });
    }

    async tick(settings) {
        if (await this.session.dismissBlockingOverlays()) {
            this.lastProgressAt = Date.now();
            return true;
        }

        if (await this.session.isCharacterPickerVisible()) {
            await this.session.selectCharacterIfNeeded();
            this.reset();
            return true;
        }

        if (!(await this.session.isGameShellVisible())) {
            await this.session.bootstrap({ reload: true });
            this.reset();
            return true;
        }

        if (
            !this.initialized ||
            this.lastClassicSetting !==
                settings.features.fishing.enforceClassicMode
        ) {
            await this.initialize(settings);
            return true;
        }

        if (!(await this.session.isFishingPage())) {
            await this.session.navigateToSidebarPage('fishing');
        }

        const castButton = await this.session.getReadyCastButton();

        if (castButton) {
            const delay = randomInteger(
                settings.features.fishing.clickDelayMinMs,
                settings.features.fishing.clickDelayMaxMs,
            );

            await this.reporter.update({
                level: 'running',
                phase: 'fishing',
                target: '点击抛竿按钮',
                message: `抛竿按钮已可用，等待 ${delay}ms 后点击。`,
            }, { record: false });
            await sleep(delay);

            const latestSettings = this.settings.get();

            if (
                latestSettings.automationEnabled &&
                latestSettings.features.fishing.enabled &&
                await isVisible(castButton) &&
                await castButton.isEnabled()
            ) {
                await this.session.trustedClick(castButton);
                this.lastProgressAt = Date.now();
                await this.reporter.incrementCast();

                await castButton.waitFor({
                    state: 'hidden',
                    timeout: 3_000,
                }).catch(() => {});
            }
        } else if (
            Date.now() - this.lastProgressAt >= this.config.stallTimeoutMs
        ) {
            await this.session.captureScreenshot('stalled');
            await this.session.bootstrap({ reload: true });
            this.reset();
        } else {
            await this.reporter.update({
                level: 'waiting',
                phase: 'fishing',
                target: '等待可用的抛竿按钮',
                message: '正在等待冷却结束或页面准备完成。',
            }, { record: false });
        }

        await sleep(this.config.pollIntervalMs);
        return true;
    }
}
