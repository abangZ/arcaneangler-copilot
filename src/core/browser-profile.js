import { execFileSync } from 'node:child_process';

import { chromium } from 'playwright';

const PLATFORM_TOKENS = Object.freeze({
    darwin: 'Macintosh; Intel Mac OS X 10_15_7',
    linux: 'X11; Linux x86_64',
    win32: 'Windows NT 10.0; Win64; x64',
});

function readBrowserVersion(executablePath) {
    try {
        const output = execFileSync(executablePath, ['--version'], {
            encoding: 'utf8',
        });
        const match = output.match(/\b\d+\.\d+\.\d+\.\d+\b/);

        if (!match) {
            throw new Error(`无法识别版本输出：${output.trim()}`);
        }

        return match[0];
    } catch (error) {
        throw new Error(`读取 Chromium 版本失败：${error.message}`);
    }
}

export function buildChromeUserAgent(browserVersion, platform) {
    const majorVersion = String(browserVersion).split('.')[0];

    if (!/^\d+$/.test(majorVersion)) {
        throw new Error(`无效的 Chromium 版本：${browserVersion}`);
    }

    const platformToken = PLATFORM_TOKENS[platform] || PLATFORM_TOKENS.linux;

    return [
        `Mozilla/5.0 (${platformToken})`,
        'AppleWebKit/537.36 (KHTML, like Gecko)',
        `Chrome/${majorVersion}.0.0.0`,
        'Safari/537.36',
    ].join(' ');
}

export function createBrowserProfile({
    executablePath = chromium.executablePath(),
    platform = process.platform,
    version = null,
} = {}) {
    const browserVersion = version || readBrowserVersion(executablePath);

    return Object.freeze({
        browserVersion,
        channel: 'chromium',
        userAgent: buildChromeUserAgent(browserVersion, platform),
        args: Object.freeze([
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
        ]),
    });
}
