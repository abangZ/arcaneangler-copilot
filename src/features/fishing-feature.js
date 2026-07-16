import {
    isVisible,
    randomInteger,
    sleep,
} from '../core/browser-utils.js';

const CAST_DELAY_TIERS = Object.freeze([
    {
        threshold: 0.02,
        minMs: 20_000,
        maxMs: 40_000,
        label: '较长停顿',
    },
    {
        threshold: 0.10,
        minMs: 5_000,
        maxMs: 10_000,
        label: '短暂停顿',
    },
]);

export function selectCastDelay(fishingSettings, {
    chance = Math.random,
    integer = randomInteger,
    competitionActive = false,
} = {}) {
    const roll = chance();
    const tier = CAST_DELAY_TIERS.find(candidate =>
        (!competitionActive || candidate.label !== '较长停顿') &&
        roll < candidate.threshold,
    );

    if (tier) {
        return {
            durationMs: integer(tier.minMs, tier.maxMs),
            label: tier.label,
        };
    }

    return {
        durationMs: integer(
            fishingSettings.clickDelayMinMs,
            fishingSettings.clickDelayMaxMs,
        ),
        label: '常规延迟',
    };
}

export async function waitForCastDelay(durationMs, {
    assertAllowed,
    shouldCancel = () => false,
    sleepFor = sleep,
    now = Date.now,
    checkIntervalMs = 500,
}) {
    const deadline = now() + durationMs;

    while (true) {
        assertAllowed();
        if (shouldCancel()) {
            return;
        }
        const remainingMs = deadline - now();

        if (remainingMs <= 0) {
            return;
        }

        await sleepFor(Math.min(checkIntervalMs, remainingMs));
    }
}

export class FishingFeature {
    constructor({ session, settings, reporter }) {
        this.id = 'fishing';
        this.label = '自动钓鱼';
        this.priority = 100;
        this.session = session;
        this.settings = settings;
        this.reporter = reporter;
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
            const observedCompetition =
                this.session.getActiveCompetition?.();
            const competition = observedCompetition?.type === 'world-boss' &&
                settings.features.worldBoss?.enabled === false
                ? null
                : observedCompetition;
            const delay = selectCastDelay(settings.features.fishing, {
                competitionActive: Boolean(competition),
            });

            await this.reporter.update({
                level: 'running',
                phase: 'fishing',
                target: '点击抛竿按钮',
                message: `抛竿按钮已可用，${competition ? `${competition.type === 'world-boss' ? '世界 Boss' : competition.type === 'guild-tournament' ? '公会锦标赛' : '个人赛事'}期间` : ''}本次${delay.label}，等待 ${delay.durationMs}ms 后点击。`,
            }, { record: false });
            await waitForCastDelay(delay.durationMs, {
                assertAllowed: () =>
                    this.session.assertAutomationAllowed(),
                shouldCancel: () =>
                    delay.label === '较长停顿' &&
                    Boolean(this.session.getActiveCompetition?.()),
            });

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
            Date.now() - this.lastProgressAt >=
                settings.advanced.stallTimeoutMs
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

        await sleep(settings.advanced.pollIntervalMs);
        return true;
    }
}
