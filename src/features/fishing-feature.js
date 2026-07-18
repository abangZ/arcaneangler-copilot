import {
    isVisible,
    randomInteger,
    sleep,
} from '../core/browser-utils.js';

export const NO_FISH_REFRESH_MS = 3 * 60_000;

export function selectCastDelay(fishingSettings, {
    chance = Math.random,
    integer = randomInteger,
    competitionActive = false,
} = {}) {
    const roll = chance();
    const longChance = fishingSettings.longPauseEnabled
        ? fishingSettings.longPauseChancePercent / 100
        : 0;
    const shortChance = fishingSettings.shortPauseEnabled
        ? fishingSettings.shortPauseChancePercent / 100
        : 0;

    if (!competitionActive && longChance > 0 && roll < longChance) {
        return {
            durationMs: integer(
                fishingSettings.longPauseMinMs,
                fishingSettings.longPauseMaxMs,
            ),
            label: '较长停顿',
        };
    }

    if (shortChance > 0 && roll < longChance + shortChance) {
        return {
            durationMs: integer(
                fishingSettings.shortPauseMinMs,
                fishingSettings.shortPauseMaxMs,
            ),
            label: '短暂停顿',
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

export async function waitForCastButtonToLeaveReadyState(castButton, {
    sleepFor = sleep,
    now = Date.now,
    timeoutMs = 3_000,
    checkIntervalMs = 50,
} = {}) {
    const deadline = now() + timeoutMs;

    while (now() < deadline) {
        if (
            !(await isVisible(castButton)) ||
            !(await castButton.isEnabled())
        ) {
            return;
        }

        await sleepFor(Math.min(checkIntervalMs, deadline - now()));
    }
}

export class FishingFeature {
    constructor({ session, settings, reporter, now = Date.now }) {
        this.id = 'fishing';
        this.label = '自动钓鱼';
        this.priority = 100;
        this.session = session;
        this.settings = settings;
        this.reporter = reporter;
        this.now = now;
        this.initialized = false;
        this.lastClassicSetting = null;
        this.lastProgressAt = this.now();
        this.noFishWatchStartedAt = this.now();
    }

    isEnabled(settings) {
        return settings.features.fishing.enabled;
    }

    reset() {
        this.initialized = false;
        this.lastClassicSetting = null;
        this.lastProgressAt = this.now();
        this.noFishWatchStartedAt = this.now();
    }

    async initialize(settings) {
        const { enforceClassicMode } = settings.features.fishing;

        await this.session.ensureClassicCastMode(enforceClassicMode);
        this.initialized = true;
        this.lastClassicSetting = enforceClassicMode;
        this.lastProgressAt = this.now();
        this.noFishWatchStartedAt = this.now();

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
            this.lastProgressAt = this.now();
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

        const lastSuccessfulCastAt = Number(
            this.session.getLastSuccessfulCastAt?.(),
        );
        const lastFishProgressAt = Number.isFinite(lastSuccessfulCastAt)
            ? Math.max(this.noFishWatchStartedAt, lastSuccessfulCastAt)
            : this.noFishWatchStartedAt;

        if (this.now() - lastFishProgressAt >= NO_FISH_REFRESH_MS) {
            await this.reporter.update({
                level: 'waiting',
                phase: 'fishing',
                target: '刷新停滞的钓鱼页面',
                activeFeature: this.label,
                message: '连续 3 分钟没有收到成功鱼获，正在刷新页面恢复自动钓鱼。',
            });
            await this.session.captureScreenshot('no-fish-timeout');
            await this.session.bootstrap({ reload: true });
            this.reset();
            return true;
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
                await this.session.trustedClickRandomPosition(castButton);
                this.lastProgressAt = this.now();
                await this.reporter.incrementCast();
                await waitForCastButtonToLeaveReadyState(castButton);
            }
        } else if (
            this.now() - this.lastProgressAt >=
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
