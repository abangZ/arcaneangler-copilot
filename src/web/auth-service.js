import {
    createHash,
    createHmac,
    pbkdf2,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(pbkdf2);
const CHALLENGE_TTL_MS = 60_000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
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

export class AuthService {
    constructor({ username, password, now = () => Date.now() }) {
        this.username = username;
        this.password = password;
        this.now = now;
        this.challenges = new Map();
        this.sessions = new Map();
        this.failures = new Map();
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

        if (this.sessions.size >= MAX_ACTIVE_SESSIONS) {
            const oldestSessionKey = this.sessions.keys().next().value;
            this.sessions.delete(oldestSessionKey);
        }

        this.sessions.set(sessionKey(token), session);
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

    logout(token) {
        if (token) {
            this.sessions.delete(sessionKey(token));
        }
    }
}
