import assert from 'node:assert/strict';
import http from 'node:http';

import { chromium } from 'playwright';

import { createBrowserProfile } from '../src/core/browser-profile.js';

let requestHeaders = null;
const server = http.createServer((request, response) => {
    requestHeaders = request.headers;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>fingerprint smoke</title>');
});

await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
const profile = createBrowserProfile();
let context = null;

try {
    context = await chromium.launchPersistentContext('', {
        headless: true,
        channel: profile.channel,
        userAgent: profile.userAgent,
        viewport: {
            width: 1280,
            height: 900,
        },
        locale: 'en-US',
        args: profile.args,
    });

    const page = context.pages()[0] || await context.newPage();

    await page.goto(`http://127.0.0.1:${address.port}/`);

    const fingerprint = await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        webdriver: navigator.webdriver,
        plugins: navigator.plugins.length,
        chromeObject: Boolean(window.chrome),
        userAgentData: navigator.userAgentData ? {
            brands: navigator.userAgentData.brands,
            mobile: navigator.userAgentData.mobile,
            platform: navigator.userAgentData.platform,
        } : null,
    }));

    assert.equal(fingerprint.userAgent, profile.userAgent);
    assert.equal(requestHeaders['user-agent'], profile.userAgent);
    assert.doesNotMatch(fingerprint.userAgent, /HeadlessChrome/i);
    assert.match(fingerprint.userAgent, /Chrome\/\d+\.0\.0\.0/);
    assert.equal(fingerprint.webdriver, false);
    assert.ok(fingerprint.plugins > 0);
    assert.equal(fingerprint.chromeObject, true);
    assert.ok(fingerprint.userAgentData);
    assert.ok(fingerprint.userAgentData.brands.length > 0);
    assert.ok(
        fingerprint.userAgentData.brands.every(
            brand => !/headless/i.test(brand.brand),
        ),
    );
    assert.doesNotMatch(requestHeaders['sec-ch-ua'] || '', /headless/i);

    console.log(
        `Fingerprint smoke passed: Chrome ${profile.browserVersion}, consistent UA, webdriver=false, plugins=${fingerprint.plugins}.`,
    );
} finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
}
