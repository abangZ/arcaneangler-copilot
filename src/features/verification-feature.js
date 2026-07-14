export class VerificationFeature {
    constructor({ session, reporter }) {
        this.id = 'verification';
        this.label = '人机验证';
        this.priority = 0;
        this.session = session;
        this.reporter = reporter;
    }

    isEnabled() {
        return true;
    }

    reset() {}

    async tick(settings) {
        if (!(await this.session.getVerificationOverlay())) {
            return false;
        }

        if (settings.features.verification.enabled) {
            try {
                await this.session.solveHumanVerification();
                return true;
            } catch (error) {
                await this.session.captureScreenshot(
                    'auto-verification-failed',
                );
                await this.reporter.update({
                    level: 'error',
                    phase: 'verification',
                    target: '等待人工验证',
                    message: `自动验证失败：${error.message}`,
                });
            }
        }

        await this.session.waitForHumanVerification();
        return true;
    }
}
