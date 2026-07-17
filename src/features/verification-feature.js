import { AUTOMATION_PAUSED_CODE } from '../core/operation-scheduler.js';

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
            } catch (mouseError) {
                if (mouseError.code === AUTOMATION_PAUSED_CODE) {
                    throw mouseError;
                }

                if (!(await this.session.getVerificationOverlay())) {
                    await this.reporter.update({
                        level: 'running',
                        phase: 'verification',
                        target: '恢复自动化',
                        message: '人机验证弹窗已关闭，确认验证已完成。',
                    });
                    return true;
                }

                await this.reporter.update({
                    level: 'waiting',
                    phase: 'verification',
                    target: '使用 API 完成人机验证',
                    message: `模拟手动验证失败：${mouseError.message}；正在复用当前题目通过页面验证 API 提交。`,
                });

                try {
                    await this.session.solveHumanVerificationThroughApi();
                } catch (apiError) {
                    await this.session.captureScreenshot(
                        'auto-verification-failed',
                    );
                    await this.reporter.update({
                        level: 'error',
                        phase: 'verification',
                        target: '等待人工验证',
                        message: `模拟手动验证失败：${mouseError.message}；API 兜底也失败：${apiError.message}`,
                    });
                    await this.session.waitForHumanVerification();
                    return true;
                }

                await this.reporter.update({
                    level: 'running',
                    phase: 'verification',
                    target: '恢复自动化',
                    message: '已通过页面验证 API 完成人机验证，正在刷新页面恢复自动操作。',
                });
                await this.session.bootstrap({ reload: true });
                return true;
            }
        }

        await this.session.waitForHumanVerification();
        return true;
    }
}
