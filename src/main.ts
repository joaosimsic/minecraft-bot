import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { config } from './config';
import { ViaProxy } from './ViaProxy';
import { Logger } from './Logger';
import { Navigator } from './Navigator';
import { Mine } from './Mine';
import { Craft } from './Craft';
import { Chest } from './Chest';
import { Door } from './Door';
import { AutoMode } from './modes/AutoMode';
import { GuidedMode } from './modes/GuidedMode';
import { ModeController } from './modes/ModeController';
import { InputHandler } from './InputHandler';
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

    const door = new Door(bot);
    const navigator = new Navigator(bot, door);
    const mine = new Mine(bot);
    const craft = new Craft(bot);
    const chest = new Chest(bot);

    const autoMode = new AutoMode(mine, craft, chest);
    const guidedMode = new GuidedMode(navigator);
    const controller = new ModeController();
    const input = new InputHandler(controller, autoMode, guidedMode);

    if (config.env.MODE === 'auto') controller.switchTo(autoMode);

    bot.once('spawn', () => {
      log.info('spawned — commands: auto | guided | stop | exit | <x> <y> <z>');
      void wrap(controller.run()).then(([le]) => {
        if (le) log.error('loop crashed', le.message);
      });
    });

    bot.on('error', (e: Error) => log.error('bot error', e.message));
    bot.on('kicked', (reason: string) => log.warn('kicked', reason));
    bot.on('end', () => {
      log.info('disconnected');
      controller.halt();
      input.close();
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
