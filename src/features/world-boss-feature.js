import { sleep } from '../core/browser-utils.js';

const INACTIVE_CHECK_INTERVAL_MS = 10_000;
const ATTACK_COOLDOWN_MS = 6_500;

export class WorldBossFeature {
    constructor({ session, reporter, onState = null }) {
        this.id = 'world-boss';
        this.label = '自动世界 Boss';
        this.priority = 15;
        this.session = session;
        this.reporter = reporter;
        this.onState = onState;
        this.nextCheckAt = 0;
        this.activeBoss = null;
    }

    isEnabled(settings) {
        return settings.features.worldBoss.enabled;
    }

    reset() {
        this.nextCheckAt = 0;
        this.activeBoss = null;
    }

    async ensureGameReady() {
        if (await this.session.dismissBlockingOverlays()) {
            return false;
        }

        if (await this.session.isCharacterPickerVisible()) {
            await this.session.selectCharacterIfNeeded();
            return false;
        }

        if (!(await this.session.isGameShellVisible())) {
            await this.session.bootstrap({ reload: true });
            return false;
        }

        return true;
    }

    async tick() {
        if (await this.session.hasActiveVerification?.()) {
            return true;
        }

        const now = Date.now();

        if (now < this.nextCheckAt) {
            if (this.activeBoss) {
                await sleep(Math.min(this.nextCheckAt - now, 1_000));
                return true;
            }

            return false;
        }

        if (!(await this.ensureGameReady())) {
            return true;
        }

        const boss = await this.session.getWorldBossAutomationState();

        await this.onState?.(boss);

        if (boss?.status !== 'active') {
            this.activeBoss = null;
            this.nextCheckAt = now + INACTIVE_CHECK_INTERVAL_MS;
            return false;
        }

        this.activeBoss = boss;
        const stat = boss.weakness?.primary ||
            boss.weakness?.secondary ||
            'strength';

        await this.reporter.update({
            level: 'running',
            phase: 'world-boss',
            target: `攻击 ${boss.name}`,
            activeFeature: this.label,
            message: `世界 Boss 正在进行，使用 ${stat} 弱点攻击；活动期间优先于钓鱼。`,
        }, { record: false });

        const result = await this.session.attackWorldBossThroughUi(stat);

        if (result.attacked) {
            const standing = boss.standing || {};
            const nextBoss = {
                ...boss,
                hp: boss.hp
                    ? {
                        ...boss.hp,
                        current: result.currentHp ?? boss.hp.current,
                        percentage: result.hpPercentage ?? boss.hp.percentage,
                    }
                    : boss.hp,
                standing: {
                    ...standing,
                    damage: standing.damage != null && result.damage != null
                        ? standing.damage + result.damage
                        : standing.damage ?? result.damage,
                    attacks: standing.attacks != null
                        ? standing.attacks + 1
                        : 1,
                },
            };

            this.activeBoss = result.defeated ? null : nextBoss;
            await this.onState?.(nextBoss);
            await this.reporter.update({
                level: 'running',
                phase: 'world-boss',
                target: result.defeated
                    ? `${boss.name} 已被击败`
                    : `等待 ${boss.name} 攻击冷却`,
                activeFeature: this.label,
                message: result.damage != null
                    ? `本次造成 ${result.damage.toLocaleString()} 伤害。`
                    : '已通过世界 Boss 页面完成一次攻击。',
            });
        }

        this.nextCheckAt = Date.now() + ATTACK_COOLDOWN_MS;
        return true;
    }
}
