export class RuntimeSettings {
    constructor(settingsStore) {
        this.settingsStore = settingsStore;
    }

    get() {
        return {
            automationEnabled: true,
            ...this.settingsStore.getRuntimeSettings(),
        };
    }
}
