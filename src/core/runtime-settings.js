import fs from 'node:fs/promises';
import path from 'node:path';

const SETTINGS_VERSION = 2;

function assertBoolean(value, field) {
    if (typeof value !== 'boolean') {
        throw new Error(`${field} 必须是布尔值。`);
    }
}

function assertDelay(value, field) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 60_000) {
        throw new Error(`${field} 必须是 0 到 60000 之间的整数。`);
    }
}

function assertInteger(value, field, { min, max, multipleOf = 1 }) {
    if (
        !Number.isSafeInteger(value) ||
        value < min ||
        value > max ||
        value % multipleOf !== 0
    ) {
        const multipleHint = multipleOf > 1
            ? `，且必须是 ${multipleOf} 的倍数`
            : '';

        throw new Error(
            `${field} 必须是 ${min} 到 ${max} 之间的整数${multipleHint}。`,
        );
    }
}

function assertString(value, field) {
    if (typeof value !== 'string' || value.length > 128) {
        throw new Error(`${field} 必须是长度不超过 128 的字符串。`);
    }
}

function clone(value) {
    return structuredClone(value);
}

export class RuntimeSettings {
    static migrate(saved) {
        if (
            saved == null ||
            typeof saved !== 'object' ||
            Array.isArray(saved)
        ) {
            throw new Error('运行设置必须是 JSON 对象。');
        }

        const version = saved.version ?? 1;

        if (version !== 1 && version !== SETTINGS_VERSION) {
            throw new Error(`不支持的运行设置版本：${version}。`);
        }

        return {
            ...saved,
            version: SETTINGS_VERSION,
        };
    }

    static async load(config) {
        const defaults = {
            version: SETTINGS_VERSION,
            automationEnabled: config.automationEnabled,
            features: {
                fishing: {
                    enabled: config.autoFishing,
                    enforceClassicMode: config.enforceClassicMode,
                    clickDelayMinMs: config.clickDelayMinMs,
                    clickDelayMaxMs: config.clickDelayMaxMs,
                },
                verification: {
                    enabled: config.autoVerify,
                },
                bait: {
                    enabled: config.autoBait,
                    selectedBaitId: config.baitId,
                    restockThreshold: config.baitRestockThreshold,
                    purchaseQuantity: config.baitPurchaseQuantity,
                    checkIntervalMs: config.baitCheckIntervalMs,
                },
            },
        };

        let saved = {};

        try {
            saved = JSON.parse(await fs.readFile(config.settingsFile, 'utf8'));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw new Error(`读取运行设置失败：${error.message}`);
            }
        }

        saved = RuntimeSettings.migrate(saved);

        const settings = {
            ...defaults,
            ...saved,
            version: SETTINGS_VERSION,
            features: {
                ...defaults.features,
                ...saved.features,
                fishing: {
                    ...defaults.features.fishing,
                    ...saved.features?.fishing,
                },
                verification: {
                    ...defaults.features.verification,
                    ...saved.features?.verification,
                },
                bait: {
                    ...defaults.features.bait,
                    ...saved.features?.bait,
                },
            },
        };

        RuntimeSettings.validate(settings);

        return new RuntimeSettings(config.settingsFile, settings);
    }

    static validate(settings) {
        assertBoolean(settings.automationEnabled, 'automationEnabled');
        assertBoolean(settings.features.fishing.enabled, 'fishing.enabled');
        assertBoolean(
            settings.features.verification.enabled,
            'verification.enabled',
        );
        assertBoolean(settings.features.bait.enabled, 'bait.enabled');
        assertString(
            settings.features.bait.selectedBaitId,
            'bait.selectedBaitId',
        );
        assertInteger(
            settings.features.bait.restockThreshold,
            'bait.restockThreshold',
            { min: 0, max: 999_999 },
        );
        assertInteger(
            settings.features.bait.purchaseQuantity,
            'bait.purchaseQuantity',
            { min: 100, max: 999_900, multipleOf: 100 },
        );
        assertInteger(
            settings.features.bait.checkIntervalMs,
            'bait.checkIntervalMs',
            { min: 5_000, max: 3_600_000 },
        );
        assertBoolean(
            settings.features.fishing.enforceClassicMode,
            'fishing.enforceClassicMode',
        );
        assertDelay(
            settings.features.fishing.clickDelayMinMs,
            'fishing.clickDelayMinMs',
        );
        assertDelay(
            settings.features.fishing.clickDelayMaxMs,
            'fishing.clickDelayMaxMs',
        );

        if (
            settings.features.fishing.clickDelayMinMs >
            settings.features.fishing.clickDelayMaxMs
        ) {
            throw new Error('最小点击延迟不能大于最大点击延迟。');
        }
    }

    constructor(settingsFile, settings) {
        this.settingsFile = settingsFile;
        this.value = settings;
        this.listeners = new Set();
    }

    get() {
        return clone(this.value);
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async update(patch) {
        const next = {
            ...this.value,
            ...patch,
            version: SETTINGS_VERSION,
            features: {
                ...this.value.features,
                ...patch.features,
                fishing: {
                    ...this.value.features.fishing,
                    ...patch.features?.fishing,
                },
                verification: {
                    ...this.value.features.verification,
                    ...patch.features?.verification,
                },
                bait: {
                    ...this.value.features.bait,
                    ...patch.features?.bait,
                },
            },
        };

        RuntimeSettings.validate(next);

        await fs.mkdir(path.dirname(this.settingsFile), {
            recursive: true,
        });
        await fs.writeFile(
            this.settingsFile,
            `${JSON.stringify(next, null, 2)}\n`,
            { mode: 0o600 },
        );

        this.value = next;
        const snapshot = this.get();

        for (const listener of this.listeners) {
            await listener(snapshot);
        }

        return snapshot;
    }
}
