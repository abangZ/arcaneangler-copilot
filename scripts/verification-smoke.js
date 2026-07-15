import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { chromium } from 'playwright';

import { createBrowserProfile } from '../src/core/browser-profile.js';
import { StatusReporter } from '../src/core/status-reporter.js';
import { ArcaneAnglerPage } from '../src/site/arcane-angler-page.js';

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

    console.log(
        'Verification smoke passed: all challenge events are trusted.',
    );
} finally {
    await browser.close();
    await fs.rm(artifactsDir, { recursive: true, force: true });
}
