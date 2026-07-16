export const COMPETITION_TYPES = Object.freeze({
    WORLD_BOSS: 'world-boss',
    GUILD_TOURNAMENT: 'guild-tournament',
    DERBY: 'derby',
});

const TYPE_PRIORITY = Object.freeze({
    [COMPETITION_TYPES.WORLD_BOSS]: 0,
    [COMPETITION_TYPES.GUILD_TOURNAMENT]: 1,
    [COMPETITION_TYPES.DERBY]: 2,
});

function normalizeDate(value) {
    const timestamp = Date.parse(value);

    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function normalizeCompetitionSchedule(competitions) {
    if (!Array.isArray(competitions)) {
        return [];
    }

    return competitions
        .map(competition => {
            const type = String(competition?.type || '');
            const startAt = normalizeDate(competition?.startAt);
            const endAt = normalizeDate(competition?.endAt);
            const biomeId = Number(competition?.biomeId);
            const id = String(competition?.id ?? '').trim();
            const requiresBiome = type !== COMPETITION_TYPES.WORLD_BOSS;

            if (
                !(type in TYPE_PRIORITY) ||
                !startAt ||
                !endAt ||
                Date.parse(endAt) <= Date.parse(startAt) ||
                (
                    requiresBiome &&
                    (!Number.isSafeInteger(biomeId) || biomeId < 1)
                ) ||
                !id
            ) {
                return null;
            }

            return {
                type,
                id,
                number: Number.isFinite(Number(competition?.number))
                    ? Number(competition.number)
                    : null,
                biomeId: Number.isSafeInteger(biomeId) && biomeId >= 1
                    ? biomeId
                    : null,
                startAt,
                endAt,
            };
        })
        .filter(Boolean)
        .sort((left, right) =>
            Date.parse(left.startAt) - Date.parse(right.startAt) ||
            TYPE_PRIORITY[left.type] - TYPE_PRIORITY[right.type],
        );
}

export function findActiveCompetition(competitions, now = new Date()) {
    const nowMs = now instanceof Date ? now.getTime() : Number(now);

    return normalizeCompetitionSchedule(competitions)
        .filter(competition =>
            Date.parse(competition.startAt) <= nowMs &&
            nowMs < Date.parse(competition.endAt),
        )
        .sort((left, right) =>
            TYPE_PRIORITY[left.type] - TYPE_PRIORITY[right.type] ||
            Date.parse(left.endAt) - Date.parse(right.endAt),
        )[0] || null;
}

export function getCompetitionScheduleKey(competitions) {
    return JSON.stringify(normalizeCompetitionSchedule(competitions));
}
