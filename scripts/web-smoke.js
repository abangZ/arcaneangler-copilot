import assert from 'node:assert/strict';
import { createHmac, pbkdf2Sync } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';

import { LogStore } from '../src/core/log-store.js';
import {
    DEFAULT_SETTINGS,
    SettingsValidationError,
    validateSettings,
} from '../src/core/settings-schema.js';
import { SettingsStore } from '../src/core/settings-store.js';
import { StatsStore } from '../src/core/stats-store.js';
import { StatusReporter } from '../src/core/status-reporter.js';
import { WorkerController } from '../src/core/worker-controller.js';
import { AuthService } from '../src/web/auth-service.js';
import { ControlServer } from '../src/web/control-server.js';

const tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'arcane-web-smoke-'),
);
const events = [];
let workerNumber = 0;

function createFakeWorker() {
    const id = ++workerNumber;
    let resolveCompletion;
    const completionPromise = new Promise(resolve => {
        resolveCompletion = resolve;
    });

    return {
        start: async () => events.push(`start:${id}`),
        stop: async signal => {
            events.push(`stop:${id}:${signal}`);
            resolveCompletion();
        },
        completion: () => completionPromise,
        getState: () => ({
            browserOpen: true,
            browserSuspended: false,
            scheduleMode: 'active',
            dashboard: {
                level: 27,
                xp: 450,
                xpToNext: 900,
                biome: {
                    id: '3',
                    name: 'Map 3',
                    weather: 'clear',
                    xpBonus: 10,
                },
                bait: {
                    id: 'bait-3',
                    name: 'Lake Minnow',
                    price: 15,
                },
                derby: {
                    status: 'active',
                    id: '8',
                    number: 41,
                    type: 'global',
                    biome: { id: '3', name: 'Map 3' },
                    endAt: '2026-07-16T20:00:00.000Z',
                    participantCount: 118,
                    standing: { rank: 2, points: 12_340 },
                },
            },
        }),
    };
}

function originHeaders(origin, cookie = null, csrfToken = null) {
    return {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    };
}

async function requestJson(origin, pathname, options = {}) {
    const response = await fetch(`${origin}${pathname}`, options);
    const body = await response.json().catch(() => ({}));

    return { response, body };
}

async function login(origin, username, password) {
    const challengeResult = await requestJson(
        origin,
        '/api/auth/challenge',
        {
            method: 'POST',
            headers: {
                ...originHeaders(origin),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username }),
        },
    );

    assert.equal(challengeResult.response.status, 200);
    const challenge = challengeResult.body;
    const key = pbkdf2Sync(
        password,
        Buffer.from(challenge.salt, 'base64url'),
        challenge.iterations,
        32,
        'sha256',
    );
    const proof = createHmac('sha256', key)
        .update([
            challenge.challengeId,
            challenge.nonce,
            username,
        ].join('.'))
        .digest('base64url');

    return requestJson(origin, '/api/auth/login', {
        method: 'POST',
        headers: {
            ...originHeaders(origin),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            username,
            challengeId: challenge.challengeId,
            proof,
        }),
    });
}

try {
    const settingsFile = path.join(tempDirectory, 'settings.json');
    const settingsStore = new SettingsStore({ filePath: settingsFile });
    const logStore = new LogStore({
        directory: path.join(tempDirectory, 'logs'),
    });
    const statsStore = new StatsStore({
        filePath: path.join(tempDirectory, 'stats.json'),
    });

    await Promise.all([
        settingsStore.initialize(),
        logStore.initialize(),
        statsStore.initialize(),
    ]);
    assert.equal(settingsStore.get().configured, false);
    assert.throws(() => validateSettings({}), SettingsValidationError);

    const concurrentStore = new SettingsStore({
        filePath: path.join(tempDirectory, 'concurrent-settings.json'),
    });
    await concurrentStore.initialize();
    const concurrentA = structuredClone(DEFAULT_SETTINGS);
    const concurrentB = structuredClone(DEFAULT_SETTINGS);
    concurrentA.general.character = 'Alpha';
    concurrentB.general.character = 'Beta';
    const concurrentResults = await Promise.allSettled([
        concurrentStore.update(concurrentA, { expectedRevision: 0 }),
        concurrentStore.update(concurrentB, { expectedRevision: 0 }),
    ]);
    assert.equal(
        concurrentResults.filter(result => result.status === 'fulfilled').length,
        1,
    );
    assert.equal(
        concurrentResults.filter(result =>
            result.status === 'rejected' && result.reason.statusCode === 409,
        ).length,
        1,
    );
    assert.equal(concurrentStore.get().revision, 1);

    const output = { log: [], error: [] };
    const reporter = new StatusReporter({
        logStore,
        logger: {
            log: line => output.log.push(line),
            error: line => output.error.push(line),
        },
    });
    const controller = new WorkerController({
        settingsStore,
        reporter,
        createWorker: createFakeWorker,
    });
    const authService = new AuthService({
        username: 'angler',
        password: 'correct horse battery staple',
    });
    const server = new ControlServer({
        host: '127.0.0.1',
        port: 0,
        authService,
        settingsStore,
        statsStore,
        controller,
        reporter,
    });

    const address = await server.start();
    const origin = `http://127.0.0.1:${address.port}`;

    try {
        let result = await requestJson(origin, '/api/state');
        assert.equal(result.response.status, 401);

        const pageResponse = await fetch(origin);
        assert.equal(pageResponse.status, 200);
        const pageHtml = await pageResponse.text();
        assert.match(pageHtml, /登录控制台/);
        assert.match(pageHtml, /正在恢复登录状态/);
        assert.match(pageHtml, /id="login-view" class="login-layout" hidden/);
        assert.match(pageHtml, /data-view="overview"/);
        assert.match(pageHtml, /data-view="stats"/);
        assert.match(pageHtml, /data-view="logs"/);
        assert.match(pageHtml, /id="settings-view"/);
        assert.match(pageHtml, /id="current-bait-name"/);
        assert.match(pageHtml, /id="current-bait-fish-gold"/);
        assert.match(pageHtml, /id="current-bait-rarity-list"/);
        assert.match(pageHtml, /id="player-level"/);
        assert.match(pageHtml, /id="last-fish-name"/);
        assert.match(pageHtml, /id="derby-title"/);
        assert.match(pageHtml, /id="derby-standing"/);
        assert.doesNotMatch(pageHtml, /id="last-fish-rarity"/);
        assert.doesNotMatch(pageHtml, />最后一条鱼</);
        assert.match(pageHtml, /id="verification-history"/);
        assert.match(pageHtml, /id="bait-stats-body"/);
        assert.match(pageHtml, /id="biome-stats-body"/);
        assert.doesNotMatch(pageHtml, /地图 × 鱼饵明细/);
        assert.doesNotMatch(pageHtml, /id="breakdown-stats-body"/);
        const appSource = await (await fetch(`${origin}/app.js`)).text();
        assert.match(appSource, /const LOG_LIMIT = 200/);
        assert.match(appSource, /const RARITY_DISPLAY/);
        assert.match(appSource, /function estimateLevelUp/);
        assert.match(appSource, /const DERBY_TYPE_LABELS/);
        assert.match(appSource, /保存并进入控制台/);

        result = await login(
            origin,
            'angler',
            'correct horse battery staple',
        );
        assert.equal(result.response.status, 200);
        const setCookie = result.response.headers.get('set-cookie');
        const cookie = setCookie.split(';')[0];
        const { csrfToken } = result.body;
        assert.ok(cookie.startsWith('arcane_session='));
        assert.match(setCookie, /HttpOnly/);
        assert.match(setCookie, /SameSite=Strict/);
        assert.doesNotMatch(setCookie, /; Secure/);
        assert.equal(result.body.secureTransport, false);

        const secondLogin = await login(
            origin,
            'angler',
            'correct horse battery staple',
        );
        assert.equal(secondLogin.response.status, 200);
        const secondCookie = secondLogin.response.headers
            .get('set-cookie')
            .split(';')[0];
        const secondCsrfToken = secondLogin.body.csrfToken;
        assert.notEqual(secondCookie, cookie);

        result = await requestJson(origin, '/api/session', {
            headers: originHeaders(origin, cookie),
        });
        assert.equal(result.response.status, 200);
        result = await requestJson(origin, '/api/session', {
            headers: originHeaders(origin, secondCookie),
        });
        assert.equal(result.response.status, 200);

        result = await requestJson(origin, '/api/auth/logout', {
            method: 'POST',
            headers: {
                ...originHeaders(origin, secondCookie, secondCsrfToken),
                'Content-Type': 'application/json',
            },
            body: '{}',
        });
        assert.equal(result.response.status, 200);
        result = await requestJson(origin, '/api/session', {
            headers: originHeaders(origin, cookie),
        });
        assert.equal(result.response.status, 200);
        result = await requestJson(origin, '/api/session', {
            headers: originHeaders(origin, secondCookie),
        });
        assert.equal(result.response.status, 401);

        result = await requestJson(origin, '/api/settings', {
            headers: originHeaders(origin, cookie),
        });
        assert.equal(result.body.configured, false);

        result = await requestJson(origin, '/api/actions/start', {
            method: 'POST',
            headers: {
                ...originHeaders(origin, cookie, csrfToken),
                'Content-Type': 'application/json',
            },
            body: '{}',
        });
        assert.equal(result.response.status, 409);

        const configuredSettings = structuredClone(DEFAULT_SETTINGS);
        configuredSettings.features.map.mode = 'auto';
        configuredSettings.features.bait.enabled = true;
        configuredSettings.features.bait.selectedBaitTier = 2;

        result = await requestJson(origin, '/api/settings', {
            method: 'PUT',
            headers: {
                ...originHeaders(origin, cookie, csrfToken),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                revision: 0,
                settings: configuredSettings,
            }),
        });
        assert.equal(result.response.status, 200);
        assert.equal(result.body.configured, true);
        assert.equal(result.body.revision, 1);

        const fileMode = (await fs.stat(settingsFile)).mode & 0o777;
        assert.equal(fileMode, 0o600);

        for (let index = 1; index <= 6; index += 1) {
            await reporter.log({
                level: 'running',
                phase: 'verification',
                target: '自动完成人机验证',
                message: `检测到验证，测试记录 ${index}。`,
            });
        }

        const browser = await chromium.launch({ headless: true });

        try {
            const context = await browser.newContext();
            const page = await context.newPage();
            const pageErrors = [];

            page.on('pageerror', error => pageErrors.push(error.message));
            await page.goto(origin);
            await page.locator('#login-username').fill('angler');
            await page.locator('#login-password').fill(
                'correct horse battery staple',
            );
            await page.locator('#login-button').click();
            await page.locator('#app-view').waitFor({ state: 'visible' });
            assert.equal(
                await page.locator('#verification-history li').count(),
                5,
            );
            await assert.doesNotReject(() => page.waitForFunction(() =>
                document.getElementById('stream-state')?.textContent ===
                    '已连接',
            ));

            const sessionCookie = (await context.cookies(origin))
                .find(cookieValue => cookieValue.name === 'arcane_session');

            assert.ok(sessionCookie);
            assert.equal(sessionCookie.secure, false);
            assert.equal(sessionCookie.sameSite, 'Strict');

            const sessionResponse = page.waitForResponse(response =>
                new URL(response.url()).pathname === '/api/session' &&
                response.request().method() === 'GET',
            );

            await page.reload();
            assert.equal((await sessionResponse).status(), 200);
            await page.locator('#app-view').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#login-view').isVisible(), false);
            await assert.doesNotReject(() => page.waitForFunction(() =>
                document.getElementById('stream-state')?.textContent ===
                    '已连接',
            ));
            assert.deepEqual(pageErrors, []);

            const startResponse = page.waitForResponse(response =>
                new URL(response.url()).pathname === '/api/actions/start',
            );

            await page.locator('#start-button').click();
            assert.equal((await startResponse).status(), 200);
            await page.locator('#stop-button').waitFor({ state: 'visible' });
            await page.waitForFunction(() =>
                document.getElementById('derby-title')?.textContent ===
                    'Derby #41 · 全球赛',
            );
            assert.equal(
                await page.locator('#derby-status').textContent(),
                '进行中',
            );
            assert.equal(
                await page.locator('#derby-standing').textContent(),
                '#2 · 12,340 分',
            );

            const stopResponse = page.waitForResponse(response =>
                new URL(response.url()).pathname === '/api/actions/stop',
            );

            await page.locator('#stop-button').click();
            assert.equal((await stopResponse).status(), 200);
            await page.locator('#start-button').waitFor({ state: 'visible' });
        } finally {
            await browser.close();
        }

        result = await requestJson(origin, '/api/actions/start', {
            method: 'POST',
            headers: {
                ...originHeaders(origin, cookie, csrfToken),
                'Content-Type': 'application/json',
            },
            body: '{}',
        });
        assert.equal(result.body.controller.mode, 'running');

        const restartedSettings = structuredClone(configuredSettings);
        restartedSettings.browser.headless = false;
        result = await requestJson(origin, '/api/settings', {
            method: 'PUT',
            headers: {
                ...originHeaders(origin, cookie, csrfToken),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                revision: 1,
                settings: restartedSettings,
            }),
        });
        assert.equal(result.response.status, 200);
        assert.equal(result.body.revision, 2);
        assert.equal(result.body.controller.mode, 'running');
        assert.deepEqual(events, [
            'start:1',
            'stop:1:manual-stop',
            'start:2',
            'stop:2:settings-restart',
            'start:3',
        ]);

        const liveSettings = structuredClone(restartedSettings);
        liveSettings.schedule.activeMinMinutes = 41;
        result = await requestJson(origin, '/api/settings', {
            method: 'PUT',
            headers: {
                ...originHeaders(origin, cookie, csrfToken),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                revision: 2,
                settings: liveSettings,
            }),
        });
        assert.equal(result.response.status, 200);
        assert.equal(result.body.revision, 3);
        assert.equal(events.length, 5);

        await reporter.update({
            level: 'running',
            phase: 'fishing',
            target: '等待下一次抛竿',
            message: 'Web smoke log.',
        });
        await statsStore.recordCast({
            success: true,
            currentBiome: 2,
            equippedBait: 'bait-2',
            count: 1,
            rarity: 'Uncommon',
            fish: { name: 'Web Smoke Fish' },
            goldGained: 97,
            xpGained: 1_241,
            relicsGained: 0,
        });

        result = await requestJson(origin, '/api/stats', {
            headers: originHeaders(origin, cookie),
        });
        assert.equal(result.response.status, 200);
        assert.equal(result.body.today.casts, 1);
        assert.equal(result.body.today.gold, 97);
        assert.equal(result.body.lastContext.biomeId, '2');
        assert.equal(result.body.baitSummaries[0].baitId, 'bait-2');
        assert.equal(result.body.todayBaitSummaries[0].casts, 1);
        assert.equal(result.body.lastFish.name, 'Web Smoke Fish');

        const abortController = new AbortController();
        const streamResponse = await fetch(`${origin}/api/events`, {
            headers: originHeaders(origin, cookie),
            signal: abortController.signal,
        });
        assert.equal(streamResponse.status, 200);
        const reader = streamResponse.body.getReader();
        const chunk = await reader.read();
        const streamText = new TextDecoder().decode(chunk.value);

        assert.match(streamText, /event: log/);
        assert.match(streamText, /event: controller/);
        assert.match(streamText, /event: stats/);
        abortController.abort();

        const latestLogId = reporter.getLogs().at(-1).id;
        const resumedAbortController = new AbortController();
        const resumedStreamResponse = await fetch(
            `${origin}/api/events?afterId=${latestLogId}`,
            {
                headers: originHeaders(origin, cookie),
                signal: resumedAbortController.signal,
            },
        );
        const resumedReader = resumedStreamResponse.body.getReader();
        const resumedChunk = await resumedReader.read();
        const resumedStreamText = new TextDecoder().decode(
            resumedChunk.value,
        );

        assert.equal(resumedStreamResponse.status, 200);
        assert.doesNotMatch(resumedStreamText, /event: log/);
        assert.match(resumedStreamText, /event: controller/);
        resumedAbortController.abort();

        for (const [action, expectedMode] of [
            ['pause', 'paused'],
            ['resume', 'running'],
            ['stop', 'stopped'],
        ]) {
            result = await requestJson(origin, `/api/actions/${action}`, {
                method: 'POST',
                headers: {
                    ...originHeaders(origin, cookie, csrfToken),
                    'Content-Type': 'application/json',
                },
                body: '{}',
            });
            assert.equal(result.body.controller.mode, expectedMode);
        }

        assert.deepEqual(events, [
            'start:1',
            'stop:1:manual-stop',
            'start:2',
            'stop:2:settings-restart',
            'start:3',
            'stop:3:manual-pause',
            'start:4',
            'stop:4:manual-stop',
        ]);

        result = await requestJson(origin, '/api/settings', {
            method: 'PUT',
            headers: {
                ...originHeaders(origin, cookie, 'wrong-token'),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                revision: 3,
                settings: liveSettings,
            }),
        });
        assert.equal(result.response.status, 403);

        const reloadedStore = new SettingsStore({ filePath: settingsFile });
        await reloadedStore.initialize();
        assert.equal(reloadedStore.get().configured, true);
        assert.equal(
            reloadedStore.get().settings.features.bait.selectedBaitTier,
            2,
        );
        assert.equal(
            reloadedStore.get().settings.schedule.activeMinMinutes,
            41,
        );
        assert.ok(reporter.getLogs().length >= 5);
    } finally {
        await server.close();
    }
} finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
}

console.log(
    'Web smoke passed: auth, settings, stats, SSE and Worker controls work.',
);
