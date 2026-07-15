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
    map: '自动地图',
    fishing: '自动钓鱼',
    bait: '自动鱼饵',
    verification: '人机验证',
    web: 'Web 控制面',
    control: 'Worker 控制器',
    page: '游戏页面',
});

export class StatusReporter {
    constructor({
        logger = console,
        now = () => new Date(),
        logStore = null,
    } = {}) {
        this.logger = logger;
        this.now = now;
        this.logStore = logStore;
        this.statusListeners = new Set();
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

    getLogs(options) {
        return this.logStore?.get(options) || [];
    }

    subscribeStatus(listener) {
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
    }

    subscribeLogs(listener) {
        return this.logStore?.subscribe(listener) || (() => {});
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
            await this.write(next);
        }

        this.value = next;
        const snapshot = this.get();

        for (const listener of this.statusListeners) {
            try {
                listener(snapshot);
            } catch {
                // 控制面订阅者失败不能影响自动化状态更新。
            }
        }

        return snapshot;
    }

    async write(status) {
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

        await this.logStore?.append(status);
    }

    async log(patch) {
        const phaseFeature = patch.phase
            ? FEATURE_BY_PHASE[patch.phase]
            : null;
        const entry = {
            ...this.value,
            ...patch,
            activeFeature: patch.activeFeature ||
                phaseFeature ||
                this.value.activeFeature,
            updatedAt: this.now().toISOString(),
        };

        await this.write(entry);
        return structuredClone(entry);
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
