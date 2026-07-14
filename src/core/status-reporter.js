const HISTORY_LIMIT = 8;

export class StatusReporter {
    constructor() {
        this.listeners = new Set();
        this.value = {
            level: 'idle',
            phase: 'starting',
            target: '启动 Copilot',
            message: '正在初始化浏览器自动化。',
            activeFeature: '自动钓鱼',
            castCount: 0,
            updatedAt: new Date().toISOString(),
            history: [],
        };
    }

    get() {
        return structuredClone(this.value);
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async update(patch, { record = true } = {}) {
        if (
            !record &&
            Object.entries(patch).every(
                ([key, value]) => this.value[key] === value,
            )
        ) {
            return this.get();
        }

        const updatedAt = new Date().toISOString();
        const next = {
            ...this.value,
            ...patch,
            updatedAt,
        };

        if (record && patch.message) {
            next.history = [
                {
                    at: updatedAt,
                    level: patch.level || next.level,
                    message: patch.message,
                },
                ...this.value.history,
            ].slice(0, HISTORY_LIMIT);

            console.log(`[${updatedAt}] ${patch.message}`);
        }

        this.value = next;
        const snapshot = this.get();

        for (const listener of this.listeners) {
            await listener(snapshot);
        }

        return snapshot;
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
