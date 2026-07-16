import { settingsRequireWorkerRestart } from './settings-schema.js';

const WORKER_MODES = Object.freeze({
    STOPPED: 'stopped',
    STARTING: 'starting',
    RUNNING: 'running',
    PAUSING: 'pausing',
    PAUSED: 'paused',
    STOPPING: 'stopping',
    ERROR: 'error',
});

class WorkerStateError extends Error {
    constructor(message) {
        super(message);
        this.name = 'WorkerStateError';
        this.statusCode = 409;
    }
}

function requireGearId(value) {
    const id = String(value ?? '').trim();

    if (!id || id.length > 128) {
        throw new WorkerStateError('装备 ID 无效，请刷新装备列表后重试。');
    }

    return id;
}

function requireGearIds(value) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new WorkerStateError('请至少选择一件要出售的装备。');
    }

    if (value.length > 500) {
        throw new WorkerStateError('单次最多批量出售 500 件装备。');
    }

    const ids = value.map(requireGearId);

    if (new Set(ids).size !== ids.length) {
        throw new WorkerStateError('出售列表中包含重复装备。');
    }

    return ids;
}

export class WorkerController {
    constructor({ settingsStore, reporter, createWorker, now = () => new Date() }) {
        this.settingsStore = settingsStore;
        this.reporter = reporter;
        this.createWorker = createWorker;
        this.now = now;
        this.worker = null;
        this.listeners = new Set();
        this.commandQueue = Promise.resolve();
        this.value = {
            mode: WORKER_MODES.STOPPED,
            startedAt: null,
            lastError: null,
            updatedAt: this.now().toISOString(),
        };
    }

    getState() {
        const engine = this.worker?.getState() || null;
        let browser = 'closed';

        if (this.value.mode === WORKER_MODES.STARTING) {
            browser = 'starting';
        } else if (engine?.browserSuspended) {
            browser = 'suspended';
        } else if (engine?.browserOpen) {
            browser = 'open';
        }

        return structuredClone({
            ...this.value,
            browser,
            engine,
        });
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    setState(patch) {
        this.value = {
            ...this.value,
            ...patch,
            updatedAt: this.now().toISOString(),
        };
        const snapshot = this.getState();

        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            } catch {
                // 控制面订阅者失败不能影响 Worker 生命周期。
            }
        }

        return snapshot;
    }

    enqueue(command) {
        const result = this.commandQueue.then(command, command);

        this.commandQueue = result.catch(() => {});
        return result;
    }

    async start() {
        return this.enqueue(() => this.startUnlocked());
    }

    async startUnlocked() {
        const stored = this.settingsStore.get();

        if (!stored.configured) {
            throw new WorkerStateError('请先保存网页配置，再启动自动化。');
        }

        if (
            this.value.mode === WORKER_MODES.RUNNING ||
            this.value.mode === WORKER_MODES.STARTING
        ) {
            return this.getState();
        }

        this.setState({
            mode: WORKER_MODES.STARTING,
            lastError: null,
        });

        const worker = this.createWorker();
        this.worker = worker;

        try {
            await worker.start();
        } catch (error) {
            await worker.stop('start-failed').catch(() => {});
            this.worker = null;
            this.setState({
                mode: WORKER_MODES.ERROR,
                lastError: error.message,
            });
            await this.reporter.update({
                level: 'error',
                phase: 'control',
                target: '启动 Playwright Worker',
                message: `Worker 启动失败：${error.message}`,
            });
            throw error;
        }

        this.setState({
            mode: WORKER_MODES.RUNNING,
            startedAt: this.now().toISOString(),
            lastError: null,
        });
        await this.reporter.update({
            level: 'running',
            phase: 'control',
            target: '运行 Playwright Worker',
            message: 'Playwright Worker 已启动。',
        });

        void this.monitor(worker);
        return this.getState();
    }

    async monitor(worker) {
        try {
            await worker.completion();

            if (
                this.worker === worker &&
                this.value.mode === WORKER_MODES.RUNNING
            ) {
                await worker.stop('worker-ended').catch(() => {});
                this.worker = null;
                this.setState({ mode: WORKER_MODES.STOPPED });
            }
        } catch (error) {
            if (this.worker !== worker) {
                return;
            }

            await worker.stop('worker-error').catch(() => {});
            this.worker = null;
            this.setState({
                mode: WORKER_MODES.ERROR,
                lastError: error.message,
            });
            await this.reporter.update({
                level: 'error',
                phase: 'control',
                target: '监控 Playwright Worker',
                message: `Worker 异常退出：${error.message}`,
            });
        }
    }

    async pause() {
        return this.enqueue(async () => {
            if (this.value.mode === WORKER_MODES.PAUSED) {
                return this.getState();
            }

            if (this.value.mode !== WORKER_MODES.RUNNING) {
                throw new WorkerStateError('只有运行中的 Worker 可以暂停。');
            }

            return this.stopUnlocked({
                transitionMode: WORKER_MODES.PAUSING,
                finalMode: WORKER_MODES.PAUSED,
                signal: 'manual-pause',
                message: '自动化已手动暂停，Playwright 浏览器已关闭。',
            });
        });
    }

    async resume() {
        return this.enqueue(async () => {
            if (this.value.mode !== WORKER_MODES.PAUSED) {
                throw new WorkerStateError('只有已暂停的 Worker 可以恢复。');
            }

            return this.startUnlocked();
        });
    }

    async stop() {
        return this.enqueue(async () => {
            if (this.value.mode === WORKER_MODES.STOPPED) {
                return this.getState();
            }

            return this.stopUnlocked({
                transitionMode: WORKER_MODES.STOPPING,
                finalMode: WORKER_MODES.STOPPED,
                signal: 'manual-stop',
                message: '自动化已停止，Playwright 浏览器已关闭。',
            });
        });
    }

    async restart() {
        return this.enqueue(async () => {
            if (this.value.mode !== WORKER_MODES.RUNNING) {
                throw new WorkerStateError('只有运行中的 Worker 可以重启。');
            }

            await this.stopUnlocked({
                transitionMode: WORKER_MODES.STOPPING,
                finalMode: WORKER_MODES.STOPPED,
                signal: 'manual-restart',
                message: '正在重启 Playwright Worker。',
            });
            return this.startUnlocked();
        });
    }

    requireGearWorker() {
        if (this.value.mode !== WORKER_MODES.RUNNING || !this.worker) {
            throw new WorkerStateError(
                '请先启动自动化，再使用装备管理。',
            );
        }

        const workerState = this.worker.getState();

        if (
            !workerState.browserOpen ||
            workerState.browserSuspended ||
            workerState.pageReady === false
        ) {
            throw new WorkerStateError(
                'Playwright 浏览器当前已关闭，请等待调度恢复后再管理装备。',
            );
        }

        return this.worker;
    }

    async getGearInventory() {
        return this.enqueue(() =>
            this.requireGearWorker().getGearInventory());
    }

    async equipGear({ gearId, targetSlot = null } = {}) {
        const normalizedGearId = requireGearId(gearId);
        const normalizedTargetSlot = targetSlot == null || targetSlot === ''
            ? null
            : String(targetSlot);

        if (
            normalizedTargetSlot &&
            !['ring_1', 'ring_2'].includes(normalizedTargetSlot)
        ) {
            throw new WorkerStateError('戒指槽位只能是 ring_1 或 ring_2。');
        }

        return this.enqueue(async () => {
            try {
                return await this.requireGearWorker().equipGear({
                    gearId: normalizedGearId,
                    targetSlot: normalizedTargetSlot,
                });
            } catch (error) {
                error.statusCode ||= 409;
                throw error;
            }
        });
    }

    async sellGears(gearIds) {
        const normalizedGearIds = requireGearIds(gearIds);

        return this.enqueue(async () => {
            try {
                return await this.requireGearWorker().sellGears(
                    normalizedGearIds,
                );
            } catch (error) {
                error.statusCode ||= 409;
                throw error;
            }
        });
    }

    async stopUnlocked({ transitionMode, finalMode, signal, message }) {
        const worker = this.worker;

        this.setState({ mode: transitionMode });
        await worker?.stop(signal);

        if (this.worker === worker) {
            this.worker = null;
        }

        this.setState({
            mode: finalMode,
            startedAt: null,
        });
        await this.reporter.update({
            level: finalMode === WORKER_MODES.PAUSED ? 'paused' : 'idle',
            phase: 'control',
            target: finalMode === WORKER_MODES.PAUSED
                ? '等待手动恢复'
                : '等待手动启动',
            message,
        });
        return this.getState();
    }

    async applySettings(previous, current) {
        return this.enqueue(async () => {
            if (
                this.value.mode === WORKER_MODES.RUNNING &&
                settingsRequireWorkerRestart(
                    previous.settings,
                    current.settings,
                )
            ) {
                await this.reporter.update({
                    level: 'running',
                    phase: 'control',
                    target: '应用浏览器配置',
                    message: '会话级配置已变化，正在自动重建 Worker。',
                });
                await this.stopUnlocked({
                    transitionMode: WORKER_MODES.STOPPING,
                    finalMode: WORKER_MODES.STOPPED,
                    signal: 'settings-restart',
                    message: '旧 Worker 已停止，正在应用新配置。',
                });
                await this.startUnlocked();
            } else {
                await this.reporter.update({
                    level: this.value.mode === WORKER_MODES.RUNNING
                        ? 'running'
                        : 'idle',
                    phase: 'control',
                    target: '应用网页配置',
                    message: this.value.mode === WORKER_MODES.RUNNING
                        ? '配置已保存，将从下一轮调度开始生效。'
                        : '配置已保存，可以启动自动化。',
                });
            }

            return this.getState();
        });
    }
}
