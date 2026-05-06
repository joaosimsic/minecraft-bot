import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { config } from './config';
import { state } from './state';
import { ViaProxy } from './ViaProxy';
import { Logger } from './Logger';
import { Utils } from './Utils';
import { Navigator } from './Navigator';
import { Mine } from './Mine';
import { Craft } from './Craft';
import { Chest } from './Chest';
import { Door } from './Door';

const log = new Logger('main');

class BotRunner {
  private proxy: ViaProxy | null = null;

  private shouldUseProxy(): boolean {
    const { DISABLE_PROXY, FORCE_PROXY, VERSION } = config.env;
    if (DISABLE_PROXY) return false;
    if (FORCE_PROXY) return true;
    return ViaProxy.needsProxy(VERSION);
  }

  private async startProxy(): Promise<void> {
    const { HOST, PORT, VERSION, VIAPROXY_PORT } = config.env;
    this.proxy = new ViaProxy({
      bindPort: VIAPROXY_PORT,
      targetHost: HOST,
      targetPort: PORT,
      targetVersion: VERSION,
    });
    await this.proxy.start();
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

  private async runGuided(navigator: Navigator): Promise<void> {
    if (!state.guidedTarget) {
      await Utils.sleep(1000);
      return;
    }
    await navigator.walkTo(state.guidedTarget);
    state.guidedTarget = null;
  }

  private async runAuto(mine: Mine, craft: Craft, chest: Chest): Promise<void> {
    await craft.ensureTools();
    await craft.craftTorches();
    await mine.descendTo(state.targetY);
    await mine.stripMineStep(state.miningDir, 16);
    await chest.depositRoutine();
  }

  private async runLoop(
    mine: Mine,
    craft: Craft,
    chest: Chest,
    navigator: Navigator,
  ): Promise<void> {
    while (!state.forceStop) {
      if (state.shouldStop) {
        await Utils.sleep(1000);
        continue;
      }

      if (state.mode === 'guided') {
        await this.runGuided(navigator);
        continue;
      }

      await this.runAuto(mine, craft, chest);
    }
  }

  public async run(): Promise<void> {
    if (this.shouldUseProxy()) await this.startProxy();

    const bot = this.createBot();
    bot.loadPlugin(pathfinder);

    const door = new Door(bot);
    const navigator = new Navigator(bot, door);
    const mine = new Mine(bot);
    const craft = new Craft(bot);
    const chest = new Chest(bot);

    bot.once('spawn', () => {
      log.info('spawned');
      this.runLoop(mine, craft, chest, navigator).catch((e: Error) =>
        log.error('loop crashed', e.message),
      );
    });

    bot.on('error', (e: Error) => log.error('bot error', e.message));
    bot.on('kicked', (reason: string) => log.warn('kicked', reason));
    bot.on('end', () => {
      log.info('disconnected');
      this.proxy?.stop();
    });
  }
}

new BotRunner().run().catch((e: Error) => {
  log.error('fatal', e.message);
  process.exit(1);
});
