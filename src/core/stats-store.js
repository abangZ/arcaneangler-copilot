import fs from 'node:fs/promises';
import path from 'node:path';

const STATS_VERSION = 1;
const MAX_DAILY_SUMMARIES = 90;

function clone(value) {
    return structuredClone(value);
}

function nonNegativeNumber(value) {
    const number = Number(value);

    return Number.isFinite(number) && number > 0 ? number : 0;
}

function nullableId(value) {
    const normalized = String(value ?? '').trim();

    return normalized && normalized !== 'undefined' && normalized !== 'null'
        ? normalized
        : null;
}

function localDayKey(date) {
    const pad = value => String(value).padStart(2, '0');

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join('-');
}

function emptySummary(startedAt) {
    return {
        startedAt,
        updatedAt: null,
        casts: 0,
        fish: 0,
        gold: 0,
        xp: 0,
        relics: 0,
        treasureChests: 0,
        gears: 0,
        rarityCounts: {},
    };
}

function normalizeRarityCounts(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .map(([rarity, count]) => [
                String(rarity).slice(0, 80),
                nonNegativeNumber(count),
            ])
            .filter(([rarity, count]) => rarity && count > 0),
    );
}

function normalizeSummary(value, fallbackStartedAt) {
    const source = value && typeof value === 'object' ? value : {};

    return {
        startedAt: typeof source.startedAt === 'string'
            ? source.startedAt
            : fallbackStartedAt,
        updatedAt: typeof source.updatedAt === 'string'
            ? source.updatedAt
            : null,
        casts: nonNegativeNumber(source.casts),
        fish: nonNegativeNumber(source.fish),
        gold: nonNegativeNumber(source.gold),
        xp: nonNegativeNumber(source.xp),
        relics: nonNegativeNumber(source.relics),
        treasureChests: nonNegativeNumber(source.treasureChests),
        gears: nonNegativeNumber(source.gears),
        rarityCounts: normalizeRarityCounts(source.rarityCounts),
    };
}

function normalizeContext(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const biomeId = nullableId(value.biomeId);
    const baitId = nullableId(value.baitId);

    return biomeId || baitId ? { biomeId, baitId } : null;
}

export function summarizeCastResult(result) {
    const source = result && typeof result === 'object' ? result : {};
    const rarity = String(source.rarity ?? '').trim().slice(0, 80);
    const count = Math.max(1, nonNegativeNumber(source.count));
    const isTreasure = Boolean(source.treasureChest) ||
        rarity === 'Treasure Chest';
    const isRelic = rarity === 'Relic';
    const isGear = rarity === 'Gears' &&
        Boolean(source.gear) &&
        !source.inventoryFull;
    const isFish = Boolean(source.fish?.name) &&
        !isTreasure &&
        !isRelic &&
        rarity !== 'Gears';
    const category = isTreasure
        ? 'Treasure Chest'
        : isRelic
            ? 'Relic'
            : rarity === 'Gears'
                ? 'Gears'
                : rarity || 'Unknown';

    return {
        casts: 1,
        fish: isFish ? count : 0,
        gold: nonNegativeNumber(source.goldGained),
        xp: nonNegativeNumber(source.xpGained),
        relics: nonNegativeNumber(source.relicsGained),
        treasureChests: Math.max(
            nonNegativeNumber(source.treasureChestsFound),
            isTreasure ? 1 : 0,
        ),
        gears: isGear ? 1 : 0,
        category,
        earnedCount: isFish ? count : 1,
        context: normalizeContext({
            biomeId: source.currentBiome,
            baitId: source.equippedBait,
        }),
    };
}

function incrementSummary(summary, cast, updatedAt) {
    return {
        ...summary,
        startedAt: summary.casts > 0 ? summary.startedAt : updatedAt,
        updatedAt,
        casts: summary.casts + cast.casts,
        fish: summary.fish + cast.fish,
        gold: summary.gold + cast.gold,
        xp: summary.xp + cast.xp,
        relics: summary.relics + cast.relics,
        treasureChests: summary.treasureChests + cast.treasureChests,
        gears: summary.gears + cast.gears,
        rarityCounts: {
            ...summary.rarityCounts,
            [cast.category]: (
                nonNegativeNumber(summary.rarityCounts[cast.category]) +
                cast.earnedCount
            ),
        },
    };
}

export class StatsStore {
    constructor({ filePath, now = () => new Date() }) {
        this.filePath = filePath;
        this.now = now;
        this.listeners = new Set();
        this.updateQueue = Promise.resolve();
        const timestamp = this.now().toISOString();

        this.value = {
            version: STATS_VERSION,
            total: emptySummary(timestamp),
            days: {},
            lastContext: null,
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

            if (stored.version !== STATS_VERSION) {
                throw new Error(`不支持的收益统计版本 ${stored.version}。`);
            }

            const fallbackStartedAt = this.now().toISOString();
            const days = {};

            if (stored.days && typeof stored.days === 'object') {
                for (const [day, summary] of Object.entries(stored.days)) {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
                        days[day] = normalizeSummary(
                            summary,
                            `${day}T00:00:00`,
                        );
                    }
                }
            }

            this.value = {
                version: STATS_VERSION,
                total: normalizeSummary(stored.total, fallbackStartedAt),
                days,
                lastContext: normalizeContext(stored.lastContext),
            };
            this.pruneDays();
            await fs.chmod(this.filePath, 0o600);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.loadError = error.message;
            }
        }

        return this.get();
    }

    get() {
        const todayKey = localDayKey(this.now());
        const today = this.value.days[todayKey] ||
            emptySummary(`${todayKey}T00:00:00`);
        const recentDays = Object.entries(this.value.days)
            .sort(([left], [right]) => right.localeCompare(left))
            .slice(0, 14)
            .map(([day, summary]) => ({ day, ...summary }));

        return clone({
            version: STATS_VERSION,
            todayKey,
            today,
            total: this.value.total,
            recentDays,
            lastContext: this.value.lastContext,
            loadError: this.loadError,
        });
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async recordCast(result) {
        const operation = this.updateQueue.then(
            () => this.recordCastUnlocked(result),
            () => this.recordCastUnlocked(result),
        );

        this.updateQueue = operation.catch(() => {});
        return operation;
    }

    async recordCastUnlocked(result) {
        const cast = summarizeCastResult(result);
        const now = this.now();
        const updatedAt = now.toISOString();
        const day = localDayKey(now);
        const currentDay = this.value.days[day] || emptySummary(updatedAt);

        this.value = {
            ...this.value,
            total: incrementSummary(this.value.total, cast, updatedAt),
            days: {
                ...this.value.days,
                [day]: incrementSummary(currentDay, cast, updatedAt),
            },
            lastContext: cast.context || this.value.lastContext,
        };
        this.pruneDays();
        await this.write();
        this.loadError = null;

        const snapshot = this.get();
        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            } catch {
                // Web 订阅者失败不能影响收益持久化。
            }
        }

        return snapshot;
    }

    pruneDays() {
        const retained = Object.keys(this.value.days)
            .sort()
            .slice(-MAX_DAILY_SUMMARIES);
        const retainedSet = new Set(retained);

        this.value.days = Object.fromEntries(
            Object.entries(this.value.days)
                .filter(([day]) => retainedSet.has(day)),
        );
    }

    async write() {
        const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
        const serialized = `${JSON.stringify(this.value, null, 2)}\n`;

        try {
            await fs.writeFile(temporaryPath, serialized, { mode: 0o600 });
            await fs.chmod(temporaryPath, 0o600);
            await fs.rename(temporaryPath, this.filePath);
        } finally {
            await fs.unlink(temporaryPath).catch(() => {});
        }
    }
}
