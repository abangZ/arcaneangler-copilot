import { sleep } from './browser-utils.js';
import {
    AUTOMATION_PAUSED_CODE,
    OPERATION_STATES,
    OperationScheduler,
} from './operation-scheduler.js';

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
        };
    }

    isOperationAllowed() {
        return (
            !this.stopRequested &&
            (
                this.scheduler.canOperateNow() ||
                (
                    this.pageSetupInProgress &&
                    this.scheduler.mode === OPERATION_STATES.DISABLED &&
                    !this.scheduler.isQuietTime()
                )
            )
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
        this.started = true;
    }

    formatLocalTime(date) {
        const pad = value => String(value).padStart(2, '0');

        return [
            `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
            `${pad(date.getHours())}:${pad(date.getMinutes())}`,
        ].join(' ');
    }

    async waitForSchedule(gate) {
        const isQuiet = gate.mode === OPERATION_STATES.QUIET;
        const target = isQuiet
            ? '等待夜间停挂机结束'
            : '挂机休息中';
        const message = isQuiet
            ? `本地时间 ${String(gate.quietStartHour).padStart(2, '0')}:00-${String(gate.quietEndHour).padStart(2, '0')}:00 不执行自动操作，将于 ${this.formatLocalTime(gate.resumeAt)} 恢复。`
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

    async resumeBrowserAfterQuiet() {
        await this.reporter.update({
            level: 'running',
            phase: 'schedule',
            target: '恢复挂机页面',
            activeFeature: '挂机调度',
            message: '夜间停挂机已结束，正在重新创建 Playwright 页面。',
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

    async runCycle() {
        const settings = this.settings.get();
        this.scheduler.updateConfig(settings.schedule);
        const enabledFeatures = this.features.filter(feature =>
            feature.isEnabled(settings),
        );
        const gate = this.scheduler.evaluate({
            enabled: settings.automationEnabled && enabledFeatures.length > 0,
        });
        const previousMode = this.scheduleMode;

        this.scheduleMode = gate.mode;

        if (gate.mode === OPERATION_STATES.QUIET) {
            if (gate.transitioned || !this.browserSuspended) {
                await this.suspendBrowserForQuiet();
            }

            await this.waitForSchedule(gate);
            return;
        }

        if (gate.mode === OPERATION_STATES.REST) {
            await this.waitForSchedule(gate);
            return;
        }

        if (this.browserSuspended) {
            await this.resumeBrowserAfterQuiet();
        }

        if (this.started && this.session.isClosed?.()) {
            this.started = false;
            throw new Error('Playwright 页面意外关闭。');
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

            await this.reporter.update({
                level: 'running',
                phase: 'schedule',
                target: '本轮挂机运行中',
                activeFeature: '挂机调度',
                message: `本轮计划运行 ${gate.durationMinutes} 分钟，预计于 ${this.formatLocalTime(gate.until)} 休息。`,
            });
        } else if (!this.started) {
            await this.ensureStarted();
        } else if (previousMode !== OPERATION_STATES.ACTIVE) {
            this.resetFeatures();
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
                        await this.recover();
                    } catch (recoveryError) {
                        if (recoveryError.code === AUTOMATION_PAUSED_CODE) {
                            this.consecutiveErrors = 0;
                            await sleep(250);
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
