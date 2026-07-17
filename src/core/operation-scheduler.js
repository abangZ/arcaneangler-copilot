import { randomInteger } from './browser-utils.js';
import {
    COMPETITION_TYPES,
    findActiveCompetition,
} from './competition-schedule.js';

const MINUTE_MS = 60_000;
export const QUIET_RESUME_DELAY_MINUTES = 60;

export const OPERATION_STATES = Object.freeze({
    IDLE: 'idle',
    ACTIVE: 'active',
    COMPETITION: 'competition',
    REST: 'rest',
    QUIET: 'quiet',
    DISABLED: 'disabled',
});

export const AUTOMATION_PAUSED_CODE = 'AUTOMATION_SCHEDULE_PAUSED';

export class AutomationPausedError extends Error {
    constructor(message = '当前挂机计划已暂停自动操作。') {
        super(message);
        this.name = 'AutomationPausedError';
        this.code = AUTOMATION_PAUSED_CODE;
    }
}

export class OperationScheduler {
    constructor(config, {
        now = () => new Date(),
        random = randomInteger,
    } = {}) {
        this.config = structuredClone(config);
        this.configurationKey = JSON.stringify(this.config);
        this.now = now;
        this.random = random;
        this.mode = OPERATION_STATES.IDLE;
        this.activeUntil = 0;
        this.restUntil = 0;
        this.restDurationMinutes = 0;
        this.competitionId = null;
        this.competitionUntil = 0;
        this.deferredRest = false;
    }

    updateConfig(config) {
        const configurationKey = JSON.stringify(config);

        if (configurationKey === this.configurationKey) {
            return false;
        }

        this.config = structuredClone(config);
        this.configurationKey = configurationKey;
        this.reset();
        return true;
    }

    reset() {
        this.mode = OPERATION_STATES.IDLE;
        this.activeUntil = 0;
        this.restUntil = 0;
        this.restDurationMinutes = 0;
        this.competitionId = null;
        this.competitionUntil = 0;
        this.deferredRest = false;
    }

    isBaseQuietTime(date = this.now()) {
        if (this.config.quietEnabled === false) {
            return false;
        }

        const hour = date.getHours();
        const { quietStartHour, quietEndHour } = this.config;

        if (quietStartHour < quietEndHour) {
            return hour >= quietStartHour && hour < quietEndHour;
        }

        return hour >= quietStartHour || hour < quietEndHour;
    }

    getPreviousQuietEnd(date = this.now()) {
        const quietEnd = new Date(date);

        quietEnd.setHours(this.config.quietEndHour, 0, 0, 0);
        if (quietEnd.getTime() > date.getTime()) {
            quietEnd.setDate(quietEnd.getDate() - 1);
        }

        return quietEnd;
    }

    isQuietResumeDelay(date = this.now()) {
        if (this.config.quietEnabled === false) {
            return false;
        }

        if (this.isBaseQuietTime(date)) {
            return false;
        }

        const quietEnd = this.getPreviousQuietEnd(date);
        const delayedResumeAt = quietEnd.getTime() +
            QUIET_RESUME_DELAY_MINUTES * MINUTE_MS;

        return date.getTime() < delayedResumeAt;
    }

    isQuietTime(date = this.now()) {
        return this.isBaseQuietTime(date) || this.isQuietResumeDelay(date);
    }

    getQuietEnd(date = this.now()) {
        if (this.isQuietResumeDelay(date)) {
            return new Date(
                this.getPreviousQuietEnd(date).getTime() +
                QUIET_RESUME_DELAY_MINUTES * MINUTE_MS,
            );
        }

        const quietEnd = new Date(date);
        quietEnd.setHours(this.config.quietEndHour, 0, 0, 0);

        if (quietEnd.getTime() <= date.getTime()) {
            quietEnd.setDate(quietEnd.getDate() + 1);
        }

        return new Date(
            quietEnd.getTime() +
            QUIET_RESUME_DELAY_MINUTES * MINUTE_MS,
        );
    }

    canOperateNow() {
        const now = this.now();

        return (
            (
                this.mode === OPERATION_STATES.ACTIVE &&
                !this.isQuietTime(now) &&
                now.getTime() < this.activeUntil
            ) ||
            (
                this.mode === OPERATION_STATES.COMPETITION &&
                now.getTime() < this.competitionUntil
            )
        );
    }

    startActive(now, resumedFrom) {
        const durationMinutes = this.random(
            this.config.activeMinMinutes,
            this.config.activeMaxMinutes,
        );

        this.mode = OPERATION_STATES.ACTIVE;
        this.activeUntil = now.getTime() + durationMinutes * MINUTE_MS;
        this.restUntil = 0;
        this.restDurationMinutes = 0;
        this.competitionId = null;
        this.competitionUntil = 0;
        this.deferredRest = false;

        return {
            allowed: true,
            mode: OPERATION_STATES.ACTIVE,
            transitioned: true,
            resumedFrom,
            durationMinutes,
            until: new Date(this.activeUntil),
            waitMs: 0,
        };
    }

    startRest(now) {
        const durationMinutes = this.random(
            this.config.restMinMinutes,
            this.config.restMaxMinutes,
        );

        this.mode = OPERATION_STATES.REST;
        this.activeUntil = 0;
        this.restUntil = now.getTime() + durationMinutes * MINUTE_MS;
        this.restDurationMinutes = durationMinutes;
        this.competitionId = null;
        this.competitionUntil = 0;
        this.deferredRest = false;

        return {
            allowed: false,
            mode: OPERATION_STATES.REST,
            transitioned: true,
            durationMinutes,
            resumeAt: new Date(this.restUntil),
            waitMs: durationMinutes * MINUTE_MS,
        };
    }

    startCompetition(now, competition) {
        const competitionId = `${competition.type}:${competition.id}`;
        const transitioned =
            this.mode !== OPERATION_STATES.COMPETITION ||
            this.competitionId !== competitionId;

        if (this.mode === OPERATION_STATES.REST) {
            this.deferredRest = true;
        }

        if (
            this.activeUntil > 0 &&
            now.getTime() >= this.activeUntil
        ) {
            this.deferredRest = true;
        }

        this.mode = OPERATION_STATES.COMPETITION;
        this.competitionId = competitionId;
        this.competitionUntil = Date.parse(competition.endAt);

        const label = competition.type === COMPETITION_TYPES.WORLD_BOSS
            ? '世界 Boss'
            : competition.type === COMPETITION_TYPES.GUILD_TOURNAMENT
                ? '公会锦标赛'
                : '个人 Derby';

        return {
            allowed: true,
            mode: OPERATION_STATES.COMPETITION,
            transitioned,
            competition: {
                ...competition,
                label,
            },
            until: new Date(this.competitionUntil),
            waitMs: 0,
        };
    }

    resumeAfterCompetition(now) {
        this.competitionId = null;
        this.competitionUntil = 0;

        if (
            this.deferredRest ||
            (this.activeUntil > 0 && now.getTime() >= this.activeUntil)
        ) {
            return this.startRest(now);
        }

        if (this.activeUntil > now.getTime()) {
            const durationMinutes = Math.max(
                1,
                Math.ceil((this.activeUntil - now.getTime()) / MINUTE_MS),
            );

            this.mode = OPERATION_STATES.ACTIVE;
            this.deferredRest = false;
            return {
                allowed: true,
                mode: OPERATION_STATES.ACTIVE,
                transitioned: true,
                resumedFrom: OPERATION_STATES.COMPETITION,
                durationMinutes,
                until: new Date(this.activeUntil),
                waitMs: 0,
            };
        }

        return this.startActive(now, OPERATION_STATES.COMPETITION);
    }

    evaluate({ enabled = true, competitions = [] } = {}) {
        const now = this.now();
        const nowMs = now.getTime();
        const activeCompetition = enabled
            ? findActiveCompetition(competitions, now)
            : null;

        if (activeCompetition) {
            return this.startCompetition(now, activeCompetition);
        }

        if (this.isQuietTime(now)) {
            const transitioned = this.mode !== OPERATION_STATES.QUIET;
            const resumeAt = this.getQuietEnd(now);

            this.mode = OPERATION_STATES.QUIET;
            this.activeUntil = 0;
            this.restUntil = 0;
            this.restDurationMinutes = 0;
            this.competitionId = null;
            this.competitionUntil = 0;
            this.deferredRest = false;

            return {
                allowed: false,
                mode: OPERATION_STATES.QUIET,
                transitioned,
                quietStartHour: this.config.quietStartHour,
                quietEndHour: this.config.quietEndHour,
                resumeAt,
                waitMs: resumeAt.getTime() - nowMs,
            };
        }

        if (!enabled) {
            const transitioned = this.mode !== OPERATION_STATES.DISABLED;

            this.mode = OPERATION_STATES.DISABLED;
            this.activeUntil = 0;
            this.restUntil = 0;
            this.restDurationMinutes = 0;
            this.competitionId = null;
            this.competitionUntil = 0;
            this.deferredRest = false;

            return {
                allowed: false,
                mode: OPERATION_STATES.DISABLED,
                transitioned,
                waitMs: 500,
            };
        }

        if (this.mode === OPERATION_STATES.COMPETITION) {
            return this.resumeAfterCompetition(now);
        }

        if (this.mode === OPERATION_STATES.REST) {
            if (nowMs < this.restUntil) {
                return {
                    allowed: false,
                    mode: OPERATION_STATES.REST,
                    transitioned: false,
                    durationMinutes: this.restDurationMinutes,
                    resumeAt: new Date(this.restUntil),
                    waitMs: this.restUntil - nowMs,
                };
            }

            return this.startActive(now, OPERATION_STATES.REST);
        }

        if (this.mode === OPERATION_STATES.ACTIVE) {
            if (nowMs < this.activeUntil) {
                return {
                    allowed: true,
                    mode: OPERATION_STATES.ACTIVE,
                    transitioned: false,
                    until: new Date(this.activeUntil),
                    waitMs: 0,
                };
            }

            return this.startRest(now);
        }

        const resumedFrom = this.mode;
        return this.startActive(now, resumedFrom);
    }
}
