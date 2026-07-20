const MAP_MODE_OFF = 'off';
const MAP_MODE_FIXED = 'fixed';
const MAP_MODE_AUTO = 'auto';

export function chooseBestBiome(unlockedBiomes, weatherByBiome) {
    const candidates = [...new Set(unlockedBiomes)]
        .map(Number)
        .filter(biomeId => Number.isSafeInteger(biomeId) && biomeId >= 1)
        .map(biomeId => {
            const weatherXpBonus = Number(
                weatherByBiome?.[biomeId]?.xpBonus || 0,
            );
            const biomeXpWeight = (biomeId - 1) * 10;

            return {
                biomeId,
                weather: weatherByBiome?.[biomeId]?.weather || 'unknown',
                weatherXpBonus,
                biomeXpWeight,
                totalXpScore: weatherXpBonus + biomeXpWeight,
            };
        });

    candidates.sort((left, right) =>
        right.totalXpScore - left.totalXpScore ||
        right.biomeId - left.biomeId,
    );

    return candidates[0] || null;
}

export class MapFeature {
    constructor({ session, reporter }) {
        this.id = 'map';
        this.label = '自动地图';
        this.priority = 25;
        this.session = session;
        this.reporter = reporter;
        this.nextCheckAt = 0;
        this.lastConfigurationKey = null;
        this.lastCompetitionKey = null;
    }

    isEnabled(settings) {
        const mapSettings = settings.features.map;

        return mapSettings.mode !== MAP_MODE_OFF ||
            mapSettings.prioritizeTournament;
    }

    reset() {
        // 休息/恢复不应把每小时检查变成每轮挂机都检查。
    }

    refreshConfiguration(settings) {
        const mapSettings = settings.features.map;
        const configurationKey = JSON.stringify(mapSettings);

        if (configurationKey !== this.lastConfigurationKey) {
            this.lastConfigurationKey = configurationKey;
            this.nextCheckAt = 0;
        }

        return mapSettings;
    }

    scheduleNextCheck(checkIntervalMs) {
        this.nextCheckAt = Date.now() + checkIntervalMs;
    }

    refreshCompetition() {
        const activeCompetition = this.session.getActiveCompetition?.();
        const competitionKey = activeCompetition
            ? `${activeCompetition.type}:${activeCompetition.id}`
            : 'none';

        if (competitionKey !== this.lastCompetitionKey) {
            this.lastCompetitionKey = competitionKey;
            this.nextCheckAt = 0;
        }
    }

    async reportWaiting(target, message) {
        await this.reporter.update({
            level: 'waiting',
            phase: 'map',
            target,
            activeFeature: this.label,
            message,
        });
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

    async registerUpcomingDerbies(state) {
        if (state.eligibleDerbyCount === 0) {
            return state;
        }

        await this.reporter.update({
            level: 'running',
            phase: 'map',
            target: '报名可参与赛事',
            activeFeature: this.label,
            message: `发现 ${state.eligibleDerbyCount} 个可报名赛事，正在点击 Events 页面的一键报名。`,
        });

        const registration = await this.session
            .registerEligibleDerbiesThroughUi(state.eligibleDerbyCount);

        await this.reporter.update({
            level: registration.remainingCount > 0 ? 'waiting' : 'running',
            phase: 'map',
            target: '完成赛事报名检查',
            activeFeature: this.label,
            message: registration.registeredCount > 0
                ? `已报名 ${registration.registeredCount} 个赛事${registration.remainingCount > 0 ? `，仍有 ${registration.remainingCount} 个将在下次检查时重试` : ''}。`
                : `一键报名后没有新增报名，${registration.remainingCount} 个赛事将在下次检查时重试。`,
        });

        return this.session.getMapAutomationState();
    }

    selectTarget(mapSettings, state) {
        if (
            mapSettings.prioritizeTournament &&
            state.activeTournament?.isRegistered
        ) {
            return {
                biomeId: state.activeTournament.biomeId,
                reason: `公会正在参与锦标赛 #${state.activeTournament.number || state.activeTournament.id}`,
            };
        }

        if (mapSettings.mode === MAP_MODE_FIXED) {
            return {
                biomeId: mapSettings.targetBiomeId,
                reason: `固定目标 Biome ${mapSettings.targetBiomeId}`,
            };
        }

        if (
            mapSettings.mode === MAP_MODE_AUTO &&
            state.activeDerby?.isRegistered
        ) {
            return {
                biomeId: state.activeDerby.biomeId,
                reason: `已参与的进行中 Derby #${state.activeDerby.number || state.activeDerby.id}`,
            };
        }

        if (mapSettings.mode !== MAP_MODE_AUTO) {
            return null;
        }

        const bestBiome = chooseBestBiome(
            state.unlockedBiomes,
            state.weatherByBiome,
        );

        if (!bestBiome) {
            return null;
        }

        return {
            ...bestBiome,
            reason: `天气 ${bestBiome.weatherXpBonus >= 0 ? '+' : ''}${bestBiome.weatherXpBonus}% + Biome 加权 ${bestBiome.biomeXpWeight}% = ${bestBiome.totalXpScore}%`,
        };
    }

    async tick(settings) {
        if (await this.session.hasActiveVerification?.()) {
            return true;
        }

        const mapSettings = this.refreshConfiguration(settings);

        this.refreshCompetition();

        if (Date.now() < this.nextCheckAt) {
            return false;
        }

        if (!(await this.ensureGameReady())) {
            return true;
        }

        await this.reporter.update({
            level: 'running',
            phase: 'map',
            target: mapSettings.mode === MAP_MODE_AUTO
                ? '检查赛事和最佳地图'
                : mapSettings.prioritizeTournament
                    ? '检查公会锦标赛地图'
                : `检查固定目标 Biome ${mapSettings.targetBiomeId}`,
            activeFeature: this.label,
            message: mapSettings.mode === MAP_MODE_AUTO
                ? '正在读取已解锁地图、当前天气和赛事状态。'
                : '正在读取已解锁地图和赛事状态。',
        });

        let state = await this.session.getMapAutomationState();

        if (mapSettings.mode === MAP_MODE_AUTO) {
            state = await this.registerUpcomingDerbies(state);
        }

        const target = this.selectTarget(mapSettings, state);

        if (!target) {
            this.scheduleNextCheck(mapSettings.checkIntervalMs);
            await this.reportWaiting(
                mapSettings.mode === MAP_MODE_OFF
                    ? '等待公会锦标赛'
                    : '等待可用地图',
                mapSettings.mode === MAP_MODE_OFF
                    ? '自动切地图已关闭；当前没有已参与的公会锦标赛，将在下次检查时重试。'
                    : '当前没有可选择的已解锁地图，将在下次检查时重试。',
            );
            await this.session.openFishingPage();
            return true;
        }

        if (!state.unlockedBiomes.includes(target.biomeId)) {
            this.scheduleNextCheck(mapSettings.checkIntervalMs);
            await this.reportWaiting(
                `等待 Biome ${target.biomeId} 解锁`,
                `${target.reason}，但该地图尚未解锁；程序不会自动花费金币解锁地图。`,
            );
            await this.session.openFishingPage();
            return true;
        }

        const biomeName = state.biomes[target.biomeId]?.name ||
            `Biome ${target.biomeId}`;

        if (state.currentBiome === target.biomeId) {
            this.scheduleNextCheck(mapSettings.checkIntervalMs);
            await this.reporter.update({
                level: 'running',
                phase: 'map',
                target: `留在 ${biomeName}`,
                activeFeature: this.label,
                message: `当前地图已经符合选择结果：${target.reason}。`,
            });
            await this.session.openFishingPage();
            return true;
        }

        if (state.boat) {
            this.scheduleNextCheck(mapSettings.checkIntervalMs);
            await this.reportWaiting(
                `等待离开 Party Boat 后切换 ${biomeName}`,
                `${target.reason}；当前在 Party Boat 上，自动切图不会改变队伍的共享地图。`,
            );
            await this.session.openFishingPage();
            return true;
        }

        await this.reporter.update({
            level: 'running',
            phase: 'map',
            target: `切换到 ${biomeName}`,
            activeFeature: this.label,
            message: `选择 Biome ${target.biomeId}：${target.reason}。`,
        });
        await this.session.changeBiomeThroughUi(
            target.biomeId,
            biomeName,
        );
        this.scheduleNextCheck(mapSettings.checkIntervalMs);
        await this.reporter.update({
            level: 'running',
            phase: 'map',
            target: `已进入 ${biomeName}`,
            activeFeature: this.label,
            message: `已通过 Biomes 页面切换到 Biome ${target.biomeId}。`,
        });

        return true;
    }
}
