import { sleep } from './browser-utils.js';
import {
    AUTOMATION_PAUSED_CODE,
    OPERATION_STATES,
    OperationScheduler,
} from './operation-scheduler.js';
import { SITE_MAINTENANCE_CODE } from './site-availability.js';

const MAINTENANCE_RETRY_MS = 60_000;

export class AutomationEngine {
    constructor({
        settings,
        reporter,
        session,
        browserLifecycle,
        onPageReady = null,
    }) {
        this.settings = settings;
        this.reporter = reporter;
        this.session = session;
        this.browserLifecycle = browserLifecycle;
        this.onPageReady = onPageReady;
        this.scheduler = new OperationScheduler(settings.get().schedule);
        this.features = [];
        this.stopRequested = false;
        this.consecutiveErrors = 0;
        this.started = false;
        this.browserSuspended = false;
        this.pageSetupInProgress = false;
        this.scheduleMode = null;
        this.activeCompetition = null;
        this.activePunishmentExpiresAt = null;
        this.maintenanceRetryAt = 0;
        this.quietOperationInProgress = false;
        this.quietGameAutoFishingStarted = false;
        this.quietGameAutoFishingActive = false;
    }

    register(feature) {
        if (this.features.some(candidate => candidate.id === feature.id)) {
            throw new Error(`自动化功能 ${feature.id} 已注册。`);
        }

        this.features.push(feature);
        this.features.sort((left, right) => left.priority - right.priority);
        return this;
    }

    isStopping() {
        return this.stopRequested;
    }

    getState() {
        return {
            scheduleMode: this.scheduleMode,
            browserSuspended: this.browserSuspended,
            pageReady: this.started,
            stopping: this.stopRequested,
            consecutiveErrors: this.consecutiveErrors,
            competition: this.activeCompetition,
            punishmentExpiresAt: this.activePunishmentExpiresAt,
            quietGameAutoFishing: {
                started: this.quietGameAutoFishingStarted,
                active: this.quietGameAutoFishingActive,
            },
        };
    }

    isOperationAllowed() {
        return (
            !this.stopRequested &&
            (
                this.scheduler.canOperateNow() ||
                this.quietOperationInProgress ||
                (
                    this.pageSetupInProgress &&
                    this.scheduler.mode === OPERATION_STATES.DISABLED &&
                    !this.scheduler.isQuietTime()
                )
            )
        );
    }

    async withQuietOperation(operation) {
        this.quietOperationInProgress = true;

        try {
            return await operation();
        } finally {
            this.quietOperationInProgress = false;
        }
    }

    shouldUseQuietGameAutoFishing(settings) {
        return Boolean(
            settings.automationEnabled &&
            settings.features.fishing?.enabled &&
            settings.schedule.quietEnabled &&
            settings.schedule.quietGameAutoFishingEnabled
        );
    }

    async stop(signal = 'stop') {
        if (this.stopRequested) {
            return;
        }

        this.stopRequested = true;
        await this.reporter.update({
            level: 'idle',
            phase: 'stopping',
            target: '关闭 Copilot',
            message: `收到 ${signal}，正在停止自动化。`,
        });
    }

    resetFeatures() {
        for (const feature of this.features) {
            feature.reset?.();
        }
    }

    async recover() {
        await this.session.captureScreenshot('recovery');
        await this.session.bootstrap({ reload: true });
        await this.onPageReady?.();
        this.resetFeatures();
        this.consecutiveErrors = 0;
        this.maintenanceRetryAt = 0;
        this.started = true;
    }

    async deferForMaintenance(error) {
        this.started = false;
        this.consecutiveErrors = 0;
        this.maintenanceRetryAt = Date.now() + MAINTENANCE_RETRY_MS;

        await this.reporter.update({
            level: 'waiting',
            phase: 'page',
            target: '等待站点维护结束',
            message: `${error.message} 将在 1 分钟后重新检查。`,
        });
        await sleep(250);
    }

    async waitForMaintenanceRetry() {
        const waitMs = this.maintenanceRetryAt - Date.now();

        if (waitMs <= 0) {
            return false;
        }

        await sleep(Math.min(waitMs, 5_000));
        return true;
    }

    formatLocalTime(date) {
        const pad = value => String(value).padStart(2, '0');

        return [
            `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
            `${pad(date.getHours())}:${pad(date.getMinutes())}`,
        ].join(' ');
    }

    describeCompetition(competition) {
        if (competition.type === 'world-boss') {
            return competition.label;
        }

        return `${competition.label} #${competition.number || competition.id}`;
    }

    async waitForSchedule(gate) {
        const isQuiet = gate.mode === OPERATION_STATES.QUIET;
        const target = isQuiet
            ? '等待夜间停挂机结束'
            : '挂机休息中';
        const message = isQuiet
            ? `本地时间 ${String(gate.quietStartHour).padStart(2, '0')}:00 起进入夜间休息；已参与赛事会按记录的开始时间临时唤醒，常规挂机将于 ${this.formatLocalTime(gate.resumeAt)} 恢复。`
            : `本轮休息 ${gate.durationMinutes} 分钟，将于 ${this.formatLocalTime(gate.resumeAt)} 恢复。`;

        await this.reporter.update({
            level: 'waiting',
            phase: 'schedule',
            target,
            activeFeature: '挂机调度',
            message,
        }, { record: gate.transitioned });
        await sleep(Math.min(Math.max(gate.waitMs, 500), 5_000));
    }

    async suspendBrowserForQuiet() {
        await this.reporter.update({
            level: 'waiting',
            phase: 'schedule',
            target: '关闭夜间挂机页面',
            activeFeature: '挂机调度',
            message: '已进入夜间停挂机时段，正在关闭 Playwright 浏览器。',
        });
        await this.browserLifecycle.suspend();
        this.browserSuspended = true;
        this.started = false;
        this.resetFeatures();
    }

    async resumeBrowserForQuietGameAutoFishing() {
        await this.reporter.update({
            level: 'running',
            phase: 'schedule',
            target: '启动夜间游戏自动钓鱼',
            activeFeature: '夜间自动钓鱼',
            message: '正在重新创建 Playwright 页面并启用游戏内自动钓鱼。',
        });
        await this.browserLifecycle.resume();
        this.browserSuspended = false;
        await this.ensureStarted();
    }

    async waitForQuietGameAutoFishing(gate, state, { record = false } = {}) {
        const message = state.active
            ? `夜间休息期间由游戏内自动钓鱼接管${state.autoRenew ? '，会在每轮结束后自动续期' : '，本轮结束后不会续期'}；常规脚本将于 ${this.formatLocalTime(gate.resumeAt)} 恢复。`
            : `夜间游戏自动钓鱼暂未启动，可能仍在冷却或体力不足；常规脚本将于 ${this.formatLocalTime(gate.resumeAt)} 恢复。`;

        await this.reporter.update({
            level: 'waiting',
            phase: 'schedule',
            target: state.active
                ? '游戏内自动钓鱼运行中'
                : '等待游戏内自动钓鱼可用',
            activeFeature: '夜间自动钓鱼',
            message,
        }, { record });
        await sleep(5_000);
    }

    async runQuietGameAutoFishing(gate, settings) {
        const previousActive = this.quietGameAutoFishingActive;

        if (gate.transitioned) {
            this.quietGameAutoFishingStarted = false;
            this.quietGameAutoFishingActive = false;
            this.resetFeatures();
        }

        const state = await this.withQuietOperation(async () => {
            if (this.browserSuspended) {
                await this.resumeBrowserForQuietGameAutoFishing();
            } else if (!this.started) {
                await this.ensureStarted();
            }

            if (
                !this.quietGameAutoFishingStarted ||
                settings.schedule.quietGameAutoFishingAutoRenew
            ) {
                return this.session.ensureGameAutoFishingActive();
            }

            return this.session.getGameAutoFishingState();
        });

        this.quietGameAutoFishingActive = state.active === true;
        if (this.quietGameAutoFishingActive) {
            this.quietGameAutoFishingStarted = true;
        }

        await this.waitForQuietGameAutoFishing(gate, {
            active: this.quietGameAutoFishingActive,
            autoRenew: settings.schedule.quietGameAutoFishingAutoRenew,
        }, {
            record: gate.transitioned ||
                previousActive !== this.quietGameAutoFishingActive,
        });
    }

    async stopQuietGameAutoFishingIfNeeded({ force = false } = {}) {
        if (
            !force &&
            !this.quietGameAutoFishingStarted &&
            !this.quietGameAutoFishingActive
        ) {
            return;
        }

        if (!this.browserSuspended && this.started) {
            await this.reporter.update({
                level: 'running',
                phase: 'schedule',
                target: '恢复脚本自动钓鱼',
                activeFeature: '挂机调度',
                message: '夜间休息已结束，正在停止游戏内自动钓鱼并恢复脚本操作。',
            });
            await this.withQuietOperation(() =>
                this.session.stopGameAutoFishing(),
            );
        }

        this.quietGameAutoFishingStarted = false;
        this.quietGameAutoFishingActive = false;
        this.resetFeatures();
    }

    async resumeBrowserAfterQuiet(competition = null) {
        await this.reporter.update({
            level: 'running',
            phase: 'schedule',
            target: competition ? `参与${competition.label}` : '恢复挂机页面',
            activeFeature: '挂机调度',
            message: competition
                ? competition.type === 'world-boss'
                    ? '世界 Boss 已出现，正在重新创建 Playwright 页面并进入活动。'
                    : `${this.describeCompetition(competition)} 已开始，正在重新创建 Playwright 页面并进入 Biome ${competition.biomeId}。`
                : '夜间休息已结束，正在重新创建 Playwright 页面。',
        });
        await this.browserLifecycle.resume();
        this.browserSuspended = false;
        await this.ensureStarted();
    }

    async ensureStarted({ reload = false } = {}) {
        const firstStart = !this.started;

        this.pageSetupInProgress = true;

        try {
            await this.session.bootstrap({ reload });
            await this.onPageReady?.();
            this.maintenanceRetryAt = 0;
            this.started = true;
        } finally {
            this.pageSetupInProgress = false;
        }

        if (firstStart) {
            await this.reporter.update({
                level: 'running',
                phase: 'ready',
                target: '启动自动化功能',
                message: `已加载 ${this.features.length} 个自动化功能。`,
            });
        }
    }

    async waitForActivePunishment(settings) {
        const punishmentExpiresAt =
            this.session.getActivePunishmentExpiresAt?.() || null;

        if (!punishmentExpiresAt) {
            if (this.activePunishmentExpiresAt) {
                this.activePunishmentExpiresAt = null;
                this.resetFeatures();
                await this.reporter.update({
                    level: 'running',
                    phase: 'fishing',
                    target: '恢复自动化',
                    activeFeature: '收益保护',
                    message: '游戏的零收益处罚已结束，恢复自动操作。',
                });
            }

            return false;
        }

        const transitioned =
            this.activePunishmentExpiresAt !== punishmentExpiresAt;

        this.activePunishmentExpiresAt = punishmentExpiresAt;
        await this.reporter.update({
            level: 'waiting',
            phase: 'fishing',
            target: '等待零收益处罚结束',
            activeFeature: '收益保护',
            message: `游戏返回了 Softban 标记；金币和经验为 0，已暂停页面操作至 ${this.formatLocalTime(new Date(punishmentExpiresAt))}，避免继续消耗鱼饵。`,
        }, { record: transitioned });
        await sleep(settings.advanced.pollIntervalMs);
        return true;
    }

    async runCycle() {
        const settings = this.settings.get();
        this.scheduler.updateConfig(settings.schedule);
        const enabledFeatures = this.features.filter(feature =>
            feature.isEnabled(settings),
        );
        const competitions = (this.session.getCompetitionSchedule?.() || [])
            .filter(competition =>
                competition.type !== 'world-boss' ||
                settings.features.worldBoss?.enabled !== false,
            );
        const gate = this.scheduler.evaluate({
            enabled: settings.automationEnabled && enabledFeatures.length > 0,
            competitions,
        });
        const previousMode = this.scheduleMode;

        this.scheduleMode = gate.mode;
        this.activeCompetition = gate.competition || null;

        if (gate.mode === OPERATION_STATES.QUIET) {
            if (this.shouldUseQuietGameAutoFishing(settings)) {
                if (await this.waitForActivePunishment(settings)) {
                    return;
                }

                await this.runQuietGameAutoFishing(gate, settings);
                return;
            }

            await this.stopQuietGameAutoFishingIfNeeded({
                force: previousMode === OPERATION_STATES.QUIET &&
                    !this.browserSuspended,
            });
            if (gate.transitioned || !this.browserSuspended) {
                await this.suspendBrowserForQuiet();
            }

            await this.waitForSchedule(gate);
            return;
        }

        await this.stopQuietGameAutoFishingIfNeeded({
            force: previousMode === OPERATION_STATES.QUIET &&
                !this.browserSuspended,
        });

        if (gate.mode === OPERATION_STATES.REST) {
            await this.waitForSchedule(gate);
            return;
        }

        if (this.browserSuspended) {
            await this.resumeBrowserAfterQuiet(gate.competition);
        }

        if (this.started && this.session.isClosed?.()) {
            this.started = false;
            throw new Error('Playwright 页面意外关闭。');
        }

        if (!this.started && await this.waitForMaintenanceRetry()) {
            return;
        }

        if (!this.started && gate.mode === OPERATION_STATES.DISABLED) {
            await this.ensureStarted();
        }

        if (!settings.automationEnabled) {
            await this.reporter.update({
                level: 'paused',
                phase: 'paused',
                target: '等待配置开启自动化',
                message: '自动化已暂停；可通过 Web 控制台恢复。',
            });
            await sleep(500);
            return;
        }

        if (enabledFeatures.length === 0) {
            await this.reporter.update({
                level: 'paused',
                phase: 'paused',
                target: '等待启用自动化功能',
                message: '当前没有启用的自动化功能；可在 Web 控制台修改配置。',
            });
            await sleep(500);
            return;
        }

        if (gate.transitioned) {
            this.resetFeatures();

            if (!this.started) {
                await this.ensureStarted();
            }

            if (gate.mode === OPERATION_STATES.COMPETITION) {
                await this.reporter.update({
                    level: 'running',
                    phase: 'schedule',
                    target: `正在参与${gate.competition.label}`,
                    activeFeature: '赛事调度',
                    message: `${this.describeCompetition(gate.competition)} 优先运行至 ${this.formatLocalTime(gate.until)}；期间不进入长暂停或挂机休息。`,
                });
            } else {
                await this.reporter.update({
                    level: 'running',
                    phase: 'schedule',
                    target: '本轮挂机运行中',
                    activeFeature: '挂机调度',
                    message: `本轮计划运行 ${gate.durationMinutes} 分钟，预计于 ${this.formatLocalTime(gate.until)} 休息。`,
                });
            }
        } else if (!this.started) {
            await this.ensureStarted();
        } else if (previousMode !== gate.mode) {
            this.resetFeatures();
        }

        if (await this.waitForActivePunishment(settings)) {
            return;
        }

        for (const feature of enabledFeatures) {
            if (await feature.tick(settings)) {
                this.consecutiveErrors = 0;
                return;
            }
        }

        await sleep(settings.advanced.pollIntervalMs);
    }

    async start() {
        while (!this.stopRequested) {
            try {
                await this.runCycle();
            } catch (error) {
                if (this.stopRequested) {
                    break;
                }

                if (error.code === AUTOMATION_PAUSED_CODE) {
                    this.consecutiveErrors = 0;
                    await sleep(250);
                    continue;
                }

                if (error.code === SITE_MAINTENANCE_CODE) {
                    await this.deferForMaintenance(error);
                    continue;
                }

                this.consecutiveErrors += 1;
                const settings = this.settings.get();
                await this.reporter.update({
                    level: 'error',
                    phase: 'recovery',
                    target: '恢复自动化',
                    message: `自动化异常（${this.consecutiveErrors}/${settings.advanced.recoveryErrorCount}）：${error.message}`,
                });

                if (
                    this.consecutiveErrors >=
                    settings.advanced.recoveryErrorCount
                ) {
                    try {
                        if (
                            this.scheduleMode === OPERATION_STATES.QUIET &&
                            this.shouldUseQuietGameAutoFishing(
                                this.settings.get(),
                            )
                        ) {
                            await this.withQuietOperation(() => this.recover());
                        } else {
                            await this.recover();
                        }
                    } catch (recoveryError) {
                        if (recoveryError.code === AUTOMATION_PAUSED_CODE) {
                            this.consecutiveErrors = 0;
                            await sleep(250);
                            continue;
                        }

                        if (recoveryError.code === SITE_MAINTENANCE_CODE) {
                            await this.deferForMaintenance(recoveryError);
                            continue;
                        }

                        if (this.session.isClosed?.()) {
                            throw recoveryError;
                        }

                        this.started = false;
                        this.consecutiveErrors = 0;
                        await this.reporter.update({
                            level: 'error',
                            phase: 'recovery',
                            target: '等待下一次恢复',
                            message: `页面恢复失败，将重新尝试：${recoveryError.message}`,
                        });
                        await sleep(5_000);
                    }
                } else {
                    await sleep(1_000);
                }
            }
        }
    }
}
