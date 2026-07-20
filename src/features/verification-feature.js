import { AUTOMATION_PAUSED_CODE } from '../core/operation-scheduler.js';

export class VerificationFeature {
    constructor({ session, reporter }) {
        this.id = 'verification';
        this.label = '自动验证';
        this.priority = 0;
        this.session = session;
        this.reporter = reporter;
    }

    isEnabled() {
        return true;
    }

    reset() {}

    async tick(settings) {
        const verification = await this.session.getActiveVerification();

        if (!verification) {
            return false;
        }

        if (settings.features.verification.enabled) {
            try {
                if (verification.type === 'staff-question') {
                    await this.session.solveStaffQuestionVerification(
                        verification.question,
                    );
                } else {
                    await this.session.solveHumanVerification();
                }
                return true;
            } catch (primaryError) {
                if (primaryError.code === AUTOMATION_PAUSED_CODE) {
                    throw primaryError;
                }

                if (!(await this.session.getActiveVerification())) {
                    await this.reporter.update({
                        level: 'running',
                        phase: 'verification',
                        target: '恢复自动化',
                        message: '验证界面已关闭，确认验证已完成。',
                    });
                    return true;
                }

                if (verification.type === 'staff-question') {
                    await this.session.captureScreenshot(
                        'staff-question-verification-failed',
                    );
                    await this.reporter.update({
                        level: 'error',
                        phase: 'verification',
                        target: '等待人工验证',
                        message: `Staff Question 自动处理失败：${primaryError.message}`,
                    });
                    await this.session.waitForHumanVerification();
                    return true;
                }

                await this.reporter.update({
                    level: 'waiting',
                    phase: 'verification',
                    target: '使用 API 完成人机验证',
                    message: `模拟手动验证失败：${primaryError.message}；正在复用当前题目通过页面验证 API 提交。`,
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
                        message: `模拟手动验证失败：${primaryError.message}；API 兜底也失败：${apiError.message}`,
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
