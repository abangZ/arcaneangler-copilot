import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { chromium } from 'playwright';

import { createBrowserProfile } from '../src/core/browser-profile.js';
import { StatusReporter } from '../src/core/status-reporter.js';
import { VerificationFeature } from '../src/features/verification-feature.js';
import { ArcaneAnglerPage } from '../src/site/arcane-angler-page.js';

const settings = {
    features: {
        verification: { enabled: true },
    },
};
let overlayChecks = 0;
let completedApiCalls = 0;
const completedReports = [];
const completedFeature = new VerificationFeature({
    session: {
        async getVerificationOverlay() {
            overlayChecks += 1;
            return overlayChecks === 1 ? {} : null;
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
        async getVerificationOverlay() {
            return {};
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

    console.log(
        'Verification smoke passed: trusted events, completed-race detection and API fallback work.',
    );
} finally {
    await browser.close();
    await fs.rm(artifactsDir, { recursive: true, force: true });
}
