import { sleep } from './browser-utils.js';

export class AutomationEngine {
    constructor({ config, settings, reporter, session }) {
        this.config = config;
        this.settings = settings;
        this.reporter = reporter;
        this.session = session;
        this.features = [];
        this.stopRequested = false;
        this.consecutiveErrors = 0;
        this.started = false;
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
        this.resetFeatures();
        this.consecutiveErrors = 0;
        this.started = true;
    }

    async runCycle() {
        const settings = this.settings.get();

        if (!settings.automationEnabled) {
            await this.reporter.update({
                level: 'paused',
                phase: 'paused',
                target: '等待用户开启自动化',
                message: '自动化已在页面面板中暂停。',
            }, { record: false });
            await sleep(500);
            return;
        }

        const enabledFeatures = this.features.filter(feature =>
            feature.isEnabled(settings),
        );

        if (enabledFeatures.length === 0) {
            await this.reporter.update({
                level: 'paused',
                phase: 'paused',
                target: '等待启用自动化功能',
                message: '当前没有启用的自动化功能。',
            }, { record: false });
            await sleep(500);
            return;
        }

        for (const feature of enabledFeatures) {
            if (await feature.tick(settings)) {
                this.consecutiveErrors = 0;
                return;
            }
        }

        await sleep(this.config.pollIntervalMs);
    }

    async start() {
        while (!this.stopRequested) {
            try {
                if (!this.started) {
                    await this.session.bootstrap();
                    this.started = true;
                    await this.reporter.update({
                        level: 'running',
                        phase: 'ready',
                        target: '启动自动化功能',
                        message: `已加载 ${this.features.length} 个自动化功能。`,
                    });
                }

                await this.runCycle();
            } catch (error) {
                if (this.stopRequested) {
                    break;
                }

                this.consecutiveErrors += 1;
                await this.reporter.update({
                    level: 'error',
                    phase: 'recovery',
                    target: '恢复自动化',
                    message: `自动化异常（${this.consecutiveErrors}/${this.config.recoveryErrorCount}）：${error.message}`,
                });

                if (
                    this.consecutiveErrors >=
                    this.config.recoveryErrorCount
                ) {
                    try {
                        await this.recover();
                    } catch (recoveryError) {
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
