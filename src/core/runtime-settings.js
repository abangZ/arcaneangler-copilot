function clone(value) {
    return structuredClone(value);
}

export class RuntimeSettings {
    static fromConfig(config) {
        return new RuntimeSettings({
            automationEnabled: config.automationEnabled,
            features: {
                fishing: {
                    enabled: config.autoFishing,
                    enforceClassicMode: config.enforceClassicMode,
                    clickDelayMinMs: config.clickDelayMinMs,
                    clickDelayMaxMs: config.clickDelayMaxMs,
                },
                map: {
                    mode: config.mapMode,
                    targetBiomeId: config.targetBiomeId,
                    checkIntervalMs: config.mapCheckIntervalMs,
                },
                verification: {
                    enabled: config.autoVerify,
                },
                bait: {
                    enabled: config.autoBait,
                    selectedBaitTier: config.baitTier,
                    restockThreshold: config.baitRestockThreshold,
                    purchaseQuantity: config.baitPurchaseQuantity,
                    checkIntervalMs: config.baitCheckIntervalMs,
                },
            },
        });
    }

    constructor(settings) {
        this.value = settings;
    }

    get() {
        return clone(this.value);
    }
}
