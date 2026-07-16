import { config } from './config.js';
import { AutomationWorker } from './core/automation-worker.js';
import { LogStore } from './core/log-store.js';
import { SettingsStore } from './core/settings-store.js';
import { StatsStore } from './core/stats-store.js';
import { StatusReporter } from './core/status-reporter.js';
import { WorkerController } from './core/worker-controller.js';
import { AuthService } from './web/auth-service.js';
import { ControlServer } from './web/control-server.js';

let server = null;
let controller = null;
let reporter = null;
let stopRequested = false;

function formatListenAddress({ host, port }) {
    const displayHost = host.includes(':') ? `[${host}]` : host;

    return `http://${displayHost}:${port}`;
}

async function close(signal) {
    if (stopRequested) {
        return;
    }

    stopRequested = true;
    await reporter?.update({
        level: 'idle',
        phase: 'stopping',
        target: '关闭 Copilot 服务',
        message: `收到 ${signal}，正在停止 Worker 和 Web 服务。`,
    });
    const serverClosePromise = server?.close().catch(() => {});

    await controller?.stop().catch(() => {});
    await serverClosePromise;
}

async function main() {
    const logStore = new LogStore({ directory: config.logsDir });
    const settingsStore = new SettingsStore({
        filePath: config.settingsFile,
    });
    const statsStore = new StatsStore({ filePath: config.statsFile });

    await Promise.all([
        logStore.initialize(),
        settingsStore.initialize(),
        statsStore.initialize(),
    ]);

    reporter = new StatusReporter({ logStore });
    controller = new WorkerController({
        settingsStore,
        reporter,
        createWorker: () => new AutomationWorker({
            staticConfig: config,
            settingsStore,
            statsStore,
            reporter,
        }),
    });

    const authService = new AuthService({
        username: config.username,
        password: config.password,
        filePath: config.sessionsFile,
    });

    await authService.initialize();

    server = new ControlServer({
        host: config.webHost,
        port: config.webPort,
        authService,
        settingsStore,
        statsStore,
        controller,
        reporter,
    });

    const address = await server.start();

    await reporter.update({
        level: 'idle',
        phase: 'web',
        target: '等待网页登录和手动启动',
        activeFeature: 'Web 控制面',
        message: `Web 控制面已启动：${formatListenAddress(address)}。Playwright Worker 尚未启动。`,
    });

    if (settingsStore.get().loadError) {
        await reporter.log({
            level: 'error',
            phase: 'web',
            target: '读取网页配置',
            message: `历史配置读取失败，已回退安全默认值：${settingsStore.get().loadError}`,
        });
    }

    if (statsStore.get().loadError) {
        await reporter.log({
            level: 'error',
            phase: 'web',
            target: '读取收益统计',
            message: `历史收益统计读取失败，已从空统计继续：${statsStore.get().loadError}`,
        });
    }

    if (authService.getLoadError()) {
        await reporter.log({
            level: 'error',
            phase: 'web',
            target: '读取 Web session',
            message: `历史 Web session 读取失败，已要求重新登录：${authService.getLoadError()}`,
        });
    }
}

process.once('SIGINT', () => {
    void close('SIGINT');
});
process.once('SIGTERM', () => {
    void close('SIGTERM');
});

main().catch(error => {
    if (!stopRequested) {
        console.error(
            `[${new Date().toISOString()}] [ERROR/process] 程序异常退出：`,
            error.stack || error.message,
        );
        process.exitCode = 1;
    }
});
