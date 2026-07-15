const FEATURE_BY_PHASE = Object.freeze({
    starting: '挂机服务',
    ready: '挂机服务',
    stopping: '挂机服务',
    schedule: '挂机调度',
    paused: '挂机调度',
    recovery: '恢复机制',
    login: '账号登录',
    character: '角色选择',
    reward: '每日奖励',
    navigation: '页面导航',
    settings: '自动钓鱼',
    fishing: '自动钓鱼',
    bait: '自动鱼饵',
    verification: '人机验证',
});

export class StatusReporter {
    constructor({ logger = console, now = () => new Date() } = {}) {
        this.logger = logger;
        this.now = now;
        this.value = {
            level: 'idle',
            phase: 'starting',
            target: '启动 Copilot',
            message: '正在初始化浏览器自动化。',
            activeFeature: '挂机服务',
            castCount: 0,
            updatedAt: this.now().toISOString(),
        };
    }

    get() {
        return structuredClone(this.value);
    }

    async update(patch, { record = true } = {}) {
        const phaseFeature = patch.phase
            ? FEATURE_BY_PHASE[patch.phase]
            : null;
        const normalizedPatch = patch.activeFeature == null && phaseFeature
            ? { ...patch, activeFeature: phaseFeature }
            : patch;

        if (
            Object.entries(normalizedPatch).every(
                ([key, value]) => this.value[key] === value,
            )
        ) {
            return this.get();
        }

        const updatedAt = this.now().toISOString();
        const next = {
            ...this.value,
            ...normalizedPatch,
            updatedAt,
        };

        if (record && normalizedPatch.message) {
            this.write(next);
        }

        this.value = next;
        return this.get();
    }

    write(status) {
        const line = [
            `[${status.updatedAt}]`,
            `[${status.level.toUpperCase()}/${status.phase}]`,
            `[${status.activeFeature}]`,
            `目标：${status.target}`,
            status.message,
            `抛竿：${status.castCount}`,
        ].join(' ');

        if (status.level === 'error') {
            this.logger.error(line);
        } else {
            this.logger.log(line);
        }
    }

    async incrementCast() {
        return this.update({
            level: 'running',
            phase: 'fishing',
            target: '等待下一次抛竿',
            castCount: this.value.castCount + 1,
            message: `完成第 ${this.value.castCount + 1} 次抛竿。`,
        });
    }
}
