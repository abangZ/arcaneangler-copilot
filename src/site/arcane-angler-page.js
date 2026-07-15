import fs from 'node:fs/promises';
import path from 'node:path';

import {
    firstVisible,
    isVisible,
    randomInteger,
    sleep,
    waitUntil,
} from '../core/browser-utils.js';
import { AutomationPausedError } from '../core/operation-scheduler.js';

function randomFloat(min, max) {
    return Math.random() * (max - min) + min;
}

function cubicBezier(start, control1, control2, end, progress) {
    const inverse = 1 - progress;

    return (
        inverse ** 3 * start +
        3 * inverse ** 2 * progress * control1 +
        3 * inverse * progress ** 2 * control2 +
        progress ** 3 * end
    );
}

export class ArcaneAnglerPage {
    constructor({
        page,
        config,
        reporter,
        shouldStop,
        canAutomate = () => true,
        onCastResult = null,
    }) {
        this.config = config;
        this.reporter = reporter;
        this.shouldStop = shouldStop;
        this.canAutomate = canAutomate;
        this.onCastResult = onCastResult;
        this.pointerPosition = { x: 640, y: 450 };
        this.attachPage(page);
    }

    assertAutomationAllowed() {
        if (!this.canAutomate()) {
            throw new AutomationPausedError();
        }
    }

    isClosed() {
        return this.page.isClosed();
    }

    replacePage(page) {
        this.attachPage(page);
        this.pointerPosition = { x: 640, y: 450 };
    }

    attachPage(page) {
        this.page = page;
        page.on('response', response => {
            void this.collectCastResponse(response);
        });
    }

    async collectCastResponse(response) {
        if (!this.onCastResult) {
            return;
        }

        const request = response.request();
        const pathname = new URL(response.url()).pathname;

        if (
            request.method() !== 'POST' ||
            pathname !== '/api/game/cast' ||
            !response.ok()
        ) {
            return;
        }

        try {
            const payload = await response.json();

            if (
                payload?.success === true &&
                payload.result &&
                typeof payload.result === 'object'
            ) {
                await this.onCastResult(payload.result);
            }
        } catch (error) {
            await this.reporter.log({
                level: 'error',
                phase: 'fishing',
                target: '读取抛竿收益',
                message: `无法读取 /cast 响应：${error.message}`,
            });
        }
    }

    async trustedClick(locator, options) {
        this.assertAutomationAllowed();
        await locator.click(options);
    }

    async captureScreenshot(reason) {
        if (this.page.isClosed()) {
            return null;
        }

        await fs.mkdir(this.config.artifactsDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeReason = reason.replace(/[^a-z0-9-]/gi, '-');
        const outputPath = path.join(
            this.config.artifactsDir,
            `${timestamp}-${safeReason}.png`,
        );

        try {
            await this.page.screenshot({
                path: outputPath,
                fullPage: true,
            });
            await this.reporter.update({
                message: `已保存诊断截图：${outputPath}`,
            });
            return outputPath;
        } catch (error) {
            await this.reporter.update({
                level: 'error',
                message: `保存诊断截图失败：${error.message}`,
            });
            return null;
        }
    }

    async getPasswordInput() {
        return firstVisible(this.page.locator('input[type="password"]'));
    }

    async getSidebarNavigation() {
        const candidates = this.page.locator(
            '.flex-1.overflow-y-auto.py-3',
        );
        const count = await candidates.count();

        for (let index = 0; index < count; index += 1) {
            const candidate = candidates.nth(index);

            if (
                await isVisible(candidate) &&
                await candidate.locator(':scope > button').count() >= 2
            ) {
                return candidate;
            }
        }

        return null;
    }

    async getSidebarButton(destination) {
        const navigation = await this.getSidebarNavigation();
        const destinationIndexes = {
            fishing: 0,
            biomes: 1,
            equipment: 4,
            events: 12,
            options: 20,
        };

        if (navigation) {
            const buttons = navigation.locator(':scope > button');
            const index = destinationIndexes[destination];
            const candidate = Number.isInteger(index) &&
                await buttons.count() > index
                ? buttons.nth(index)
                : null;

            if (candidate && await isVisible(candidate)) {
                return candidate;
            }
        }

        const fallbackLabels = {
            fishing: 'Fishing',
            biomes: 'Biomes',
            equipment: 'Equipment',
            events: 'Events',
            options: 'Options',
        };
        const fallbackLabel = fallbackLabels[destination];

        if (!fallbackLabel) {
            return null;
        }

        return firstVisible(this.page.getByRole('button', {
            name: new RegExp(`(^|\\s)${fallbackLabel}(\\s|$)`, 'i'),
        }));
    }

    async isGameShellVisible() {
        return Boolean(await this.getSidebarNavigation());
    }

    getCharacterActionButtons() {
        return this.page.locator(
            'button.w-full.bg-blue-600.text-white.font-bold:not([type="submit"])',
        );
    }

    async isCharacterPickerVisible() {
        if (
            await this.isGameShellVisible() ||
            await this.getPasswordInput()
        ) {
            return false;
        }

        const heading = await firstVisible(this.page.locator('h1'));
        const actionButton = await firstVisible(
            this.getCharacterActionButtons(),
        );

        return Boolean(heading && actionButton);
    }

    async selectCharacterIfNeeded() {
        if (!(await this.isCharacterPickerVisible())) {
            return;
        }

        let actionButton = null;

        if (this.config.character) {
            const characterName = this.page.getByText(
                this.config.character,
                { exact: true },
            ).first();

            if (!(await isVisible(characterName))) {
                throw new Error(
                    `角色选择页中找不到角色 “${this.config.character}”。`,
                );
            }

            const characterCard = characterName.locator(
                'xpath=ancestor::div[.//button[contains(@class,"bg-blue-600") and contains(@class,"w-full")]][1]',
            );

            actionButton = await firstVisible(
                characterCard.locator(
                    'button.w-full.bg-blue-600.text-white.font-bold',
                ),
            );
        } else {
            actionButton = await firstVisible(
                this.getCharacterActionButtons(),
            );
        }

        if (!actionButton) {
            throw new Error('角色选择页中找不到主操作按钮。');
        }

        await this.reporter.update({
            level: 'running',
            phase: 'character',
            target: '选择游戏角色',
            message: this.config.character
                ? `正在选择角色：${this.config.character}`
                : '正在选择第一个角色。',
        });
        await this.trustedClick(actionButton);

        await waitUntil(() => this.isGameShellVisible(), {
            timeoutMs: this.config.navigationTimeoutMs,
            message: '选择角色后没有进入游戏页面',
            shouldStop: this.shouldStop,
        });
    }

    async getLandingEntryButton() {
        const structuralButton = await firstVisible(
            this.page.locator('button.font-black.shadow-lg'),
        );

        if (structuralButton) {
            return structuralButton;
        }

        return firstVisible(this.page.getByRole('button', {
            name: /Play Now|Login/i,
        }));
    }

    async openLoginForm() {
        let passwordInput = await this.getPasswordInput();

        if (passwordInput) {
            return passwordInput;
        }

        await waitUntil(async () => {
            const entryButton = await this.getLandingEntryButton();

            if (!entryButton) {
                return false;
            }

            await this.trustedClick(entryButton);
            return true;
        }, {
            timeoutMs: this.config.navigationTimeoutMs,
            message: '找不到登录入口',
            shouldStop: this.shouldStop,
        });

        await waitUntil(async () => {
            passwordInput = await this.getPasswordInput();
            return Boolean(passwordInput);
        }, {
            timeoutMs: this.config.navigationTimeoutMs,
            message: '打开登录入口后没有出现密码输入框',
            shouldStop: this.shouldStop,
        });

        return passwordInput;
    }

    async login() {
        const passwordInput = await this.openLoginForm();
        const form = passwordInput.locator('xpath=ancestor::form[1]');
        const usernameInput = form.locator(
            'input:not([type="password"])',
        ).first();
        const submitButton = form.locator('button[type="submit"]');

        await this.reporter.update({
            level: 'running',
            phase: 'login',
            target: '登录 Arcane Angler',
            message: `正在登录账号：${this.config.username}`,
        });

        this.assertAutomationAllowed();
        await usernameInput.fill(this.config.username);
        this.assertAutomationAllowed();
        await passwordInput.fill(this.config.password);

        const loginResponsePromise = this.page.waitForResponse(response => {
            const request = response.request();
            const pathname = new URL(response.url()).pathname;

            return (
                request.method() === 'POST' &&
                pathname === '/api/auth/login'
            );
        }, {
            timeout: this.config.navigationTimeoutMs,
        });

        try {
            await this.trustedClick(submitButton);
        } catch (error) {
            void loginResponsePromise.catch(() => {});
            throw error;
        }

        const loginResponse = await loginResponsePromise;

        if (!loginResponse.ok()) {
            let errorMessage = `HTTP ${loginResponse.status()}`;

            try {
                const body = await loginResponse.json();
                errorMessage = body.error || errorMessage;
            } catch {
                // 不输出未知响应正文，避免日志意外包含敏感数据。
            }

            throw new Error(`登录失败：${errorMessage}`);
        }

        await waitUntil(async () =>
            (await this.isCharacterPickerVisible()) ||
            (await this.isGameShellVisible()), {
            timeoutMs: this.config.navigationTimeoutMs,
            message: '登录成功后没有进入角色选择或游戏页面',
            shouldStop: this.shouldStop,
        });

        await this.selectCharacterIfNeeded();
    }

    async ensureAuthenticated() {
        if (await this.isCharacterPickerVisible()) {
            await this.selectCharacterIfNeeded();
            return;
        }

        if (await this.isGameShellVisible()) {
            return;
        }

        await this.login();
    }

    async getDailyLoginRewardModal() {
        const modals = this.page.locator(
            'div.fixed.inset-0.z-50.flex.items-center.justify-center',
        ).filter({
            has: this.page.locator(
                'div.rounded-xl.p-5.max-w-md.w-full',
            ),
        }).filter({
            has: this.page.locator('button.text-xl.leading-none'),
        });

        return firstVisible(modals);
    }

    async claimDailyLoginRewardIfPresent() {
        const modal = await this.getDailyLoginRewardModal();

        if (!modal) {
            return false;
        }

        const card = modal.locator(
            'div.rounded-xl.p-5.max-w-md.w-full',
        ).first();
        const rewardGrid = card.locator(
            'div.flex.flex-wrap.gap-2.mb-4',
        );
        const errorState = card.locator(
            '.text-red-400, .text-red-500, .text-red-600',
        );
        let state = 'loading';

        try {
            await waitUntil(async () => {
                if (await isVisible(rewardGrid)) {
                    state = 'ready';
                    return true;
                }

                if (await isVisible(errorState)) {
                    state = 'error';
                    return true;
                }

                return false;
            }, {
                timeoutMs: this.config.navigationTimeoutMs,
                message: '每日登录奖励加载超时',
                shouldStop: this.shouldStop,
            });
        } catch (error) {
            state = 'error';
            await this.reporter.update({
                level: 'error',
                phase: 'reward',
                target: '处理每日登录奖励',
                message: `${error.message}，将关闭弹窗后继续。`,
            });
        }

        if (state === 'ready') {
            const claimButton = await firstVisible(card.locator(
                'button.w-full.py-2\\.5.rounded-lg',
            ));

            if (claimButton && await claimButton.isEnabled()) {
                await this.reporter.update({
                    level: 'running',
                    phase: 'reward',
                    target: '领取每日登录奖励',
                    message: '检测到可领取的每日奖励，正在优先领取。',
                });
                await this.trustedClick(claimButton);
                await waitUntil(async () =>
                    !(await isVisible(claimButton)) ||
                    !(await claimButton.isEnabled()), {
                    timeoutMs: this.config.navigationTimeoutMs,
                    message: '点击后每日奖励领取状态未更新',
                    shouldStop: this.shouldStop,
                });
                await this.reporter.update({
                    message: '每日登录奖励已领取。',
                });
            } else {
                await this.reporter.update({
                    message: '今日登录奖励已经领取。',
                });
            }
        } else if (state === 'error') {
            await this.reporter.update({
                level: 'error',
                phase: 'reward',
                target: '处理每日登录奖励',
                message: '每日登录奖励加载失败，未将其误报为已领取。',
            });
        }

        const closeButton = await firstVisible(
            modal.locator('button.text-xl.leading-none'),
        );

        if (closeButton) {
            await this.trustedClick(closeButton, {
                timeout: 5_000,
            }).catch(async error => {
                if (
                    error instanceof AutomationPausedError ||
                    await isVisible(modal)
                ) {
                    throw error;
                }
            });
            await modal.waitFor({
                state: 'hidden',
                timeout: this.config.navigationTimeoutMs,
            }).catch(() => {});
        }

        return true;
    }

    async dismissBlockingOverlays() {
        if (await this.getVerificationOverlay()) {
            return false;
        }

        if (await this.claimDailyLoginRewardIfPresent()) {
            return true;
        }

        const modalCloseButton = await firstVisible(
            this.page.locator(
                'div.fixed.inset-0.z-50 button.text-xl.leading-none',
            ),
        );

        if (modalCloseButton) {
            await this.trustedClick(modalCloseButton, {
                timeout: 5_000,
            }).catch(async error => {
                if (
                    error instanceof AutomationPausedError ||
                    await isVisible(modalCloseButton)
                ) {
                    throw error;
                }
            });
            await this.reporter.update({
                message: '已关闭非关键游戏弹窗。',
            });
            return true;
        }

        const tutorial = await firstVisible(
            this.page.locator(
                'div.fixed.bottom-4[class*="z-[60]"]',
            ),
        );

        if (tutorial) {
            const skipButton = await firstVisible(
                tutorial.locator('button.border.border-gray-700'),
            ) || await firstVisible(tutorial.locator('button'));

            if (skipButton) {
                await this.trustedClick(skipButton, {
                    timeout: 5_000,
                }).catch(async error => {
                    if (
                        error instanceof AutomationPausedError ||
                        await isVisible(tutorial)
                    ) {
                        throw error;
                    }
                });
                await tutorial.waitFor({
                    state: 'hidden',
                    timeout: 10_000,
                }).catch(() => {});
                await this.reporter.update({
                    message: '已跳过新手引导，避免遮挡自动操作。',
                });
                return true;
            }
        }

        return false;
    }

    async isFishingPage() {
        const fishingButton = await this.getSidebarButton('fishing');

        if (!fishingButton) {
            return false;
        }

        const className = await fishingButton.getAttribute('class');
        return className?.includes('border-l-4') || false;
    }

    async navigateToSidebarPage(destination) {
        const button = await this.getSidebarButton(destination);

        if (!button) {
            throw new Error(`找不到侧栏 ${destination} 按钮。`);
        }

        await this.trustedClick(button);
    }

    async openFishingPage() {
        if (!(await this.isFishingPage())) {
            await this.navigateToSidebarPage('fishing');
        }

        await waitUntil(() => this.isFishingPage(), {
            timeoutMs: this.config.navigationTimeoutMs,
            message: '无法进入钓鱼页面',
            shouldStop: this.shouldStop,
        });
    }

    async getMapAutomationState({ includeAutoData = true } = {}) {
        const state = await this.page.evaluate(async shouldLoadAutoData => {
            if (!window.ApiService) {
                throw new Error('页面未提供 ApiService。');
            }

            const [playerResponse, weatherResponse, derbyResponse] =
                await Promise.all([
                    window.ApiService.getPlayerData(),
                    shouldLoadAutoData
                        ? window.ApiService.getAllBiomeWeather()
                        : Promise.resolve({}),
                    shouldLoadAutoData
                        ? window.ApiService.getCurrentDerbies()
                        : Promise.resolve({}),
                ]);
            const player = playerResponse?.player || playerResponse;
            const weather = weatherResponse?.weather || weatherResponse || {};
            const unlockedBiomes = [
                ...new Set((player?.unlockedBiomes || [1]).map(Number)),
            ].filter(id => Number.isSafeInteger(id) && id >= 1);
            const unlockedSet = new Set(unlockedBiomes);
            const expectedDerbyType = player?.is_ironman
                ? 'ironman'
                : 'normal';
            const upcoming = Array.isArray(derbyResponse?.upcoming)
                ? derbyResponse.upcoming
                : [];
            const eligibleDerbies = upcoming.filter(derby => {
                const derbyType = String(derby.derby_type || 'normal');

                return (
                    !derby.is_registered &&
                    unlockedSet.has(Number(derby.biome_id)) &&
                    (
                        derbyType === 'global' ||
                        derbyType === expectedDerbyType
                    )
                );
            });
            const active = derbyResponse?.active || null;
            const biomes = Object.fromEntries(
                Object.entries(window.BIOMES || {}).map(([id, biome]) => [
                    Number(id),
                    { name: String(biome?.name || `Biome ${id}`) },
                ]),
            );

            return {
                currentBiome: Number(player?.currentBiome),
                unlockedBiomes,
                boat: player?.boat
                    ? {
                        role: String(player.boat.role || ''),
                    }
                    : null,
                weatherByBiome: Object.fromEntries(
                    Object.entries(weather).map(([id, value]) => [
                        Number(id),
                        {
                            weather: String(value?.weather || 'unknown'),
                            xpBonus: Number(value?.xpBonus || 0),
                        },
                    ]),
                ),
                biomes,
                activeDerby: active
                    ? {
                        id: Number(active.id),
                        number: Number(active.derby_number) || null,
                        biomeId: Number(active.biome_id),
                        isRegistered: Boolean(active.is_registered),
                    }
                    : null,
                eligibleDerbyCount: eligibleDerbies.length,
            };
        }, includeAutoData);

        if (
            !Number.isSafeInteger(state.currentBiome) ||
            state.currentBiome < 1
        ) {
            throw new Error('无法读取当前地图。');
        }

        return state;
    }

    async getRegisterAllDerbiesButton() {
        return firstVisible(this.page.locator(
            'button[title*="all derbies" i]',
        )) || firstVisible(this.page.getByRole('button', {
            name: /Register All|一键.*报名/i,
        }));
    }

    async registerEligibleDerbiesThroughUi(previousEligibleCount) {
        await this.navigateToSidebarPage('events');

        let registerAllButton = null;

        await waitUntil(async () => {
            registerAllButton = await this.getRegisterAllDerbiesButton();
            return Boolean(registerAllButton);
        }, {
            timeoutMs: this.config.navigationTimeoutMs,
            message: 'Events 页面中找不到一键报名按钮',
            shouldStop: this.shouldStop,
        });

        const firstRegistrationResponse = this.page.waitForResponse(
            response => {
                const request = response.request();
                const pathname = new URL(response.url()).pathname;

                return (
                    request.method() === 'POST' &&
                    /^\/api\/derby\/\d+\/register$/.test(pathname)
                );
            },
            { timeout: this.config.navigationTimeoutMs },
        ).catch(() => null);

        await this.trustedClick(registerAllButton);
        await firstRegistrationResponse;
        await waitUntil(async () => {
            const latestButton = await this.getRegisterAllDerbiesButton();
            return !latestButton || await latestButton.isEnabled();
        }, {
            timeoutMs: this.config.navigationTimeoutMs,
            message: '一键报名操作没有完成',
            shouldStop: this.shouldStop,
        });

        const latestState = await this.getMapAutomationState();

        return {
            registeredCount: Math.max(
                0,
                previousEligibleCount - latestState.eligibleDerbyCount,
            ),
            remainingCount: latestState.eligibleDerbyCount,
        };
    }

    getBiomeCards() {
        return this.page.locator(
            'div.max-w-4xl.mx-auto div.space-y-4 > ' +
            'div.p-4.sm\\:p-5.rounded-lg.border-2',
        );
    }

    async getBiomeCard(biomeId, biomeName) {
        const cards = this.getBiomeCards();
        const count = await cards.count();

        for (let index = 0; index < count; index += 1) {
            const card = cards.nth(index);
            const heading = await card.locator('h3').first()
                .textContent() || '';
            const text = await card.innerText();

            if (
                heading.trim() === biomeName ||
                new RegExp(`(^|\\n)Biome\\s+${biomeId}(\\n|$)`, 'i')
                    .test(text)
            ) {
                return card;
            }
        }

        return null;
    }

    async openBiomeSelector(biomeId, biomeName) {
        await this.navigateToSidebarPage('biomes');
        await waitUntil(async () => {
            const cards = this.getBiomeCards();
            return await cards.count() > 0 && await isVisible(cards.first());
        }, {
            timeoutMs: this.config.navigationTimeoutMs,
            message: 'Biomes 页面中没有出现地图卡片',
            shouldStop: this.shouldStop,
        });

        const buttons = this.page.locator(
            'div.max-w-4xl.mx-auto button',
        );
        const count = await buttons.count();
        let pageButton = null;
        let pageStart = null;

        for (let index = 0; index < count; index += 1) {
            const button = buttons.nth(index);
            const text = (await button.textContent() || '').trim();
            const range = text.match(/^(\d+)\s*-\s*(\d+)$/);

            if (
                range &&
                biomeId >= Number(range[1]) &&
                biomeId <= Number(range[2])
            ) {
                pageButton = button;
                pageStart = Number(range[1]);
                break;
            }
        }

        let card = null;

        if (pageButton) {
            await this.trustedClick(pageButton);
            const cardIndex = biomeId - pageStart;

            await waitUntil(async () => {
                const cards = this.getBiomeCards();

                if (
                    cardIndex < 0 ||
                    await cards.count() <= cardIndex ||
                    !(await isVisible(cards.nth(cardIndex)))
                ) {
                    return false;
                }

                card = cards.nth(cardIndex);
                return true;
            }, {
                timeoutMs: this.config.navigationTimeoutMs,
                message: `Biomes 页面中找不到 Biome ${biomeId} 卡片`,
                shouldStop: this.shouldStop,
            });
        } else {
            card = await this.getBiomeCard(biomeId, biomeName);
        }

        if (!card) {
            throw new Error(`Biomes 页面中找不到 Biome ${biomeId} 卡片。`);
        }

        return card;
    }

    async changeBiomeThroughUi(biomeId, biomeName) {
        const card = await this.openBiomeSelector(biomeId, biomeName);

        await this.trustedClick(card);
        await waitUntil(async () => {
            if (!(await this.isFishingPage())) {
                return false;
            }

            return await this.getCurrentBiomeId() === biomeId;
        }, {
            timeoutMs: this.config.navigationTimeoutMs,
            message: `点击后没有进入 Biome ${biomeId}`,
            shouldStop: this.shouldStop,
        });
    }

    async getCurrentBiomeId() {
        const bodyText = await this.page.locator('body').innerText();
        const match = bodyText.match(/\[B(\d+)\]/);
        const biomeId = Number(match?.[1]);

        if (!Number.isSafeInteger(biomeId) || biomeId < 1) {
            throw new Error('钓鱼页中找不到当前 biome 编号。');
        }

        return biomeId;
    }

    async getBaitCatalog(biomeId) {
        const catalog = await this.page.evaluate(id => {
            if (typeof window.getBaitsForBiome !== 'function') {
                throw new Error('页面未提供鱼饵目录。');
            }

            return window.getBaitsForBiome(id).map(bait => ({
                id: String(bait.id),
                name: String(bait.name || bait.id),
                price: Number(bait.price || 0),
            }));
        }, biomeId);

        if (!Array.isArray(catalog) || catalog.length === 0) {
            throw new Error(`Biome ${biomeId} 没有可用的鱼饵目录。`);
        }

        return catalog;
    }

    getBaitCards() {
        return this.page.locator(
            'div.max-w-6xl.mx-auto div.space-y-3 > ' +
            'div.p-4.rounded-lg.border-2',
        );
    }

    async openBaitEquipment() {
        await this.navigateToSidebarPage('equipment');

        const tabs = this.page.locator(
            'div.flex.gap-2.mb-6.border-b.border-gray-700 > button',
        );

        await waitUntil(async () =>
            await tabs.count() >= 2 && await isVisible(tabs.nth(1)), {
            timeoutMs: this.config.navigationTimeoutMs,
            message: 'Equipment 页面中找不到鱼饵标签',
            shouldStop: this.shouldStop,
        });
        await this.trustedClick(tabs.nth(1));
        await waitUntil(async () => {
            const cards = this.getBaitCards();
            return await cards.count() > 0 && await isVisible(cards.first());
        }, {
            timeoutMs: this.config.navigationTimeoutMs,
            message: '鱼饵标签中没有出现鱼饵卡片',
            shouldStop: this.shouldStop,
        });
    }

    async getBaitCard(baitId, catalog) {
        const index = catalog.findIndex(bait => bait.id === baitId);

        if (index === -1) {
            throw new Error(`当前 biome 不提供目标鱼饵 ${baitId}。`);
        }

        const cards = this.getBaitCards();

        if (await cards.count() <= index) {
            throw new Error('鱼饵卡片数量与页面鱼饵目录不一致。');
        }

        const card = cards.nth(index);

        if (!(await isVisible(card))) {
            throw new Error(`目标鱼饵 ${baitId} 的卡片不可见。`);
        }

        return card;
    }

    async inspectBait(baitId, catalog) {
        const bait = catalog.find(candidate => candidate.id === baitId);

        if (!bait) {
            throw new Error(`当前 biome 不提供目标鱼饵 ${baitId}。`);
        }

        const card = await this.getBaitCard(baitId, catalog);
        const className = await card.getAttribute('class') || '';
        const stockLabels = card.locator(
            'div.text-right.ml-2 > span.text-xs',
        );
        let stock = null;

        if (await stockLabels.count() > 0) {
            const stockText = await stockLabels.last().textContent() || '';
            const stockMatch = stockText.match(/[\d,]+/);

            if (stockMatch) {
                stock = Number(stockMatch[0].replaceAll(',', ''));
            }
        }

        if (bait.price > 0 && !Number.isSafeInteger(stock)) {
            throw new Error(`无法读取目标鱼饵 ${baitId} 的库存。`);
        }

        const customInput = card.locator(
            'input[type="number"][min="1"][max="999999"]',
        ).first();
        const equipButton = card.locator(
            'button.w-full.py-2.rounded.font-bold.text-sm',
        ).last();

        return {
            id: baitId,
            name: bait.name,
            price: bait.price,
            stock,
            equipped: className.includes('border-yellow-400'),
            canPurchase: bait.price > 0 &&
                await customInput.count() > 0 &&
                await customInput.isEnabled(),
            canEquip: await equipButton.count() > 0 &&
                await equipButton.isEnabled(),
        };
    }

    async buyBaitThroughUi(baitId, catalog, quantity, previousStock) {
        const card = await this.getBaitCard(baitId, catalog);
        const customInput = card.locator(
            'input[type="number"][min="1"][max="999999"]',
        ).first();

        if (!(await customInput.count()) || !(await customInput.isEnabled())) {
            return { purchased: false, reason: 'unavailable' };
        }

        this.assertAutomationAllowed();
        await customInput.fill('');
        await this.trustedClick(customInput);
        this.assertAutomationAllowed();
        await customInput.pressSequentially(String(quantity), {
            delay: 35,
        });

        const purchaseButton = customInput.locator('xpath=..')
            .locator('button').first();

        await waitUntil(() => purchaseButton.isEnabled(), {
            timeoutMs: 1_000,
            intervalMs: 50,
            message: '鱼饵购买按钮保持禁用',
            shouldStop: this.shouldStop,
        }).catch(() => {});

        if (!(await purchaseButton.count()) ||
            !(await purchaseButton.isEnabled())) {
            return { purchased: false, reason: 'insufficient-funds' };
        }

        await this.trustedClick(purchaseButton);
        await waitUntil(async () => {
            const className = await purchaseButton.getAttribute('class') || '';
            return className.includes('bg-red-600');
        }, {
            timeoutMs: this.config.navigationTimeoutMs,
            message: '鱼饵购买按钮没有进入二次确认状态',
            shouldStop: this.shouldStop,
        });

        const responsePromise = this.page.waitForResponse(response => {
            const request = response.request();
            const pathname = new URL(response.url()).pathname;

            return request.method() === 'POST' &&
                pathname === '/api/game/buy-bait';
        }, {
            timeout: this.config.navigationTimeoutMs,
        }).catch(() => null);

        await this.trustedClick(purchaseButton);
        const response = await responsePromise;

        if (response && !response.ok()) {
            throw new Error(`购买鱼饵失败：HTTP ${response.status()}`);
        }

        let current = null;

        await waitUntil(async () => {
            current = await this.inspectBait(baitId, catalog);
            return current.stock >= previousStock + quantity;
        }, {
            timeoutMs: this.config.navigationTimeoutMs,
            message: '购买后鱼饵库存没有按预期增加',
            shouldStop: this.shouldStop,
        });

        return { purchased: true, stock: current.stock };
    }

    async equipBaitThroughUi(baitId, catalog) {
        const state = await this.inspectBait(baitId, catalog);

        if (state.equipped) {
            return { equipped: true };
        }

        if (state.price > 0 && state.stock <= 0) {
            return { equipped: false, reason: 'out-of-stock' };
        }

        const card = await this.getBaitCard(baitId, catalog);
        const equipButton = card.locator(
            'button.w-full.py-2.rounded.font-bold.text-sm',
        ).last();

        if (!(await equipButton.count()) || !(await equipButton.isEnabled())) {
            return { equipped: false, reason: 'unavailable' };
        }

        const responsePromise = this.page.waitForResponse(response => {
            const request = response.request();
            const pathname = new URL(response.url()).pathname;

            return request.method() === 'POST' &&
                pathname === '/api/game/equip-bait';
        }, {
            timeout: this.config.navigationTimeoutMs,
        }).catch(() => null);

        await this.trustedClick(equipButton);
        const response = await responsePromise;

        if (response && !response.ok()) {
            throw new Error(`装备鱼饵失败：HTTP ${response.status()}`);
        }

        await waitUntil(async () => {
            const currentCard = await this.getBaitCard(baitId, catalog);
            const className = await currentCard.getAttribute('class') || '';
            return className.includes('border-yellow-400');
        }, {
            timeoutMs: this.config.navigationTimeoutMs,
            message: '装备后鱼饵卡片状态没有更新',
            shouldStop: this.shouldStop,
        });

        return { equipped: true };
    }

    async getCastStyleTab() {
        const groups = this.page.locator(
            'div.grid.grid-cols-3[class*="border-b"]',
        );
        const count = await groups.count();

        for (let index = 0; index < count; index += 1) {
            const group = groups.nth(index);
            const buttons = group.locator(':scope > button');

            if (await isVisible(group) && await buttons.count() >= 3) {
                return buttons.nth(1);
            }
        }

        return firstVisible(this.page.getByRole('button', {
            name: /Cast Button/i,
        }));
    }

    async getClassicModeButton() {
        const groups = this.page.locator('div.grid.grid-cols-2.gap-3.mb-8');
        const count = await groups.count();

        for (let index = 0; index < count; index += 1) {
            const group = groups.nth(index);
            const buttons = group.locator(':scope > button');

            if (await isVisible(group) && await buttons.count() === 2) {
                return buttons.nth(1);
            }
        }

        return firstVisible(
            this.page.locator('button').filter({
                hasText: 'Classic cast button',
            }),
        );
    }

    async ensureClassicCastMode(enforceClassicMode) {
        if (!enforceClassicMode) {
            await this.navigateToSidebarPage('fishing');
            return;
        }

        await this.reporter.update({
            level: 'running',
            phase: 'settings',
            target: '确保经典抛竿模式',
            message: '正在检查抛竿按钮设置。',
        });
        await this.navigateToSidebarPage('options');

        let castStyleTab = null;

        await waitUntil(async () => {
            castStyleTab = await this.getCastStyleTab();
            return Boolean(castStyleTab);
        }, {
            timeoutMs: this.config.navigationTimeoutMs,
            message: '设置页中找不到抛竿模式标签',
            shouldStop: this.shouldStop,
        });
        await this.trustedClick(castStyleTab);

        let classicModeButton = null;

        await waitUntil(async () => {
            classicModeButton = await this.getClassicModeButton();
            return Boolean(classicModeButton);
        }, {
            timeoutMs: this.config.navigationTimeoutMs,
            message: '设置页中找不到经典抛竿模式选项',
            shouldStop: this.shouldStop,
        });

        const alreadyClassic = await this.page.evaluate(
            () => localStorage.getItem('castStyle') === 'button',
        );

        if (!alreadyClassic) {
            const savePreferencePromise = this.page.waitForResponse(response => {
                const request = response.request();
                const pathname = new URL(response.url()).pathname;

                return (
                    request.method() === 'PUT' &&
                    pathname === '/api/preferences/ui'
                );
            }, {
                timeout: 5_000,
            }).catch(() => null);

            await this.trustedClick(classicModeButton);

            await this.page.waitForFunction(
                () => localStorage.getItem('castStyle') === 'button',
                null,
                { timeout: this.config.navigationTimeoutMs },
            );

            const response = await savePreferencePromise;

            if (response && !response.ok()) {
                throw new Error(
                    `保存经典模式失败：HTTP ${response.status()}`,
                );
            }

            await this.reporter.update({
                message: '已切换为经典固定按钮模式。',
            });
        } else {
            await this.reporter.update({
                message: '当前已经是经典固定按钮模式。',
            });
        }

        await this.openFishingPage();
    }

    async waitForInitialUi() {
        await this.page.locator('#loading-screen').waitFor({
            state: 'hidden',
            timeout: this.config.navigationTimeoutMs,
        }).catch(() => {});

        await waitUntil(async () => Boolean(
            (await this.getPasswordInput()) ||
            (await this.getLandingEntryButton()) ||
            (await this.isCharacterPickerVisible()) ||
            (await this.isGameShellVisible())
        ), {
            timeoutMs: this.config.navigationTimeoutMs,
            message: '页面加载后没有出现可识别的界面',
            shouldStop: this.shouldStop,
        });
    }

    async bootstrap({ reload = false } = {}) {
        this.assertAutomationAllowed();
        await this.reporter.update({
            level: 'running',
            phase: 'navigation',
            target: reload ? '恢复游戏页面' : '打开游戏页面',
            message: reload
                ? '正在重新加载页面以恢复自动化。'
                : `正在打开 ${this.config.targetUrl}`,
        });

        if (reload) {
            await this.page.reload({ waitUntil: 'domcontentloaded' });
        } else {
            await this.page.goto(this.config.targetUrl, {
                waitUntil: 'domcontentloaded',
            });
        }

        this.assertAutomationAllowed();
        await this.waitForInitialUi();
        await this.ensureAuthenticated();

        while (await this.dismissBlockingOverlays()) {
            await sleep(150);
        }
    }

    async getVerificationOverlay() {
        return firstVisible(
            this.page.locator('div.fixed.inset-0.z-50').filter({
                has: this.page.locator(
                    'input[type="range"], button[style*="position: absolute"]',
                ),
            }),
        );
    }

    async waitVerificationDelay() {
        await sleep(randomInteger(
            this.config.verificationStepDelayMinMs,
            this.config.verificationStepDelayMaxMs,
        ));
    }

    async humanMoveTo(targetX, targetY) {
        const start = this.pointerPosition;
        const distance = Math.hypot(
            targetX - start.x,
            targetY - start.y,
        );
        const duration = Math.min(
            900,
            Math.max(220, 180 + distance * randomFloat(0.45, 0.75)),
        );
        const steps = Math.max(12, Math.round(duration / 22));
        const bend = Math.min(90, Math.max(18, distance * 0.18));
        const direction = Math.random() < 0.5 ? -1 : 1;
        const control1 = {
            x: start.x + (targetX - start.x) * randomFloat(0.25, 0.4),
            y: start.y + (targetY - start.y) * 0.3 + bend * direction,
        };
        const control2 = {
            x: start.x + (targetX - start.x) * randomFloat(0.65, 0.82),
            y: start.y + (targetY - start.y) * 0.72 - bend * direction * 0.45,
        };

        for (let step = 1; step <= steps; step += 1) {
            const progress = step / steps;
            const eased = progress < 0.5
                ? 2 * progress ** 2
                : 1 - (-2 * progress + 2) ** 2 / 2;
            const jitter = step === steps ? 0 : randomFloat(-0.7, 0.7);
            const x = cubicBezier(
                start.x,
                control1.x,
                control2.x,
                targetX,
                eased,
            ) + jitter;
            const y = cubicBezier(
                start.y,
                control1.y,
                control2.y,
                targetY,
                eased,
            ) + jitter;

            await this.page.mouse.move(x, y);
            await sleep(Math.max(5, Math.round(duration / steps)));
        }

        this.pointerPosition = { x: targetX, y: targetY };
    }

    async humanClick(locator) {
        this.assertAutomationAllowed();
        await locator.scrollIntoViewIfNeeded();
        const box = await locator.boundingBox();

        if (!box) {
            throw new Error('目标控件没有可点击区域。');
        }

        const targetX = box.x + box.width * randomFloat(0.32, 0.68);
        const targetY = box.y + box.height * randomFloat(0.32, 0.68);

        await this.humanMoveTo(targetX, targetY);
        await sleep(randomInteger(45, 120));
        this.assertAutomationAllowed();
        await this.page.mouse.down();
        await sleep(randomInteger(45, 110));
        await this.page.mouse.up();
    }

    async getCaptchaRange() {
        return firstVisible(this.page.locator(
            'div.fixed.inset-0.z-50 input[type="range"]',
        ));
    }

    async readCaptchaAnswer(range) {
        return range.evaluate(input => {
            const overlay = input.closest('div.fixed.inset-0.z-50');
            const image = [...(overlay?.querySelectorAll('img') || [])]
                .find(candidate => String(
                    candidate.currentSrc || candidate.src,
                ).startsWith('data:image/svg+xml'));

            if (!image) {
                throw new Error('验证题面中找不到背景图片。');
            }

            const dataUrl = image.currentSrc || image.src;
            const separatorIndex = dataUrl.indexOf(',');

            if (separatorIndex === -1) {
                throw new Error('验证背景图片格式无效。');
            }

            const metadata = dataUrl.slice(0, separatorIndex);
            const payload = dataUrl.slice(separatorIndex + 1);
            const source = metadata.includes(';base64')
                ? new TextDecoder().decode(Uint8Array.from(
                    atob(payload),
                    character => character.charCodeAt(0),
                ))
                : decodeURIComponent(payload);
            const documentNode = new DOMParser().parseFromString(
                source,
                'image/svg+xml',
            );

            if (documentNode.querySelector('parsererror')) {
                throw new Error('验证背景图片解析失败。');
            }

            const root = documentNode.documentElement;
            const gap = [...documentNode.querySelectorAll('rect')]
                .find(rect => rect.hasAttribute('stroke-dasharray'));

            if (!gap) {
                throw new Error('验证题面中找不到拼图缺口。');
            }

            const number = (value, field) => {
                const parsed = Number.parseFloat(value);

                if (!Number.isFinite(parsed)) {
                    throw new Error(`无法读取${field}。`);
                }

                return parsed;
            };
            const viewBox = root.getAttribute('viewBox')
                ?.trim()
                .split(/\s+/)
                .map(Number);
            const canvasWidth = viewBox?.length === 4 &&
                Number.isFinite(viewBox[2])
                ? viewBox[2]
                : number(root.getAttribute('width'), '画布宽度');
            const gapX = number(gap.getAttribute('x'), '缺口横坐标');
            const gapWidth = number(gap.getAttribute('width'), '拼图宽度');
            const travelWidth = canvasWidth - gapWidth;
            const ratio = gapX / travelWidth;
            const min = number(input.min || '0', '滑块最小值');
            const max = number(input.max || '100', '滑块最大值');

            if (travelWidth <= 0 || ratio < 0 || ratio > 1) {
                throw new Error('验证缺口坐标超出可移动范围。');
            }

            return {
                gapX,
                gapWidth,
                ratio,
                targetValue: Math.round(min + ratio * (max - min)),
                imageSource: dataUrl,
            };
        });
    }

    async dragCaptchaRange(range, targetValue) {
        this.assertAutomationAllowed();
        await range.scrollIntoViewIfNeeded();
        const box = await range.boundingBox();
        const values = await range.evaluate(input => ({
            min: Number(input.min || 0),
            max: Number(input.max || 100),
            value: Number(input.value || 0),
        }));

        if (!box || values.max <= values.min) {
            throw new Error('无法读取验证滑块尺寸。');
        }

        const inset = Math.max(6, Math.min(10, box.height / 2));
        const travelWidth = box.width - inset * 2;
        const toX = value => box.x + inset +
            (value - values.min) / (values.max - values.min) * travelWidth;
        const y = box.y + box.height / 2 + randomFloat(-0.8, 0.8);
        let currentValue = values.value;
        let currentX = toX(currentValue);

        await this.humanMoveTo(currentX, y);
        await sleep(randomInteger(80, 170));
        this.assertAutomationAllowed();
        await this.page.mouse.down();
        await sleep(randomInteger(70, 150));
        await this.humanMoveTo(toX(targetValue), y + randomFloat(-1.2, 1.2));
        await sleep(randomInteger(80, 160));
        await this.page.mouse.up();

        currentValue = Number(await range.inputValue());

        if (currentValue !== targetValue) {
            const key = currentValue < targetValue
                ? 'ArrowRight'
                : 'ArrowLeft';
            const corrections = Math.abs(targetValue - currentValue);

            if (corrections > 8) {
                throw new Error(
                    `滑块拖动偏差过大：目标 ${targetValue}，实际 ${currentValue}。`,
                );
            }

            for (let index = 0; index < corrections; index += 1) {
                this.assertAutomationAllowed();
                await this.page.keyboard.press(key);
                await sleep(randomInteger(35, 90));
            }
        }

        const finalValue = Number(await range.inputValue());

        if (finalValue !== targetValue) {
            throw new Error(
                `滑块未到达目标值：目标 ${targetValue}，实际 ${finalValue}。`,
            );
        }

        return finalValue;
    }

    async solveHumanVerification() {
        let overlay = await this.getVerificationOverlay();

        if (!overlay) {
            return false;
        }

        await this.reporter.update({
            level: 'running',
            phase: 'verification',
            target: '自动完成人机验证',
            message: '检测到验证，正在使用真实鼠标操作页面控件。',
        });
        await this.captureScreenshot('human-verification');

        let range = await this.getCaptchaRange();

        if (!range) {
            const entryButton = await firstVisible(overlay.locator(
                'button[style*="position: absolute"]',
            ));

            if (!entryButton) {
                throw new Error('找不到验证入口按钮。');
            }

            await this.waitVerificationDelay();
            await this.humanClick(entryButton);

            await waitUntil(async () => {
                range = await this.getCaptchaRange();
                return Boolean(range);
            }, {
                timeoutMs: this.config.navigationTimeoutMs,
                message: '点击验证入口后没有出现滑块',
                shouldStop: this.shouldStop,
            });
        }

        for (
            let attempt = 1;
            attempt <= this.config.verificationMaxAttempts;
            attempt += 1
        ) {
            const answer = await this.readCaptchaAnswer(range);

            await this.reporter.update({
                level: 'running',
                phase: 'verification',
                target: `拖动验证滑块（${attempt}/${this.config.verificationMaxAttempts}）`,
                message: '已从页面题面定位缺口，正在模拟人工拖动。',
            });
            await this.waitVerificationDelay();
            await this.dragCaptchaRange(range, answer.targetValue);
            await this.waitVerificationDelay();

            overlay = await this.getVerificationOverlay();
            const submitButton = overlay && await firstVisible(
                overlay.locator('button'),
            );

            if (!submitButton) {
                throw new Error('找不到验证提交按钮。');
            }

            await waitUntil(() => submitButton.isEnabled(), {
                timeoutMs: 5_000,
                message: '验证提交按钮未启用',
                shouldStop: this.shouldStop,
            });
            await this.humanClick(submitButton);

            const deadline = Date.now() + 8_000;

            while (!this.shouldStop() && Date.now() < deadline) {
                overlay = await this.getVerificationOverlay();

                if (!overlay) {
                    await this.reporter.update({
                        level: 'running',
                        phase: 'verification',
                        target: '恢复自动化',
                        message: '人机验证已通过，恢复自动操作。',
                    });
                    return true;
                }

                const nextRange = await this.getCaptchaRange();

                if (nextRange) {
                    const nextImageSource = await nextRange.evaluate(input =>
                        [...(input.closest('div.fixed.inset-0.z-50')
                            ?.querySelectorAll('img') || [])]
                            .find(image => String(
                                image.currentSrc || image.src,
                            ).startsWith('data:image/svg+xml'))
                            ?.currentSrc || '',
                    );

                    if (
                        nextImageSource &&
                        nextImageSource !== answer.imageSource
                    ) {
                        range = nextRange;
                        break;
                    }
                }

                await sleep(120);
            }
        }

        throw new Error('自动验证未通过，已达到最大尝试次数。');
    }

    async waitForHumanVerification() {
        if (!(await this.getVerificationOverlay())) {
            return false;
        }

        await this.reporter.update({
            level: 'waiting',
            phase: 'verification',
            target: '等待人工验证',
            message: '检测到人机验证，自动操作已暂停，请手动完成。',
        });
        await this.captureScreenshot('human-verification');

        let lastReminderAt = Date.now();

        while (!this.shouldStop() && await this.getVerificationOverlay()) {
            await sleep(5_000);

            if (Date.now() - lastReminderAt >= 60_000) {
                await this.reporter.update({
                    message: '仍在等待手动完成人机验证。',
                });
                lastReminderAt = Date.now();
            }
        }

        if (!this.shouldStop()) {
            await this.reporter.update({
                level: 'running',
                phase: 'fishing',
                target: '恢复自动钓鱼',
                message: '人机验证已关闭，恢复自动化。',
            });
        }

        return true;
    }

    async getReadyCastButton() {
        const button = await firstVisible(
            this.page.locator('button[class*="flex-[85]"]'),
        );

        if (!button || !(await button.isEnabled())) {
            return null;
        }

        return button;
    }
}
