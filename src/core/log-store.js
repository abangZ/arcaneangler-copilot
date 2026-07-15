import fs from 'node:fs/promises';
import path from 'node:path';

function logFileName(timestamp) {
    return `${timestamp.slice(0, 10)}.jsonl`;
}

export class LogStore {
    constructor({ directory, maxEntries = 2_000, retentionDays = 7 }) {
        this.directory = directory;
        this.maxEntries = maxEntries;
        this.retentionDays = retentionDays;
        this.entries = [];
        this.nextId = 1;
        this.listeners = new Set();
        this.writeQueue = Promise.resolve();
        this.lastRetentionCheckFile = null;
    }

    async listLogFiles() {
        return (await fs.readdir(this.directory))
            .filter(file => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))
            .sort();
    }

    async pruneExpiredFiles() {
        const files = await this.listLogFiles();
        const retainedFiles = files.slice(-this.retentionDays);
        const expiredFiles = files.slice(0, -this.retentionDays);

        await Promise.all(expiredFiles.map(file =>
            fs.unlink(path.join(this.directory, file)).catch(() => {}),
        ));
        return retainedFiles;
    }

    async initialize() {
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
        await fs.chmod(this.directory, 0o700);

        const retainedFiles = await this.pruneExpiredFiles();

        this.lastRetentionCheckFile = retainedFiles.at(-1) || null;

        for (const file of retainedFiles) {
            await fs.chmod(path.join(this.directory, file), 0o600)
                .catch(() => {});
            const content = await fs.readFile(
                path.join(this.directory, file),
                'utf8',
            );

            for (const line of content.split('\n')) {
                if (!line) {
                    continue;
                }

                try {
                    const entry = JSON.parse(line);

                    if (Number.isSafeInteger(entry.id)) {
                        this.entries.push(entry);
                        this.nextId = Math.max(this.nextId, entry.id + 1);
                    }
                } catch {
                    // 忽略单条损坏日志，避免控制面因历史文件无法启动。
                }
            }

            this.entries = this.entries.slice(-this.maxEntries);
        }

        this.entries = this.entries.slice(-this.maxEntries);
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    get({ afterId = 0, limit = this.maxEntries } = {}) {
        return this.entries
            .filter(entry => entry.id > afterId)
            .slice(-limit)
            .map(entry => structuredClone(entry));
    }

    async append(entry) {
        const storedEntry = {
            ...structuredClone(entry),
            id: this.nextId,
        };

        this.nextId += 1;
        this.entries.push(storedEntry);
        this.entries = this.entries.slice(-this.maxEntries);

        const fileName = logFileName(storedEntry.updatedAt);
        const filePath = path.join(this.directory, fileName);
        const line = `${JSON.stringify(storedEntry)}\n`;

        this.writeQueue = this.writeQueue
            .then(async () => {
                await fs.appendFile(filePath, line, { mode: 0o600 });
                await fs.chmod(filePath, 0o600);

                if (this.lastRetentionCheckFile !== fileName) {
                    await this.pruneExpiredFiles();
                    this.lastRetentionCheckFile = fileName;
                }
            })
            .catch(() => {});
        await this.writeQueue;

        for (const listener of this.listeners) {
            try {
                listener(structuredClone(storedEntry));
            } catch {
                // SSE 客户端断开不能影响日志写入和自动化执行。
            }
        }

        return structuredClone(storedEntry);
    }
}
