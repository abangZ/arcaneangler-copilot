import assert from 'node:assert/strict';

import { chromium } from 'playwright';

import { AutomationEngine } from '../src/core/automation-engine.js';
import { createBrowserProfile } from '../src/core/browser-profile.js';
import {
    SITE_MAINTENANCE_CODE,
    SiteMaintenanceError,
} from '../src/core/site-availability.js';
import { ArcaneAnglerPage } from '../src/site/arcane-angler-page.js';

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
            <div>🔧</div>
            <h1>Under Maintenance</h1>
            <p>Arcane Angler is currently undergoing maintenance.</p>
        </main>
    `);

    const session = new ArcaneAnglerPage({
        page,
        reporter: { update: async () => {} },
        shouldStop: () => false,
        config: { navigationTimeoutMs: 5_000 },
    });
    const maintenanceError = await session.waitForInitialUi()
        .then(() => null, error => error);

    assert.equal(maintenanceError?.code, SITE_MAINTENANCE_CODE);
    assert.match(maintenanceError.message, /正在维护/);
} finally {
    await browser.close();
}

const now = new Date();
const quietStartHour = (now.getHours() + 1) % 24;
const quietEndHour = (now.getHours() + 2) % 24;
const schedule = {
    activeMinMinutes: 40,
    activeMaxMinutes: 70,
    restMinMinutes: 5,
    restMaxMinutes: 15,
    quietStartHour,
    quietEndHour,
};
const statusUpdates = [];
let bootstrapAttempts = 0;
let screenshotCount = 0;
let featureTicks = 0;
const engine = new AutomationEngine({
    settings: {
        get: () => ({
            automationEnabled: true,
            schedule,
            advanced: {
                pollIntervalMs: 1,
                recoveryErrorCount: 3,
            },
            features: { fishing: { enabled: true } },
        }),
    },
    reporter: {
        update: async patch => statusUpdates.push(patch),
    },
    session: {
        bootstrap: async () => {
            bootstrapAttempts += 1;

            if (bootstrapAttempts === 1) {
                throw new SiteMaintenanceError();
            }
        },
        captureScreenshot: async () => {
            screenshotCount += 1;
        },
        getCompetitionSchedule: () => [],
        isClosed: () => false,
    },
    browserLifecycle: {
        suspend: async () => {},
        resume: async () => {},
    },
});

engine.maintenanceRetryAt = Date.now() + 50;
const retryWaitStartedAt = Date.now();

assert.equal(await engine.waitForMaintenanceRetry(), true);
assert.ok(Date.now() - retryWaitStartedAt >= 30);
engine.maintenanceRetryAt = Date.now() - 1;
assert.equal(await engine.waitForMaintenanceRetry(), false);

engine.waitForMaintenanceRetry = async () => {
    engine.maintenanceRetryAt = 0;
    return false;
};
engine.register({
    id: 'fishing',
    label: '自动钓鱼',
    priority: 100,
    isEnabled: () => true,
    tick: async () => {
        featureTicks += 1;
        engine.stopRequested = true;
        return true;
    },
});

await engine.start();

assert.equal(bootstrapAttempts, 2);
assert.equal(screenshotCount, 0);
assert.equal(featureTicks, 1);
assert.equal(engine.maintenanceRetryAt, 0);
assert.ok(statusUpdates.some(status =>
    status.level === 'waiting' &&
    status.target === '等待站点维护结束' &&
    /1 分钟后重新检查/.test(status.message)
));
assert.equal(statusUpdates.some(status => status.level === 'error'), false);

console.log(
    'Maintenance smoke passed: maintenance is recognized, throttled and retried without generic recovery.',
);
