import mineflayer from 'mineflayer';
import { config } from './config';
import { ViaProxy } from './infra/ViaProxy';
import { Logger, setLoggerUiSink } from './shared/Logger';
import { sink } from './shared/Sink';
import { BotKernel } from './core/BotKernel';
import type { AsyncResult } from './shared/result';
import { wrap, okVoid } from './shared/result';
import { BotFleet } from './core/BotFleet';
import { UIManager } from './UIManager';
import { InputHandler } from './core/InputHandler';

const log = new Logger('main');

class BotRunner {
  private proxy: ViaProxy | null = null;
  private readonly fleet = new BotFleet();
  private ui: UIManager | null = null;
  private shuttingDown = false;

  private shouldUseProxy(): boolean {
    const { DISABLE_PROXY, FORCE_PROXY, VERSION } = config.env;
    if (DISABLE_PROXY) return false;
    if (FORCE_PROXY) return true;
    return ViaProxy.needsProxy(VERSION);
  }

  private async startProxy(): AsyncResult<null> {
    const { HOST, PORT, VERSION, VIAPROXY_PORT } = config.env;
    this.proxy = new ViaProxy({
      bindPort: VIAPROXY_PORT,
      targetHost: HOST,
      targetPort: PORT,
      targetVersion: VERSION,
    });
    return this.proxy.start();
  }

  private createBot(username: string): mineflayer.Bot {
    const { HOST, PORT, VERSION, VIAPROXY_PORT, CLIENT_VERSION, AUTH } =
      config.env;
    const useProxy = this.proxy !== null;

    return mineflayer.createBot({
      host: useProxy ? '127.0.0.1' : HOST,
      port: useProxy ? VIAPROXY_PORT : PORT,
      version: useProxy ? CLIENT_VERSION : VERSION,
      username,
      auth: AUTH,
    });
  }

  private shutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    this.fleet.stopStatusTicker();
    this.fleet.haltAll();
    setLoggerUiSink(null);
    if (this.ui !== null) {
      this.ui.destroy();
      this.ui = null;
    }
    sink.close();
    this.proxy?.stop();
    process.exit(0);
  }

  public async run(): AsyncResult<null> {
    if (this.shouldUseProxy()) {
      const [e] = await this.startProxy();
      if (e) return [e, null];
    }

    this.ui = new UIManager(() => this.shutdown());
    setLoggerUiSink((line): void => {
      this.ui?.appendLogLine(line);
    });

    const [sinkErr] = await sink.open(config.env.LOG_DIR);
    if (sinkErr) log.error('sink open failed', sinkErr.message);
    if (!sinkErr) {
      const p = sink.paths();
      log.info('logs ->', p.text, '|', p.jsonl);
    }

    this.fleet.setStatusRefresh((): void => {
      this.ui?.updateStatus(
        this.fleet.focusedSnapshot(),
        this.fleet.fleetSnapshots(),
      );
    });
    this.fleet.startStatusTicker();

    const toUi = (msg: string): void => {
      this.ui?.appendLogLine({
        botId: null,
        level: 'info',
        text: msg,
        ts: new Date().toISOString(),
      });
    };

    const input = new InputHandler(this.fleet, toUi, () => this.shutdown());
    this.ui.onSubmit((line): void => input.handleLine(line));
    this.ui.render();

    for (const username of config.env.usernames) {
      const bot = this.createBot(username);
      const kernel = new BotKernel(bot, username, (): void =>
        this.fleet.touchStatus(),
      );
      this.fleet.register(kernel);

      if (config.env.MODE === 'auto')
        kernel.controller.switchTo(kernel.autoMode);
      if (config.env.MODE === 'guided')
        kernel.controller.switchTo(kernel.guidedMode);

      bot.once('spawn', (): void => {
        this.fleet.setPhase(username, 'running');
        log.info(
          'spawned — commands: auto | guided | stop | exit | <x> <y> <z>',
        );
        void wrap(kernel.controller.run()).then(([le]): void => {
          if (le) log.error('loop crashed', le.message);
        });
      });

      bot.on('error', (e: Error): void => {
        this.fleet.recordError(username, e.message);
        log.error('bot error', e.message);
      });
      bot.on('kicked', (reason: string): void => {
        this.fleet.recordError(username, reason);
        log.warn('kicked', reason);
      });
      bot.on('end', (): void => {
        log.info('disconnected', username);
        kernel.controller.halt();
        kernel.telemetry.stop();
        this.fleet.markDisconnected(username);
        if (this.fleet.onlineCount() === 0) this.shutdown();
      });
    }

    return okVoid();
  }
}

const [fatal] = await new BotRunner().run();
if (fatal) {
  log.error('fatal', fatal.message);
  process.exit(1);
}
