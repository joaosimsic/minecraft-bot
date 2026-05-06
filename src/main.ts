import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { config } from './config';
import { ViaProxy } from './ViaProxy';
import { Logger } from './Logger';
import { BotKernel } from './BotKernel';
import type { AsyncResult } from './result';
import { okVoid, wrap } from './result';

const log = new Logger('main');

class BotRunner {
  private proxy: ViaProxy | null = null;

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

  private createBot(): mineflayer.Bot {
    const { HOST, PORT, VERSION, VIAPROXY_PORT, CLIENT_VERSION, USER, AUTH } =
      config.env;
    const useProxy = this.proxy !== null;

    return mineflayer.createBot({
      host: useProxy ? '127.0.0.1' : HOST,
      port: useProxy ? VIAPROXY_PORT : PORT,
      version: useProxy ? CLIENT_VERSION : VERSION,
      username: USER,
      auth: AUTH,
    });
  }

  public async run(): AsyncResult<null> {
    if (this.shouldUseProxy()) {
      const [e] = await this.startProxy();
      if (e) return [e, null];
    }

    const bot = this.createBot();
    bot.loadPlugin(pathfinder);

    const kernel = new BotKernel(bot);

    if (config.env.MODE === 'auto') kernel.controller.switchTo(kernel.autoMode);

    bot.once('spawn', () => {
      log.info('spawned — commands: auto | guided | stop | exit | <x> <y> <z>');
      void wrap(kernel.controller.run()).then(([le]) => {
        if (le) log.error('loop crashed', le.message);
      });
    });

    bot.on('error', (e: Error) => log.error('bot error', e.message));
    bot.on('kicked', (reason: string) => log.warn('kicked', reason));
    bot.on('end', () => {
      log.info('disconnected');
      kernel.controller.halt();
      kernel.input.close();
      this.proxy?.stop();
    });

    return okVoid();
  }
}

const [fatal] = await new BotRunner().run();
if (fatal) {
  log.error('fatal', fatal.message);
  process.exit(1);
}
