import fs from 'node:fs/promises';
import path from 'node:path';

const STATS_VERSION = 2;
const LEGACY_STATS_VERSION = 1;
const MAX_DAILY_SUMMARIES = 90;

function clone(value) {
    return structuredClone(value);
}

function nonNegativeNumber(value) {
    const number = Number(value);

    return Number.isFinite(number) && number > 0 ? number : 0;
}

function nullableNonNegativeNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number) && number >= 0 ? number : null;
}

function nullableId(value) {
    const normalized = String(value ?? '').trim();

    return normalized && normalized !== 'undefined' && normalized !== 'null'
        ? normalized
        : null;
}

function nullableText(value, maxLength = 160) {
    const normalized = String(value ?? '').trim();

    return normalized ? normalized.slice(0, maxLength) : null;
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
        fishGold: 0,
        baitCost: 0,
        unknownBaitCostCasts: 0,
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
        fishGold: nonNegativeNumber(source.fishGold),
        baitCost: nonNegativeNumber(source.baitCost),
        unknownBaitCostCasts: nonNegativeNumber(
            source.unknownBaitCostCasts,
        ),
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

    if (!biomeId && !baitId) {
        return null;
    }

    return {
        biomeId,
        biomeName: biomeId
            ? nullableText(value.biomeName) || `地图 ${biomeId}`
            : null,
        baitId,
        baitName: baitId
            ? nullableText(value.baitName) || baitId
            : null,
        baitPrice: nullableNonNegativeNumber(value.baitPrice),
    };
}

function createBreakdownKey(context) {
    return context?.biomeId && context?.baitId
        ? JSON.stringify([context.biomeId, context.baitId])
        : null;
}

function normalizeBreakdown(value, fallbackStartedAt) {
    const context = normalizeContext(value);

    if (!createBreakdownKey(context)) {
        return null;
    }

    return {
        ...context,
        ...normalizeSummary(value, fallbackStartedAt),
    };
}

function normalizeBreakdowns(value, fallbackStartedAt) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    const normalized = {};

    for (const candidate of Object.values(value)) {
        const breakdown = normalizeBreakdown(candidate, fallbackStartedAt);
        const key = createBreakdownKey(breakdown);

        if (key) {
            normalized[key] = breakdown;
        }
    }

    return normalized;
}

function normalizeLastFish(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const name = nullableText(value.name);
    const caughtAt = nullableText(value.caughtAt);

    if (!name || !caughtAt) {
        return null;
    }

    return {
        name,
        fishId: nullableId(value.fishId),
        rarity: nullableText(value.rarity, 80) || 'Unknown',
        count: Math.max(1, nonNegativeNumber(value.count)),
        gold: nonNegativeNumber(value.gold),
        xp: nonNegativeNumber(value.xp),
        caughtAt,
        context: normalizeContext(value.context),
    };
}

function publicSummary(summary) {
    return {
        ...summary,
        netGold: summary.gold - summary.baitCost,
    };
}

function mergeRarityCounts(left, right) {
    const merged = { ...left };

    for (const [category, count] of Object.entries(right)) {
        merged[category] = nonNegativeNumber(merged[category]) + count;
    }

    return merged;
}

function mergeSummary(left, right) {
    return {
        startedAt: left.startedAt && right.startedAt
            ? [left.startedAt, right.startedAt].sort()[0]
            : left.startedAt || right.startedAt || null,
        updatedAt: [left.updatedAt, right.updatedAt]
            .filter(Boolean)
            .sort()
            .at(-1) || null,
        casts: left.casts + right.casts,
        fish: left.fish + right.fish,
        gold: left.gold + right.gold,
        fishGold: left.fishGold + right.fishGold,
        baitCost: left.baitCost + right.baitCost,
        unknownBaitCostCasts:
            left.unknownBaitCostCasts + right.unknownBaitCostCasts,
        xp: left.xp + right.xp,
        relics: left.relics + right.relics,
        treasureChests: left.treasureChests + right.treasureChests,
        gears: left.gears + right.gears,
        rarityCounts: mergeRarityCounts(
            left.rarityCounts,
            right.rarityCounts,
        ),
    };
}

function aggregateBreakdowns(breakdowns) {
    return Object.values(breakdowns).reduce(
        (summary, breakdown) => mergeSummary(summary, breakdown),
        emptySummary(null),
    );
}

function listGroupedBreakdowns(breakdowns, dimension) {
    const groups = new Map();

    for (const breakdown of Object.values(breakdowns)) {
        const id = dimension === 'bait'
            ? breakdown.baitId
            : breakdown.biomeId;
        const current = groups.get(id) || {
            context: dimension === 'bait'
                ? {
                    baitId: breakdown.baitId,
                    baitName: breakdown.baitName,
                    baitPrice: breakdown.baitPrice,
                }
                : {
                    biomeId: breakdown.biomeId,
                    biomeName: breakdown.biomeName,
                },
            summary: emptySummary(null),
        };

        current.summary = mergeSummary(current.summary, breakdown);
        groups.set(id, current);
    }

    return [...groups.values()]
        .map(group => ({
            ...group.context,
            ...publicSummary(group.summary),
        }))
        .sort((left, right) => right.casts - left.casts);
}

export function summarizeCastResult(result, context = null) {
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
    const normalizedContext = normalizeContext({
        biomeId: context?.biomeId ?? source.currentBiome,
        biomeName: context?.biomeName,
        baitId: context?.baitId ?? source.equippedBait,
        baitName: context?.baitName,
        baitPrice: context?.baitPrice,
    });
    const baitPrice = normalizedContext?.baitPrice;
    const hasBait = Boolean(normalizedContext?.baitId);
    const fishGold = isFish
        ? nonNegativeNumber(source.fish?.baseGold) * count
        : 0;

    return {
        casts: 1,
        fish: isFish ? count : 0,
        gold: nonNegativeNumber(source.goldGained),
        fishGold,
        baitCost: baitPrice ?? 0,
        unknownBaitCostCasts: hasBait && baitPrice === null ? 1 : 0,
        xp: nonNegativeNumber(source.xpGained),
        relics: nonNegativeNumber(source.relicsGained),
        treasureChests: Math.max(
            nonNegativeNumber(source.treasureChestsFound),
            isTreasure ? 1 : 0,
        ),
        gears: isGear ? 1 : 0,
        category,
        earnedCount: isFish ? count : 1,
        context: normalizedContext,
        lastFish: isFish
            ? {
                name: nullableText(source.fish.name),
                fishId: nullableId(source.fish.id),
                rarity: rarity || 'Unknown',
                count,
                gold: nonNegativeNumber(source.goldGained) || fishGold,
                xp: nonNegativeNumber(source.xpGained),
            }
            : null,
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
        fishGold: summary.fishGold + cast.fishGold,
        baitCost: summary.baitCost + cast.baitCost,
        unknownBaitCostCasts:
            summary.unknownBaitCostCasts + cast.unknownBaitCostCasts,
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

function incrementBreakdown(breakdowns, cast, updatedAt) {
    const key = createBreakdownKey(cast.context);

    if (!key) {
        return breakdowns;
    }

    const current = breakdowns[key] || {
        ...cast.context,
        ...emptySummary(updatedAt),
    };

    return {
        ...breakdowns,
        [key]: {
            ...incrementSummary(current, cast, updatedAt),
            ...cast.context,
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
            breakdowns: {},
            dailyBreakdowns: {},
            lastContext: null,
            lastFish: null,
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

            if (![LEGACY_STATS_VERSION, STATS_VERSION].includes(stored.version)) {
                throw new Error(`不支持的收益统计版本 ${stored.version}。`);
            }

            const fallbackStartedAt = this.now().toISOString();
            const days = {};
            const dailyBreakdowns = {};

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

            if (
                stored.version === STATS_VERSION &&
                stored.dailyBreakdowns &&
                typeof stored.dailyBreakdowns === 'object'
            ) {
                for (const [day, breakdowns] of Object.entries(
                    stored.dailyBreakdowns,
                )) {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
                        dailyBreakdowns[day] = normalizeBreakdowns(
                            breakdowns,
                            `${day}T00:00:00`,
                        );
                    }
                }
            }

            this.value = {
                version: STATS_VERSION,
                total: normalizeSummary(stored.total, fallbackStartedAt),
                days,
                breakdowns: stored.version === STATS_VERSION
                    ? normalizeBreakdowns(
                        stored.breakdowns,
                        fallbackStartedAt,
                    )
                    : {},
                dailyBreakdowns,
                lastContext: normalizeContext(stored.lastContext),
                lastFish: stored.version === STATS_VERSION
                    ? normalizeLastFish(stored.lastFish)
                    : null,
            };
            this.pruneDays();
            await fs.chmod(this.filePath, 0o600);

            if (stored.version === LEGACY_STATS_VERSION) {
                await this.write();
            }
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
        const todayBreakdowns = this.value.dailyBreakdowns[todayKey] || {};
        const recentDays = Object.entries(this.value.days)
            .sort(([left], [right]) => right.localeCompare(left))
            .slice(0, 14)
            .map(([day, summary]) => ({
                day,
                ...publicSummary(summary),
            }));
        const breakdowns = Object.values(this.value.breakdowns)
            .map(breakdown => publicSummary(breakdown))
            .sort((left, right) => right.casts - left.casts);
        const currentBaitId = this.value.lastContext?.baitId;
        const currentBiomeId = this.value.lastContext?.biomeId;
        const currentBaitBreakdowns = Object.fromEntries(
            Object.entries(this.value.breakdowns)
                .filter(([, value]) => value.baitId === currentBaitId),
        );
        const currentBaitTodayBreakdowns = Object.fromEntries(
            Object.entries(todayBreakdowns)
                .filter(([, value]) => value.baitId === currentBaitId),
        );
        const combinationKey = createBreakdownKey(this.value.lastContext);

        return clone({
            version: STATS_VERSION,
            todayKey,
            today: publicSummary(today),
            total: publicSummary(this.value.total),
            recentDays,
            breakdowns,
            baitSummaries: listGroupedBreakdowns(
                this.value.breakdowns,
                'bait',
            ),
            biomeSummaries: listGroupedBreakdowns(
                this.value.breakdowns,
                'biome',
            ),
            currentBait: currentBaitId
                ? {
                    baitId: currentBaitId,
                    baitName: this.value.lastContext.baitName,
                    baitPrice: this.value.lastContext.baitPrice,
                    biomeId: currentBiomeId,
                    biomeName: this.value.lastContext.biomeName,
                    today: publicSummary(
                        aggregateBreakdowns(currentBaitTodayBreakdowns),
                    ),
                    total: publicSummary(
                        aggregateBreakdowns(currentBaitBreakdowns),
                    ),
                }
                : null,
            currentCombination: combinationKey
                ? {
                    today: publicSummary(
                        todayBreakdowns[combinationKey] || emptySummary(null),
                    ),
                    total: publicSummary(
                        this.value.breakdowns[combinationKey] ||
                            emptySummary(null),
                    ),
                }
                : null,
            lastContext: this.value.lastContext,
            lastFish: this.value.lastFish,
            loadError: this.loadError,
        });
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async recordCast(result, context = null) {
        const operation = this.updateQueue.then(
            () => this.recordCastUnlocked(result, context),
            () => this.recordCastUnlocked(result, context),
        );

        this.updateQueue = operation.catch(() => {});
        return operation;
    }

    async recordCastUnlocked(result, context) {
        const cast = summarizeCastResult(result, context);
        const now = this.now();
        const updatedAt = now.toISOString();
        const day = localDayKey(now);
        const currentDay = this.value.days[day] || emptySummary(updatedAt);
        const currentDailyBreakdowns = this.value.dailyBreakdowns[day] || {};

        this.value = {
            ...this.value,
            total: incrementSummary(this.value.total, cast, updatedAt),
            days: {
                ...this.value.days,
                [day]: incrementSummary(currentDay, cast, updatedAt),
            },
            breakdowns: incrementBreakdown(
                this.value.breakdowns,
                cast,
                updatedAt,
            ),
            dailyBreakdowns: {
                ...this.value.dailyBreakdowns,
                [day]: incrementBreakdown(
                    currentDailyBreakdowns,
                    cast,
                    updatedAt,
                ),
            },
            lastContext: cast.context || this.value.lastContext,
            lastFish: cast.lastFish
                ? {
                    ...cast.lastFish,
                    caughtAt: updatedAt,
                    context: cast.context,
                }
                : this.value.lastFish,
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
        this.value.dailyBreakdowns = Object.fromEntries(
            Object.entries(this.value.dailyBreakdowns)
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
