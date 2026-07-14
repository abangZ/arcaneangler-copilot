import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });

try {
    const page = await browser.newPage({
        viewport: {
            width: 1280,
            height: 900,
        },
    });

    await page.goto('https://arcaneangler.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });

    await page.locator('#loading-screen').waitFor({
        state: 'hidden',
        timeout: 30_000,
    }).catch(() => {});

    const playNowButton = page.locator(
        'button.font-black.shadow-lg',
    ).first();

    await playNowButton.waitFor({ state: 'visible', timeout: 30_000 });
    await playNowButton.click();
    await page.locator('form input:not([type="password"])').waitFor({
        state: 'visible',
        timeout: 30_000,
    });
    await page.locator('form input[type="password"]').waitFor({
        state: 'visible',
        timeout: 30_000,
    });

    console.log('Smoke check passed: login form is reachable.');
} finally {
    await browser.close();
}
