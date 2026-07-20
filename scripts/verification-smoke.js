import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { chromium } from 'playwright';

import { createBrowserProfile } from '../src/core/browser-profile.js';
import { StatusReporter } from '../src/core/status-reporter.js';
import {
    findCaptchaGapFromPixels,
    solveStaffQuestion,
} from '../src/core/verification-challenges.js';
import { VerificationFeature } from '../src/features/verification-feature.js';
import { ArcaneAnglerPage } from '../src/site/arcane-angler-page.js';

const settings = {
    features: {
        verification: { enabled: true },
    },
};
let verificationChecks = 0;
let completedApiCalls = 0;
const completedReports = [];
const completedFeature = new VerificationFeature({
    session: {
        async getActiveVerification() {
            verificationChecks += 1;
            return verificationChecks === 1 ? { type: 'captcha' } : null;
        },
        async solveHumanVerification() {
            throw new Error('提交后旧滑块已失效');
        },
        async solveHumanVerificationThroughApi() {
            completedApiCalls += 1;
        },
    },
    reporter: {
        async update(state) {
            completedReports.push(state);
        },
    },
});

assert.equal(await completedFeature.tick(settings), true);
assert.equal(completedApiCalls, 0);
assert.match(completedReports.at(-1).message, /确认验证已完成/);

const fallbackActions = [];
const fallbackFeature = new VerificationFeature({
    session: {
        async getActiveVerification() {
            return { type: 'captcha' };
        },
        async solveHumanVerification() {
            fallbackActions.push('mouse');
            throw new Error('模拟拖动失败');
        },
        async solveHumanVerificationThroughApi() {
            fallbackActions.push('api');
        },
        async bootstrap(options) {
            fallbackActions.push(`bootstrap:${options.reload}`);
        },
        async captureScreenshot() {
            throw new Error('API 成功时不应截图');
        },
        async waitForHumanVerification() {
            throw new Error('API 成功时不应等待人工处理');
        },
    },
    reporter: {
        async update() {},
    },
});

assert.equal(await fallbackFeature.tick(settings), true);
assert.deepEqual(fallbackActions, ['mouse', 'api', 'bootstrap:true']);

const staffActions = [];
const staffFeature = new VerificationFeature({
    session: {
        async getActiveVerification() {
            return {
                type: 'staff-question',
                question: { id: 42, question: 'how much is three plus one' },
            };
        },
        async solveStaffQuestionVerification(question) {
            staffActions.push(`staff:${question.id}`);
        },
    },
    reporter: {
        async update() {},
    },
});

assert.equal(await staffFeature.tick(settings), true);
assert.deepEqual(staffActions, ['staff:42']);

assert.equal(solveStaffQuestion('How much is 3x7?'), '21');
assert.equal(solveStaffQuestion('What is twenty-one minus nine'), '12');
assert.equal(
    solveStaffQuestion('What is two hundred and five divided by five?'),
    '41',
);
assert.equal(
    solveStaffQuestion('Please describe your current activity.'),
    null,
);

const pixelWidth = 320;
const pixelHeight = 130;
const pixelGapX = 109;
const pixelGapY = 18;
const pixelGapWidth = 55;
const pixelGapHeight = 95;
const pixelData = new Uint8ClampedArray(pixelWidth * pixelHeight * 4);

for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) {
        const offset = (y * pixelWidth + x) * 4;

        pixelData[offset] = 10;
        pixelData[offset + 1] = 90 + y;
        pixelData[offset + 2] = 140 + Math.floor(y / 2);
        pixelData[offset + 3] = 255;
    }
}

for (let y = pixelGapY + 1; y < pixelGapY + pixelGapHeight - 1; y += 1) {
    for (let x = pixelGapX + 1; x < pixelGapX + pixelGapWidth - 1; x += 1) {
        const offset = (y * pixelWidth + x) * 4;

        pixelData[offset] = 4;
        pixelData[offset + 1] = 40;
        pixelData[offset + 2] = 66;
        pixelData[offset + 3] = 255;
    }
}

assert.deepEqual(
    findCaptchaGapFromPixels(
        { data: pixelData, height: pixelHeight, width: pixelWidth },
        { height: pixelGapHeight, width: pixelGapWidth },
    ),
    {
        canvasWidth: pixelWidth,
        gapX: pixelGapX,
        gapWidth: pixelGapWidth,
        ratio: pixelGapX / (pixelWidth - pixelGapWidth),
    },
);

const artifactsDir = await fs.mkdtemp(
    '/tmp/arcaneangler-verification-smoke-',
);
const reporter = new StatusReporter();
const profile = createBrowserProfile();
const browser = await chromium.launch({
    headless: true,
    channel: profile.channel,
    args: profile.args,
});

try {
    const page = await browser.newPage({
        userAgent: profile.userAgent,
        viewport: { width: 1280, height: 900 },
    });

    await page.setContent(`
        <main>
            <div class="fixed inset-0 z-50" style="position:fixed;inset:0">
                <button
                    id="verification-entry"
                    style="position: absolute; left: 160px; top: 120px"
                >
                    Continue
                </button>
            </div>
        </main>
    `);
    await page.evaluate(() => {
        window.verificationSmoke = {
            entryTrusted: false,
            rangeTrusted: false,
            submitTrusted: false,
            submittedValue: null,
        };

        const overlay = document.querySelector('div.fixed.inset-0.z-50');
        const entry = document.getElementById('verification-entry');

        entry.addEventListener('click', event => {
            window.verificationSmoke.entryTrusted = event.isTrusted;

            if (!event.isTrusted) {
                return;
            }

            const svg = [
                '<svg xmlns="http://www.w3.org/2000/svg"',
                ' viewBox="0 0 300 120" width="300" height="120">',
                '<rect width="300" height="120" fill="#172033"/>',
                '<rect x="130" y="35" width="40" height="40"',
                ' fill="none" stroke="#fff" stroke-dasharray="4 4"/>',
                '</svg>',
            ].join('');

            overlay.innerHTML = `
                <img
                    alt="challenge"
                    src="data:image/svg+xml,${encodeURIComponent(svg)}"
                    width="300"
                    height="120"
                >
                <input
                    id="verification-range"
                    type="range"
                    min="0"
                    max="100"
                    value="0"
                    style="display:block;width:300px;margin-top:20px"
                >
                <button id="verification-submit" disabled>Submit</button>
            `;

            const range = document.getElementById('verification-range');
            const submit = document.getElementById('verification-submit');

            const acceptRangeEvent = rangeEvent => {
                if (rangeEvent.isTrusted) {
                    window.verificationSmoke.rangeTrusted = true;
                    submit.disabled = false;
                }
            };

            range.addEventListener('input', acceptRangeEvent);
            range.addEventListener('change', acceptRangeEvent);
            submit.addEventListener('click', submitEvent => {
                window.verificationSmoke.submitTrusted =
                    submitEvent.isTrusted;
                window.verificationSmoke.submittedValue = Number(
                    range.value,
                );

                if (
                    submitEvent.isTrusted &&
                    window.verificationSmoke.rangeTrusted &&
                    Number(range.value) === 50
                ) {
                    overlay.remove();
                }
            });
        });
    });

    const session = new ArcaneAnglerPage({
        page,
        reporter,
        shouldStop: () => false,
        config: {
            artifactsDir,
            navigationTimeoutMs: 5_000,
            verificationStepDelayMinMs: 5,
            verificationStepDelayMaxMs: 15,
            verificationMaxAttempts: 1,
        },
    });

    assert.equal(await session.solveHumanVerification(), true);
    assert.equal(await session.getVerificationOverlay(), null);

    const result = await page.evaluate(() => window.verificationSmoke);

    assert.deepEqual(result, {
        entryTrusted: true,
        rangeTrusted: true,
        submitTrusted: true,
        submittedValue: 50,
    });

    const bgSvg = [
        '<svg xmlns="http://www.w3.org/2000/svg"',
        ' viewBox="0 0 300 120" width="300" height="120">',
        '<rect width="300" height="120" fill="#172033"/>',
        '<rect x="130" y="35" width="40" height="40"',
        ' fill="none" stroke="#fff" stroke-dasharray="4 4"/>',
        '</svg>',
    ].join('');
    let apiSubmission = null;

    await page.exposeFunction('recordCaptchaSubmission', submission => {
        apiSubmission = submission;
    });
    await page.evaluate(() => {
        window.ApiService = {
            async notifyCaptchaVerified(token, answer) {
                await window.recordCaptchaSubmission({ token, answer });
                return { success: true };
            },
        };
    });
    await session.collectCaptchaChallengeResponse({
        request() {
            return { method: () => 'GET' };
        },
        url() {
            return 'https://example.test/api/game/captcha-challenge';
        },
        ok() {
            return true;
        },
        async json() {
            return { token: 'smoke-challenge-token', bgSvg };
        },
    });

    assert.deepEqual(
        await session.solveHumanVerificationThroughApi(),
        { success: true },
    );
    assert.deepEqual(apiSubmission, {
        token: 'smoke-challenge-token',
        answer: '50',
    });

    const imageChallenge = await page.evaluate(() => {
        const width = 320;
        const height = 130;
        const gapX = 109;
        const gapY = 18;
        const gapWidth = 55;
        const gapHeight = 95;
        const canvas = document.createElement('canvas');

        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');
        const imageData = context.createImageData(width, height);

        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const offset = (y * width + x) * 4;

                imageData.data[offset] = 10;
                imageData.data[offset + 1] = 90 + y;
                imageData.data[offset + 2] = 140 + Math.floor(y / 2);
                imageData.data[offset + 3] = 255;
            }
        }

        for (let y = gapY + 1; y < gapY + gapHeight - 1; y += 1) {
            for (let x = gapX + 1; x < gapX + gapWidth - 1; x += 1) {
                const offset = (y * width + x) * 4;

                imageData.data[offset] = 4;
                imageData.data[offset + 1] = 40;
                imageData.data[offset + 2] = 66;
                imageData.data[offset + 3] = 255;
            }
        }

        context.putImageData(imageData, 0, 0);

        return {
            bgImage: canvas.toDataURL('image/png'),
            pieceSvg: [
                '<svg xmlns="http://www.w3.org/2000/svg"',
                ' width="55" height="95" viewBox="0 0 55 95">',
                '<rect width="55" height="95" fill="#fff"/>',
                '</svg>',
            ].join(''),
            token: 'image-challenge-token',
        };
    });

    apiSubmission = null;
    session.rememberCaptchaChallenge({ result: imageChallenge });
    assert.deepEqual(
        await session.solveHumanVerificationThroughApi(),
        { success: true },
    );
    assert.deepEqual(apiSubmission, {
        token: 'image-challenge-token',
        answer: '41',
    });

    const staffSubmissions = [];

    await page.exposeFunction('recordStaffSubmission', submission => {
        staffSubmissions.push(submission);
    });
    await page.evaluate(() => {
        const popup = document.createElement('div');

        popup.id = 'staff-question';
        popup.style.cssText = 'position:fixed;left:20px;top:20px';
        popup.innerHTML = `
            <div>Staff Question</div>
            <div>What is twenty-one minus nine?</div>
            <input type="text" maxlength="500">
            <button>Answer</button>
        `;
        popup.__reactFiber$smoke = {
            memoizedProps: {},
            return: {
                memoizedProps: {
                    castCountRef: { current: 5 },
                    onDismiss() {
                        popup.remove();
                    },
                    question: 'What is twenty-one minus nine?',
                    questionId: 42,
                },
                return: null,
            },
        };
        document.body.appendChild(popup);

        window.ApiService.answerToastQuestion = async (
            questionId,
            answer,
            castCount,
        ) => {
            await window.recordStaffSubmission({
                questionId,
                answer,
                castCount,
            });
            return { success: true };
        };
    });
    await session.collectStaffQuestionResponse({
        request() {
            return { method: () => 'GET' };
        },
        url() {
            return 'https://example.test/api/moderation/pending-toast-question';
        },
        ok() {
            return true;
        },
        async json() {
            return {
                pending: {
                    id: 42,
                    question: 'What is twenty-one minus nine?',
                },
            };
        },
    });

    const staffVerification = await session.getActiveVerification();

    assert.equal(staffVerification.type, 'staff-question');
    assert.deepEqual(
        await session.solveStaffQuestionVerification(
            staffVerification.question,
        ),
        { success: true },
    );
    assert.deepEqual(staffSubmissions, [{
        questionId: 42,
        answer: '12',
        castCount: 5,
    }]);
    assert.equal(await session.getActiveVerification(), null);

    console.log(
        'Verification smoke passed: trusted events, image puzzles, Staff Questions and API fallback work.',
    );
} finally {
    await browser.close();
    await fs.rm(artifactsDir, { recursive: true, force: true });
}
