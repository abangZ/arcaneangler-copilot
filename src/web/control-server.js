import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COOKIE_NAME = 'arcane_session';
const MAX_BODY_BYTES = 64 * 1_024;
const publicDirectory = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'public',
);
const STATIC_FILES = Object.freeze({
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
});

function json(response, statusCode, body, headers = {}) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...headers,
    });
    response.end(JSON.stringify(body));
}

function parseCookies(header = '') {
    const cookies = {};

    for (const part of header.split(';')) {
        const separator = part.indexOf('=');

        if (separator < 1) {
            continue;
        }

        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();

        cookies[name] = value;
    }

    return cookies;
}

function isSecureRequest(request) {
    return Boolean(request.socket.encrypted) ||
        request.headers['x-forwarded-proto']
            ?.split(',')[0]
            .trim()
            .toLowerCase() === 'https';
}

function sessionCookie(token, maxAgeSeconds, secure) {
    return [
        `${COOKIE_NAME}=${token}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        `Max-Age=${maxAgeSeconds}`,
        secure ? 'Secure' : null,
    ].filter(Boolean).join('; ');
}

function clearSessionCookie(secure) {
    return [
        `${COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        'Max-Age=0',
        secure ? 'Secure' : null,
    ].filter(Boolean).join('; ');
}

function writeSse(response, event, data, id = null) {
    if (id != null) {
        response.write(`id: ${id}\n`);
    }

    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readJson(request) {
    const contentType = request.headers['content-type'] || '';

    if (!contentType.toLowerCase().startsWith('application/json')) {
        const error = new Error('请求必须使用 application/json。');
        error.statusCode = 415;
        throw error;
    }

    const chunks = [];
    let size = 0;

    for await (const chunk of request) {
        size += chunk.length;

        if (size > MAX_BODY_BYTES) {
            const error = new Error('请求内容过大。');
            error.statusCode = 413;
            throw error;
        }

        chunks.push(chunk);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
        const error = new Error('请求 JSON 格式错误。');
        error.statusCode = 400;
        throw error;
    }
}

export class ControlServer {
    constructor({
        host,
        port,
        authService,
        settingsStore,
        statsStore,
        controller,
        reporter,
    }) {
        this.host = host;
        this.port = port;
        this.authService = authService;
        this.settingsStore = settingsStore;
        this.statsStore = statsStore;
        this.controller = controller;
        this.reporter = reporter;
        this.streams = new Set();
        this.server = http.createServer((request, response) => {
            this.handle(request, response).catch(error => {
                if (response.headersSent) {
                    response.end();
                    return;
                }

                json(response, error.statusCode || 500, {
                    error: error.statusCode
                        ? error.message
                        : '服务器内部错误。',
                });
            });
        });
        this.server.requestTimeout = 30_000;
        this.server.headersTimeout = 15_000;
        this.server.keepAliveTimeout = 5_000;
        this.server.maxRequestsPerSocket = 1_000;
    }

    async start() {
        await new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(this.port, this.host, () => {
                this.server.off('error', reject);
                resolve();
            });
        });

        return this.address();
    }

    address() {
        const address = this.server.address();

        if (!address || typeof address === 'string') {
            return { host: this.host, port: this.port };
        }

        return { host: address.address, port: address.port };
    }

    async close() {
        for (const response of this.streams) {
            response.end();
        }
        this.streams.clear();

        if (!this.server.listening) {
            return;
        }

        await new Promise((resolve, reject) => {
            this.server.close(error => error ? reject(error) : resolve());
        });
    }

    applySecurityHeaders(request, response) {
        response.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        );
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('X-Frame-Options', 'DENY');
        response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

        if (isSecureRequest(request)) {
            response.setHeader(
                'Strict-Transport-Security',
                'max-age=31536000',
            );
        }
    }

    assertSameOrigin(request) {
        const origin = request.headers.origin;

        if (!origin) {
            return;
        }

        const host = request.headers.host;
        const expectedOrigins = [`http://${host}`, `https://${host}`];

        if (!expectedOrigins.includes(origin)) {
            const error = new Error('请求来源校验失败。');
            error.statusCode = 403;
            throw error;
        }
    }

    requestIp(request) {
        const remoteAddress = request.socket.remoteAddress || 'unknown';
        const isLoopback = [
            '127.0.0.1',
            '::1',
            '::ffff:127.0.0.1',
        ].includes(remoteAddress);
        const forwardedFor = request.headers['x-forwarded-for']
            ?.split(',')[0]
            .trim();

        return isLoopback && forwardedFor
            ? forwardedFor
            : remoteAddress;
    }

    requireSession(request) {
        const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
        const session = this.authService.getSession(token);

        if (!session) {
            const error = new Error('登录已过期，请重新登录。');
            error.statusCode = 401;
            throw error;
        }

        return { token, session };
    }

    requireMutationSession(request) {
        this.assertSameOrigin(request);
        const authenticated = this.requireSession(request);

        this.authService.assertCsrf(
            authenticated.session,
            request.headers['x-csrf-token'],
        );
        return authenticated;
    }

    async handle(request, response) {
        this.applySecurityHeaders(request, response);
        const url = new URL(request.url, 'http://localhost');
        const { pathname } = url;

        if (request.method === 'GET' && STATIC_FILES[pathname]) {
            const [fileName, contentType] = STATIC_FILES[pathname];
            const content = await fs.readFile(
                path.join(publicDirectory, fileName),
            );

            response.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': fileName === 'index.html'
                    ? 'no-store'
                    : 'no-cache',
            });
            response.end(content);
            return;
        }

        if (request.method === 'GET' && pathname === '/healthz') {
            json(response, 200, { ok: true });
            return;
        }

        if (request.method === 'POST' && pathname === '/api/auth/challenge') {
            this.assertSameOrigin(request);
            const body = await readJson(request);
            const challenge = this.authService.createChallenge({
                username: body.username,
                ip: this.requestIp(request),
            });

            json(response, 200, challenge);
            return;
        }

        if (request.method === 'POST' && pathname === '/api/auth/login') {
            this.assertSameOrigin(request);
            const body = await readJson(request);
            const username = typeof body.username === 'string'
                ? body.username.trim()
                : body.username;
            const result = await this.authService.login({
                username,
                challengeId: body.challengeId,
                proof: body.proof,
                ip: this.requestIp(request),
            });

            await this.reporter.log({
                level: 'idle',
                phase: 'web',
                target: 'Web 用户登录',
                message: `用户 ${result.session.username} 已登录控制台。`,
            });

            json(response, 200, {
                username: result.session.username,
                csrfToken: result.session.csrfToken,
                expiresAt: new Date(result.session.expiresAt).toISOString(),
                secureTransport: isSecureRequest(request),
            }, {
                'Set-Cookie': sessionCookie(
                    result.token,
                    result.maxAgeSeconds,
                    isSecureRequest(request),
                ),
            });
            return;
        }

        if (request.method === 'GET' && pathname === '/api/session') {
            const { session } = this.requireSession(request);

            json(response, 200, {
                username: session.username,
                csrfToken: session.csrfToken,
                expiresAt: new Date(session.expiresAt).toISOString(),
                secureTransport: isSecureRequest(request),
            });
            return;
        }

        if (request.method === 'POST' && pathname === '/api/auth/logout') {
            const { token } = this.requireMutationSession(request);

            this.authService.logout(token);
            await this.reporter.log({
                level: 'idle',
                phase: 'web',
                target: 'Web 用户退出',
                message: '当前 Web session 已退出。',
            });
            json(response, 200, { ok: true }, {
                'Set-Cookie': clearSessionCookie(isSecureRequest(request)),
            });
            return;
        }

        if (request.method === 'GET' && pathname === '/api/state') {
            this.requireSession(request);
            json(response, 200, {
                status: this.reporter.get(),
                controller: this.controller.getState(),
                settings: this.settingsStore.get(),
                stats: this.statsStore.get(),
            });
            return;
        }

        if (request.method === 'GET' && pathname === '/api/settings') {
            this.requireSession(request);
            json(response, 200, this.settingsStore.get());
            return;
        }

        if (request.method === 'GET' && pathname === '/api/stats') {
            this.requireSession(request);
            json(response, 200, this.statsStore.get());
            return;
        }

        if (request.method === 'GET' && pathname === '/api/logs') {
            this.requireSession(request);
            const afterId = Number(url.searchParams.get('afterId') || 0);
            const requestedLimit = Number(
                url.searchParams.get('limit') || 500,
            );
            const limit = Number.isSafeInteger(requestedLimit) &&
                requestedLimit >= 1
                ? Math.min(requestedLimit, 2_000)
                : 500;

            json(response, 200, {
                logs: this.reporter.getLogs({
                    afterId: Number.isSafeInteger(afterId) ? afterId : 0,
                    limit,
                }),
            });
            return;
        }

        if (request.method === 'PUT' && pathname === '/api/settings') {
            this.requireMutationSession(request);
            const body = await readJson(request);
            const { current, previous } = await this.settingsStore.update(
                body.settings,
                { expectedRevision: body.revision },
            );

            await this.controller.applySettings(previous, current);
            json(response, 200, {
                ...current,
                controller: this.controller.getState(),
            });
            return;
        }

        if (
            request.method === 'POST' &&
            pathname.startsWith('/api/actions/')
        ) {
            this.requireMutationSession(request);
            await readJson(request);
            const action = pathname.slice('/api/actions/'.length);
            const actions = {
                start: () => this.controller.start(),
                pause: () => this.controller.pause(),
                resume: () => this.controller.resume(),
                stop: () => this.controller.stop(),
                restart: () => this.controller.restart(),
            };

            if (!actions[action]) {
                const error = new Error('未知控制操作。');
                error.statusCode = 404;
                throw error;
            }

            const state = await actions[action]();
            json(response, 200, { controller: state });
            return;
        }

        if (request.method === 'GET' && pathname === '/api/events') {
            const { token } = this.requireSession(request);

            this.openEventStream(request, response, token);
            return;
        }

        json(response, 404, { error: '页面不存在。' });
    }

    openEventStream(request, response, sessionToken) {
        response.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        response.write('retry: 3000\n\n');
        this.streams.add(response);

        const streamUrl = new URL(request.url, 'http://localhost');
        const afterId = Number(
            request.headers['last-event-id'] ||
            streamUrl.searchParams.get('afterId') ||
            0,
        );
        for (const entry of this.reporter.getLogs({
            afterId: Number.isSafeInteger(afterId) ? afterId : 0,
        })) {
            writeSse(response, 'log', entry, entry.id);
        }

        writeSse(response, 'status', this.reporter.get());
        writeSse(response, 'controller', this.controller.getState());
        writeSse(response, 'settings', this.settingsStore.get());
        writeSse(response, 'stats', this.statsStore.get());

        const unsubscribeStatus = this.reporter.subscribeStatus(status => {
            writeSse(response, 'status', status);
            writeSse(response, 'controller', this.controller.getState());
        });
        const unsubscribeLogs = this.reporter.subscribeLogs(entry => {
            writeSse(response, 'log', entry, entry.id);
        });
        const unsubscribeController = this.controller.subscribe(state => {
            writeSse(response, 'controller', state);
        });
        const unsubscribeSettings = this.settingsStore.subscribe(settings => {
            writeSse(response, 'settings', settings);
        });
        const unsubscribeStats = this.statsStore.subscribe(stats => {
            writeSse(response, 'stats', stats);
        });
        const heartbeat = setInterval(() => {
            if (!this.authService.getSession(sessionToken)) {
                writeSse(response, 'auth', { authenticated: false });
                response.end();
                return;
            }

            response.write(': heartbeat\n\n');
        }, 15_000);

        const cleanup = () => {
            clearInterval(heartbeat);
            unsubscribeStatus();
            unsubscribeLogs();
            unsubscribeController();
            unsubscribeSettings();
            unsubscribeStats();
            this.streams.delete(response);
        };

        request.once('close', cleanup);
        response.once('close', cleanup);
        response.once('error', cleanup);
    }
}
