import mineflayer from 'mineflayer';
import { config } from './config';
import { ViaProxy } from './infra/ViaProxy';
import { Logger, LogUiOutlet, installLogUiOutlet } from './shared/Logger';
import { sink } from './shared/Sink';
import { BotKernel } from './core/BotKernel';
import type { AsyncResult } from './shared/result';
import { wrap, okVoid } from './shared/result';
import { BotFleet } from './core/BotFleet';
import { UiEventBus } from './ui/UiEventBus';
import { UIManager } from './UIManager';
import { InputHandler } from './core/InputHandler';
import { MacroStore } from './core/MacroStore';
import { ReplayFleetBridge } from './replay/ReplayFleetBridge';
import { ReplayState } from './replay/ReplayState';
import { ReplayDrive } from './replay/ReplayDrive';
import { pumpReplayFile } from './replay/pumpReplayFile';
import { jsonParseLine } from './replay/replayJsonl';
import { parseWebArgv } from './web/webArgv';
import { WebCompanion } from './web/WebCompanion';
import { getTraceId } from './shared/traceContext';

const log = new Logger('main');

class BotRunner {
  private proxy: ViaProxy | null = null;
  private viaproxyListenPort = 0;
  private readonly fleet = new BotFleet();
  private readonly macros = new MacroStore();
  private ui: UIManager | null = null;
  private shuttingDown = false;
  private readonly logOutlet = new LogUiOutlet();
  private webCompanion: WebCompanion | null = null;
  private readonly uiBus = new UiEventBus();
  private lastWorldEmitFocus = '';
  private lastWorldEmitCol = Number.NaN;
  private lastWorldEmitRow = Number.NaN;

  private maybeEmitCompanionWorldGrid(): void {
    const fid = this.fleet.focusedId();
    const k = this.fleet.focusedKernel();
    if (k === null) return;
    const e = k.bot.entity;
    if (e === undefined) return;
    const col = Math.floor(e.position.x);
    const row = Math.floor(e.position.z);
    if (fid !== this.lastWorldEmitFocus) {
      this.lastWorldEmitFocus = fid;
      this.lastWorldEmitCol = Number.NaN;
      this.lastWorldEmitRow = Number.NaN;
    }
    if (col === this.lastWorldEmitCol && row === this.lastWorldEmitRow) return;
    this.lastWorldEmitCol = col;
    this.lastWorldEmitRow = row;
    const snap = k.movementGrid16();
    if (snap === null) return;
    const cells = snap.cells.map((c): string => (c === 'water' ? 'w' : 'g'));
    const msg: Record<string, unknown> = {
      type: 'world_grid',
      botId: k.botId,
      anchorX: snap.anchorX,
      anchorY: snap.anchorY,
      anchorZ: snap.anchorZ,
      side: snap.side,
      cells,
    };
    const tid = getTraceId();
    if (tid !== undefined) msg.trace_id = tid;
    this.uiBus.emitCompanion(msg);
  }

  private shouldUseProxy(): boolean {
    const { DISABLE_PROXY, FORCE_PROXY, VERSION } = config.env;
    if (DISABLE_PROXY) return false;
    if (FORCE_PROXY) return true;
    return ViaProxy.needsProxy(VERSION);
  }

  private async startProxy(): AsyncResult<null> {
    const { HOST, PORT, VERSION, VIAPROXY_PORT } = config.env;
    let bindPort = VIAPROXY_PORT;
    if (bindPort === 0) {
      const [e0, p] = await ViaProxy.allocateLocalPort();
      if (e0) return [e0, null];
      if (p === null)
        return [new Error('allocateLocalPort returned no port'), null];
      bindPort = p;
    }

    this.viaproxyListenPort = bindPort;
    this.proxy = new ViaProxy({
      bindPort,
      targetHost: HOST,
      targetPort: PORT,
      targetVersion: VERSION,
    });
    return this.proxy.start();
  }

  private patchBlockRegistry(bot: mineflayer.Bot): void {
    bot.once('inject_allowed', (): void => {
      const problematicBlocks = new Set([
        'cobblestone_stairs',
        'oak_stairs',
        'stone_stairs',
        'stone_slab',
      ]);

      for (const blockName of problematicBlocks) {
        const block = bot.registry.blocksByName[blockName];
        if (block) {
          block.boundingBox = 'block';
        }
      }

      const redstoneWire = bot.registry.blocksByName['redstone_wire'];
      if (redstoneWire) {
        redstoneWire.boundingBox = 'empty';
      }
    });
  }

  private createBot(username: string): mineflayer.Bot {
    const { HOST, PORT, VERSION, CLIENT_VERSION, AUTH } = config.env;
    const useProxy = this.proxy !== null;

    const bot = mineflayer.createBot({
      host: useProxy ? '127.0.0.1' : HOST,
      port: useProxy ? this.viaproxyListenPort : PORT,
      version: useProxy ? CLIENT_VERSION : VERSION,
      username,
      auth: AUTH,
    });

    this.patchBlockRegistry(bot);
    return bot;
  }

  private shutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    this.fleet.haltAll();
    this.logOutlet.detach();
    if (this.webCompanion !== null) {
      this.webCompanion.stop();
      this.webCompanion = null;
    }
    if (this.ui !== null) {
      this.ui.destroy();
      this.ui = null;
    }
    sink.close();
    this.proxy?.stop();
    process.exit(0);
  }

  private wantsWebCompanion(): boolean {
    if (parseWebArgv(process.argv.slice(2)).enable) return true;
    return config.env.WEB_COMPANION === '1';
  }

  private webCompanionPort(): number {
    const p = parseWebArgv(process.argv.slice(2)).port;
    return p ?? config.env.WEB_PORT;
  }

  private attachWebCompanion(): void {
    if (!this.wantsWebCompanion()) return;
    const bind = config.env.WEB_BIND;
    const port = this.webCompanionPort();
    const companion = new WebCompanion();
    const [err] = companion.start(bind, port, this.uiBus);
    if (err !== null) {
      log.error('web companion failed', err.message);
      companion.stop();
      return;
    }
    this.webCompanion = companion;
    log.info('web companion', `http://${bind}:${port}/`);
  }

  private homeXZFromConfig(): { x: number; z: number } | null {
    const h = config.env.home;
    if (h === null) return null;
    return { x: h.x, z: h.z };
  }

  private mountUiShell(): void {
    if (this.ui !== null) return;
    this.ui = new UIManager(
      (): void => this.shutdown(),
      (): string[] => this.fleet.allRegisteredIds(),
      (): string[] => this.macros.names(),
      this.uiBus,
    );

    installLogUiOutlet(this.logOutlet);
    this.logOutlet.attach((line): void => {
      this.uiBus.emitLog(line);
    });

    this.attachWebCompanion();
    this.ui.render();
  }

  private async runReplay(path: string): AsyncResult<null> {
    const state = new ReplayState();
    const pulse = (): void => {
      this.uiBus.emitStatus(state.toPayload(this.homeXZFromConfig()));
    };

    const rfleet = new ReplayFleetBridge(state, pulse);

    this.ui = new UIManager(
      (): void => this.shutdown(),
      (): string[] => state.allIds(),
      (): string[] => this.macros.names(),
      this.uiBus,
    );

    installLogUiOutlet(this.logOutlet);
    this.logOutlet.attach((line): void => {
      this.uiBus.emitLog(line);
    });

    this.attachWebCompanion();

    const toUi = (msg: string): void => {
      this.uiBus.emitLog({
        botId: null,
        level: 'info',
        text: msg,
        ts: new Date().toISOString(),
      });
    };

    const input = new InputHandler(
      rfleet,
      toUi,
      (): void => this.shutdown(),
      this.ui,
      this.macros,
    );
    this.ui.onFleetFocus((id): void => {
      rfleet.setFocus(id);
    });
    this.ui.onSubmit((line): void => input.handleLine(line));
    this.ui.render();

    toUi(`replay file: ${path}`);

    let drive: ReplayDrive | null = null;

    const [pe, pump] = await pumpReplayFile(
      path,
      this.uiBus,
      state,
      pulse,
      (m): void => toUi(m),
    );
    if (pe !== null) {
      toUi(`replay error: ${pe.message}`);
      log.error('replay', pe.message);
      return [pe, null];
    }

    if (pump !== null && pump.count > 0) {
      drive = new ReplayDrive(
        path,
        this.uiBus,
        state,
        pulse,
        pump.index,
        pump.checkpoints,
      );
      const b = drive.timelineBounds();
      this.uiBus.emitCompanion({
        type: 'replay_ready',
        minTs: b.minTs,
        maxTs: b.maxTs,
      });
    }

    if (this.webCompanion !== null) {
      this.webCompanion.setClientWsHandler((raw: string): void => {
        if (drive === null) return;
        const [je, v] = jsonParseLine(raw);
        if (je !== null) return;
        if (v === null) return;
        if (typeof v !== 'object') return;
        const o = v as Record<string, unknown>;
        if (o['type'] !== 'replay_seek') return;
        const ts = o['tsMs'];
        if (typeof ts !== 'number') return;
        void drive.seekToTsMs(ts).then((r): void => {
          const err = r[0];
          if (err !== null) toUi(`replay seek: ${err.message}`);
        });
      });
    }

    pulse();
    toUi(`replay loaded ${pump?.count ?? 0} event(s) — read-only`);
    return okVoid();
  }

  public async run(): AsyncResult<null> {
    const replayPath = config.env.REPLAY_JSONL;
    if (replayPath !== undefined) return this.runReplay(replayPath);

    const useProxy = this.shouldUseProxy();
    if (useProxy) {
      this.mountUiShell();
      log.info('Starting ViaProxy…');
      const [e] = await this.startProxy();
      if (e) return [e, null];
    }
    if (!useProxy) {
      this.mountUiShell();
    }

    const ui = this.ui;
    if (ui === null) return [new Error('UI failed to mount'), null];

    const [sinkErr] = await sink.open(config.env.LOG_DIR);
    if (sinkErr) log.error('sink open failed', sinkErr.message);
    if (!sinkErr) {
      const p = sink.paths();
      log.info('logs ->', p.text, '|', p.jsonl);
    }

    this.fleet.setStatusRefresh((): void => {
      this.uiBus.emitStatus({
        focused: this.fleet.focusedSnapshot(),
        fleet: this.fleet.fleetSnapshots(),
        focusedId: this.fleet.focusedId(),
        homeXZ: this.fleet.homeXZ(),
      });
      this.maybeEmitCompanionWorldGrid();
    });

    const toUi = (msg: string): void => {
      this.uiBus.emitLog({
        botId: null,
        level: 'info',
        text: msg,
        ts: new Date().toISOString(),
      });
    };

    const input = new InputHandler(
      this.fleet,
      toUi,
      () => this.shutdown(),
      ui,
      this.macros,
    );
    ui.onFleetFocus((id): void => {
      this.fleet.setFocus(id);
    });
    ui.onSubmit((line): void => input.handleLine(line));
    ui.render();

    for (const username of config.env.usernames) {
      const bot = this.createBot(username);
      const kernel = new BotKernel(
        bot,
        username,
        (): void => this.fleet.touchStatus(),
        (msg): void => this.uiBus.emitCompanion(msg),
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
        kernel.metricsExporter.stop();
        this.fleet.markDisconnected(username);
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
