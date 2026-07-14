export class BaitFeature {
    constructor({ session, reporter }) {
        this.id = 'bait';
        this.label = '自动鱼饵';
        this.priority = 50;
        this.session = session;
        this.reporter = reporter;
        this.nextCheckAt = 0;
        this.lastConfigurationKey = null;
    }

    isEnabled(settings) {
        return settings.features.bait.enabled;
    }

    reset() {
        this.nextCheckAt = 0;
        this.lastConfigurationKey = null;
    }

    refreshConfiguration(settings) {
        const baitSettings = settings.features.bait;
        const configurationKey = JSON.stringify(baitSettings);

        if (configurationKey !== this.lastConfigurationKey) {
            this.lastConfigurationKey = configurationKey;
            this.nextCheckAt = 0;
        }

        return baitSettings;
    }

    scheduleNextCheck(checkIntervalMs) {
        this.nextCheckAt = Date.now() + checkIntervalMs;
    }

    async reportWaiting(target, message) {
        await this.reporter.update({
            level: 'waiting',
            phase: 'bait',
            target,
            activeFeature: this.label,
            message,
        });
    }

    async tick(settings) {
        const baitSettings = this.refreshConfiguration(settings);

        if (Date.now() < this.nextCheckAt) {
            return false;
        }

        if (!baitSettings.selectedBaitId) {
            this.scheduleNextCheck(baitSettings.checkIntervalMs);
            await this.reportWaiting(
                '等待选择目标鱼饵',
                '自动鱼饵已开启，请先在面板中选择目标鱼饵。',
            );
            return false;
        }

        if (await this.session.dismissBlockingOverlays()) {
            return true;
        }

        if (await this.session.isCharacterPickerVisible()) {
            await this.session.selectCharacterIfNeeded();
            this.reset();
            return true;
        }

        if (!(await this.session.isGameShellVisible())) {
            await this.session.bootstrap({ reload: true });
            this.reset();
            return true;
        }

        await this.session.openFishingPage();

        const biomeId = await this.session.getCurrentBiomeId();
        const catalog = await this.session.getBaitCatalog(biomeId);
        const targetBait = catalog.find(
            bait => bait.id === baitSettings.selectedBaitId,
        );

        if (!targetBait) {
            this.scheduleNextCheck(baitSettings.checkIntervalMs);
            await this.reportWaiting(
                '等待目标鱼饵可用',
                `目标鱼饵 ${baitSettings.selectedBaitId} 不适用于当前 Biome ${biomeId}。`,
            );
            return false;
        }

        await this.reporter.update({
            level: 'running',
            phase: 'bait',
            target: `检查 ${targetBait.name}`,
            activeFeature: this.label,
            message: '正在通过 Equipment 页面检查鱼饵库存和装备状态。',
        });

        let openedEquipment = false;

        try {
            await this.session.openBaitEquipment();
            openedEquipment = true;

            let state = await this.session.inspectBait(
                targetBait.id,
                catalog,
            );

            if (
                state.price > 0 &&
                state.stock < baitSettings.restockThreshold
            ) {
                await this.reporter.update({
                    level: 'running',
                    phase: 'bait',
                    target: `购买 ${targetBait.name}`,
                    activeFeature: this.label,
                    message: `当前库存 ${state.stock}，正在购买 ${baitSettings.purchaseQuantity} 个。`,
                });

                const purchase = await this.session.buyBaitThroughUi(
                    targetBait.id,
                    catalog,
                    baitSettings.purchaseQuantity,
                    state.stock,
                );

                if (!purchase.purchased) {
                    this.scheduleNextCheck(baitSettings.checkIntervalMs);
                    await this.reportWaiting(
                        '等待足够金币购买鱼饵',
                        '购买按钮当前不可用，可能金币不足；将在下次检查时重试。',
                    );
                    return true;
                }

                await this.reporter.update({
                    message: `已购买 ${baitSettings.purchaseQuantity} 个 ${targetBait.name}，当前库存 ${purchase.stock}。`,
                });
                state = await this.session.inspectBait(
                    targetBait.id,
                    catalog,
                );
            }

            const hasUsableStock = state.price === 0 || state.stock > 0;

            if (!state.equipped && hasUsableStock) {
                await this.reporter.update({
                    level: 'running',
                    phase: 'bait',
                    target: `装备 ${targetBait.name}`,
                    activeFeature: this.label,
                    message: '目标鱼饵尚未装备，正在通过页面按钮装备。',
                });

                const equip = await this.session.equipBaitThroughUi(
                    targetBait.id,
                    catalog,
                );

                if (!equip.equipped) {
                    this.scheduleNextCheck(baitSettings.checkIntervalMs);
                    await this.reportWaiting(
                        '等待目标鱼饵可装备',
                        '目标鱼饵的装备按钮当前不可用，将在下次检查时重试。',
                    );
                    return true;
                }

                state = await this.session.inspectBait(
                    targetBait.id,
                    catalog,
                );
            }

            this.scheduleNextCheck(baitSettings.checkIntervalMs);

            if (!hasUsableStock) {
                await this.reportWaiting(
                    '等待鱼饵库存',
                    '目标鱼饵库存为 0，当前补货阈值不会触发购买。',
                );
            } else {
                await this.reporter.update({
                    level: 'running',
                    phase: 'bait',
                    target: `已装备 ${targetBait.name}`,
                    activeFeature: this.label,
                    message: state.stock == null
                        ? '免费鱼饵已就绪。'
                        : `目标鱼饵已就绪，当前库存 ${state.stock}。`,
                });
            }

            return true;
        } finally {
            if (
                openedEquipment &&
                await this.session.isGameShellVisible() &&
                !(await this.session.getVerificationOverlay())
            ) {
                await this.session.openFishingPage();
            }
        }
    }
}
