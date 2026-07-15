import { randomInteger } from './browser-utils.js';

const MINUTE_MS = 60_000;

export const OPERATION_STATES = Object.freeze({
    IDLE: 'idle',
    ACTIVE: 'active',
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
    }

    isQuietTime(date = this.now()) {
        const hour = date.getHours();
        const { quietStartHour, quietEndHour } = this.config;

        if (quietStartHour < quietEndHour) {
            return hour >= quietStartHour && hour < quietEndHour;
        }

        return hour >= quietStartHour || hour < quietEndHour;
    }

    getQuietEnd(date = this.now()) {
        const quietEnd = new Date(date);
        quietEnd.setHours(this.config.quietEndHour, 0, 0, 0);

        if (quietEnd.getTime() <= date.getTime()) {
            quietEnd.setDate(quietEnd.getDate() + 1);
        }

        return quietEnd;
    }

    canOperateNow() {
        const now = this.now();

        return (
            this.mode === OPERATION_STATES.ACTIVE &&
            !this.isQuietTime(now) &&
            now.getTime() < this.activeUntil
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

        return {
            allowed: false,
            mode: OPERATION_STATES.REST,
            transitioned: true,
            durationMinutes,
            resumeAt: new Date(this.restUntil),
            waitMs: durationMinutes * MINUTE_MS,
        };
    }

    evaluate({ enabled = true } = {}) {
        const now = this.now();
        const nowMs = now.getTime();

        if (this.isQuietTime(now)) {
            const transitioned = this.mode !== OPERATION_STATES.QUIET;
            const resumeAt = this.getQuietEnd(now);

            this.mode = OPERATION_STATES.QUIET;
            this.activeUntil = 0;
            this.restUntil = 0;
            this.restDurationMinutes = 0;

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

            return {
                allowed: false,
                mode: OPERATION_STATES.DISABLED,
                transitioned,
                waitMs: 500,
            };
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
