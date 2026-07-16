import {
    createHash,
    createHmac,
    pbkdf2,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const deriveKey = promisify(pbkdf2);
const CHALLENGE_TTL_MS = 60_000;
const SESSION_TTL_MS = 31 * 24 * 60 * 60 * 1_000;
const SESSION_STORE_VERSION = 1;
const FAILURE_WINDOW_MS = 15 * 60 * 1_000;
const MAX_FAILURES = 5;
const PBKDF2_ITERATIONS = 210_000;
const MAX_ACTIVE_CHALLENGES_PER_IP = 10;
const MAX_ACTIVE_CHALLENGES = 1_000;
const MAX_ACTIVE_SESSIONS = 100;

class AuthenticationError extends Error {
    constructor(message, statusCode = 401) {
        super(message);
        this.name = 'AuthenticationError';
        this.statusCode = statusCode;
    }
}

function base64Url(buffer) {
    return Buffer.from(buffer).toString('base64url');
}

function sessionKey(token) {
    return createHash('sha256').update(token).digest('hex');
}

function safeEqual(left, right) {
    try {
        const leftBuffer = Buffer.from(left, 'base64url');
        const rightBuffer = Buffer.from(right, 'base64url');

        return (
            leftBuffer.length === rightBuffer.length &&
            timingSafeEqual(leftBuffer, rightBuffer)
        );
    } catch {
        return false;
    }
}

function cloneSessions(sessions) {
    return new Map(
        [...sessions].map(([key, session]) => [
            key,
            structuredClone(session),
        ]),
    );
}

function normalizeStoredSession(value, username, now) {
    if (
        !value ||
        typeof value !== 'object' ||
        !/^[a-f0-9]{64}$/.test(value.key) ||
        value.username !== username ||
        !/^[A-Za-z0-9_-]{32}$/.test(value.csrfToken) ||
        !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt <= now
    ) {
        return null;
    }

    return {
        key: value.key,
        session: {
            username: value.username,
            csrfToken: value.csrfToken,
            expiresAt: value.expiresAt,
        },
    };
}

export class AuthService {
    constructor({
        username,
        password,
        filePath = null,
        now = () => Date.now(),
    }) {
        this.username = username;
        this.password = password;
        this.filePath = filePath;
        this.now = now;
        this.challenges = new Map();
        this.sessions = new Map();
        this.failures = new Map();
        this.updateQueue = Promise.resolve();
        this.loadError = null;
    }

    async initialize() {
        if (!this.filePath) {
            return;
        }

        const directory = path.dirname(this.filePath);

        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        await fs.chmod(directory, 0o700);

        try {
            const raw = await fs.readFile(this.filePath, 'utf8');
            const stored = JSON.parse(raw);

            if (
                stored.version !== SESSION_STORE_VERSION ||
                !Array.isArray(stored.sessions)
            ) {
                throw new Error('Web session 存储格式不受支持。');
            }

            const now = this.now();
            const sessions = stored.sessions
                .map(value => normalizeStoredSession(
                    value,
                    this.username,
                    now,
                ))
                .filter(Boolean)
                .slice(-MAX_ACTIVE_SESSIONS);

            this.sessions = new Map(
                sessions.map(({ key, session }) => [key, session]),
            );

            if (sessions.length === stored.sessions.length) {
                await fs.chmod(this.filePath, 0o600);
            } else {
                await this.writeSessions();
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.loadError = error.message;
            }
        }
    }

    getLoadError() {
        return this.loadError;
    }

    cleanup() {
        const now = this.now();

        for (const [id, challenge] of this.challenges) {
            if (challenge.expiresAt <= now) {
                this.challenges.delete(id);
            }
        }

        for (const [key, session] of this.sessions) {
            if (session.expiresAt <= now) {
                this.sessions.delete(key);
            }
        }

        for (const [ip, failure] of this.failures) {
            if (failure.windowStartedAt + FAILURE_WINDOW_MS <= now) {
                this.failures.delete(ip);
            }
        }
    }

    assertNotRateLimited(ip) {
        this.cleanup();
        const failure = this.failures.get(ip);

        if (failure?.count >= MAX_FAILURES) {
            throw new AuthenticationError(
                '登录失败次数过多，请 15 分钟后再试。',
                429,
            );
        }
    }

    recordFailure(ip) {
        const now = this.now();
        const current = this.failures.get(ip);

        if (!current || current.windowStartedAt + FAILURE_WINDOW_MS <= now) {
            this.failures.set(ip, {
                count: 1,
                windowStartedAt: now,
            });
            return;
        }

        current.count += 1;
    }

    createChallenge({ username, ip }) {
        this.assertNotRateLimited(ip);

        const ipChallengeCount = [...this.challenges.values()]
            .filter(challenge => challenge.ip === ip)
            .length;

        if (
            ipChallengeCount >= MAX_ACTIVE_CHALLENGES_PER_IP ||
            this.challenges.size >= MAX_ACTIVE_CHALLENGES
        ) {
            throw new AuthenticationError(
                '登录请求过于频繁，请稍后再试。',
                429,
            );
        }

        if (typeof username !== 'string' || !username.trim()) {
            throw new AuthenticationError('请输入登录用户名。', 400);
        }

        const id = base64Url(randomBytes(18));
        const challenge = {
            id,
            username: username.trim(),
            ip,
            salt: base64Url(randomBytes(16)),
            nonce: base64Url(randomBytes(32)),
            iterations: PBKDF2_ITERATIONS,
            expiresAt: this.now() + CHALLENGE_TTL_MS,
        };

        this.challenges.set(id, challenge);
        return {
            challengeId: challenge.id,
            salt: challenge.salt,
            nonce: challenge.nonce,
            iterations: challenge.iterations,
            expiresAt: new Date(challenge.expiresAt).toISOString(),
        };
    }

    async login({ username, challengeId, proof, ip }) {
        this.assertNotRateLimited(ip);

        const challenge = this.challenges.get(challengeId);
        this.challenges.delete(challengeId);

        if (
            !challenge ||
            challenge.expiresAt <= this.now() ||
            challenge.ip !== ip ||
            challenge.username !== username
        ) {
            this.recordFailure(ip);
            throw new AuthenticationError('登录挑战已失效，请重新登录。');
        }

        const key = await deriveKey(
            this.password,
            Buffer.from(challenge.salt, 'base64url'),
            challenge.iterations,
            32,
            'sha256',
        );
        const message = [
            challenge.id,
            challenge.nonce,
            username,
        ].join('.');
        const expectedProof = createHmac('sha256', key)
            .update(message)
            .digest('base64url');

        if (username !== this.username || !safeEqual(proof, expectedProof)) {
            this.recordFailure(ip);
            throw new AuthenticationError('用户名或密码错误。');
        }

        this.failures.delete(ip);
        const token = base64Url(randomBytes(32));
        const session = {
            username: this.username,
            csrfToken: base64Url(randomBytes(24)),
            expiresAt: this.now() + SESSION_TTL_MS,
        };

        await this.updateSessions(() => {
            if (this.sessions.size >= MAX_ACTIVE_SESSIONS) {
                const oldestSessionKey = this.sessions.keys().next().value;
                this.sessions.delete(oldestSessionKey);
            }

            this.sessions.set(sessionKey(token), session);
        });

        return {
            token,
            session: structuredClone(session),
            maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1_000),
        };
    }

    getSession(token) {
        if (!token) {
            return null;
        }

        this.cleanup();
        const session = this.sessions.get(sessionKey(token));

        return session ? structuredClone(session) : null;
    }

    assertCsrf(session, token) {
        if (!token || !safeEqual(token, session.csrfToken)) {
            throw new AuthenticationError('CSRF 校验失败。', 403);
        }
    }

    async logout(token) {
        if (!token) {
            return;
        }

        await this.updateSessions(() => {
            this.sessions.delete(sessionKey(token));
        });
    }

    async updateSessions(update) {
        const result = this.updateQueue.then(
            () => this.updateSessionsUnlocked(update),
            () => this.updateSessionsUnlocked(update),
        );

        this.updateQueue = result.catch(() => {});
        return result;
    }

    async updateSessionsUnlocked(update) {
        const previous = cloneSessions(this.sessions);

        update();

        try {
            await this.writeSessions();
            this.loadError = null;
        } catch (error) {
            this.sessions = previous;
            throw error;
        }
    }

    async writeSessions() {
        if (!this.filePath) {
            return;
        }

        const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
        const serialized = `${JSON.stringify({
            version: SESSION_STORE_VERSION,
            sessions: [...this.sessions].map(([key, session]) => ({
                key,
                ...session,
            })),
        }, null, 2)}\n`;

        try {
            await fs.writeFile(temporaryPath, serialized, { mode: 0o600 });
            await fs.chmod(temporaryPath, 0o600);
            await fs.rename(temporaryPath, this.filePath);
        } finally {
            await fs.unlink(temporaryPath).catch(() => {});
        }
    }
}
