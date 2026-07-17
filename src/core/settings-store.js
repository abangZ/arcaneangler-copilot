import fs from 'node:fs/promises';
import path from 'node:path';

import {
    DEFAULT_SETTINGS,
    SETTINGS_VERSION,
    SettingsValidationError,
    validateSettings,
} from './settings-schema.js';

function clone(value) {
    return structuredClone(value);
}

function migrateLegacyDefaults(settings) {
    const fishing = settings?.features?.fishing;
    const schedule = settings?.schedule;
    const map = settings?.features?.map;
    const worldBoss = settings?.features?.worldBoss;
    const bait = settings?.features?.bait;
    let migrated = settings;

    const ensureClone = () => {
        if (migrated === settings) {
            migrated = clone(settings);
        }
    };

    if (
        fishing?.clickDelayMinMs === 250 &&
        fishing?.clickDelayMaxMs === 800
    ) {
        ensureClone();
        migrated.features.fishing.clickDelayMinMs =
            DEFAULT_SETTINGS.features.fishing.clickDelayMinMs;
        migrated.features.fishing.clickDelayMaxMs =
            DEFAULT_SETTINGS.features.fishing.clickDelayMaxMs;
    }

    if (map && typeof map.prioritizeTournament !== 'boolean') {
        ensureClone();

        migrated.features.map.prioritizeTournament = true;
    }

    if (!worldBoss || typeof worldBoss.enabled !== 'boolean') {
        ensureClone();

        migrated.features.worldBoss = clone(
            DEFAULT_SETTINGS.features.worldBoss,
        );
    }

    if (
        bait &&
        (
            !Object.hasOwn(bait, 'guildTournamentBaitTier') ||
            !Object.hasOwn(bait, 'derbyBaitTier')
        )
    ) {
        ensureClone();

        const legacyBaitTier = Number.isSafeInteger(bait.selectedBaitTier)
            ? bait.selectedBaitTier
            : DEFAULT_SETTINGS.features.bait.selectedBaitTier;

        if (!Object.hasOwn(bait, 'guildTournamentBaitTier')) {
            migrated.features.bait.guildTournamentBaitTier = legacyBaitTier;
        }
        if (!Object.hasOwn(bait, 'derbyBaitTier')) {
            migrated.features.bait.derbyBaitTier = legacyBaitTier;
        }
    }

    if (schedule) {
        for (const key of [
            'quietEnabled',
            'quietGameAutoFishingEnabled',
            'quietGameAutoFishingAutoRenew',
        ]) {
            if (!Object.hasOwn(schedule, key)) {
                ensureClone();
                migrated.schedule[key] = DEFAULT_SETTINGS.schedule[key];
            }
        }
    }

    if (fishing) {
        for (const key of [
            'shortPauseEnabled',
            'shortPauseChancePercent',
            'shortPauseMinMs',
            'shortPauseMaxMs',
            'longPauseEnabled',
            'longPauseChancePercent',
            'longPauseMinMs',
            'longPauseMaxMs',
        ]) {
            if (!Object.hasOwn(fishing, key)) {
                ensureClone();
                migrated.features.fishing[key] =
                    DEFAULT_SETTINGS.features.fishing[key];
            }
        }
    }

    return migrated;
}

export class SettingsRevisionError extends Error {
    constructor() {
        super('配置已被其他页面修改，请刷新后重试。');
        this.name = 'SettingsRevisionError';
        this.statusCode = 409;
    }
}

export class SettingsStore {
    constructor({ filePath }) {
        this.filePath = filePath;
        this.listeners = new Set();
        this.updateQueue = Promise.resolve();
        this.value = {
            version: SETTINGS_VERSION,
            configured: false,
            revision: 0,
            settings: DEFAULT_SETTINGS,
        };
        this.loadError = null;
    }

    async initialize() {
        const directory = path.dirname(this.filePath);

        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        await fs.chmod(directory, 0o700);

        try {
            const raw = await fs.readFile(this.filePath, 'utf8');
            const stored = JSON.parse(raw);

            if (stored.version !== SETTINGS_VERSION) {
                throw new SettingsValidationError(
                    `不支持的配置版本 ${stored.version}。`,
                );
            }

            const migratedSettings = migrateLegacyDefaults(stored.settings);

            this.value = {
                version: SETTINGS_VERSION,
                configured: stored.configured === true,
                revision: Number.isSafeInteger(stored.revision) &&
                    stored.revision >= 0
                    ? stored.revision
                    : 0,
                settings: validateSettings(migratedSettings),
            };

            if (migratedSettings === stored.settings) {
                await fs.chmod(this.filePath, 0o600);
            } else {
                await this.write(this.value);
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.loadError = error.message;
            }
        }

        return this.get();
    }

    get() {
        return clone({
            ...this.value,
            loadError: this.loadError,
        });
    }

    getRuntimeSettings() {
        return clone(this.value.settings);
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async update(settings, options = {}) {
        const result = this.updateQueue.then(
            () => this.updateUnlocked(settings, options),
            () => this.updateUnlocked(settings, options),
        );

        this.updateQueue = result.catch(() => {});
        return result;
    }

    async updateUnlocked(settings, { expectedRevision } = {}) {
        if (
            expectedRevision != null &&
            expectedRevision !== this.value.revision
        ) {
            throw new SettingsRevisionError();
        }

        const previous = this.get();
        const next = {
            version: SETTINGS_VERSION,
            configured: true,
            revision: this.value.revision + 1,
            settings: validateSettings(settings),
        };

        await this.write(next);
        this.value = next;
        this.loadError = null;

        const current = this.get();
        for (const listener of this.listeners) {
            try {
                listener(current, previous);
            } catch {
                // 控制面订阅者失败不能影响已经落盘的配置。
            }
        }

        return { current, previous };
    }

    async write(value) {
        const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
        const serialized = `${JSON.stringify(value, null, 2)}\n`;

        try {
            await fs.writeFile(temporaryPath, serialized, { mode: 0o600 });
            await fs.chmod(temporaryPath, 0o600);
            await fs.rename(temporaryPath, this.filePath);
        } finally {
            await fs.unlink(temporaryPath).catch(() => {});
        }
    }
}
