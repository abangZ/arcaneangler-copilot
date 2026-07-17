import { SITE_MAINTENANCE_CODE } from './site-availability.js';

export function sleep(milliseconds) {
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
}

export function randomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function isVisible(locator) {
    try {
        return await locator.isVisible();
    } catch {
        return false;
    }
}

export async function firstVisible(locator) {
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);

        if (await isVisible(candidate)) {
            return candidate;
        }
    }

    return null;
}

export async function waitUntil(
    predicate,
    {
        timeoutMs,
        intervalMs = 100,
        message = '等待页面状态超时',
        shouldStop = () => false,
    },
) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (!shouldStop() && Date.now() < deadline) {
        try {
            if (await predicate()) {
                return;
            }
        } catch (error) {
            if (
                error.name === 'AutomationPausedError' ||
                error.code === SITE_MAINTENANCE_CODE
            ) {
                throw error;
            }

            lastError = error;
        }

        await sleep(intervalMs);
    }

    if (lastError) {
        throw new Error(`${message}: ${lastError.message}`);
    }

    throw new Error(message);
}
