import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import toolPlugin from 'mineflayer-tool';
import { Vec3 } from 'vec3';
import * as readline from 'readline';

import { log } from './src/log';
import { sleep } from './src/util';
import { state } from './src/state';
import { fightNearby } from './src/combat';
import { sealNearbyLava } from './src/lava';
import { ensureTools, craftTorches } from './src/craft';
import { depositRoutine } from './src/chest';
import { descendTo, stripMineStep } from './src/mine';
import { walkTo } from './src/recovery';
import { countItem } from './src/util';
import { needsProxy, startViaProxy, type ViaProxyHandle } from './src/viaproxy';

const TARGET_Y = Number(process.env.TARGET_Y ?? 12);
const HOST = process.env.MC_HOST ?? 'localhost';
const PORT = Number(process.env.MC_PORT ?? 25565);
const USER = process.env.MC_USER ?? 'Miner';
const MC_VERSION = process.env.MC_VERSION ?? 'b1.7.3';
const VIAPROXY_PORT = Number(process.env.VIAPROXY_PORT ?? 25568);
const CLIENT_VERSION = process.env.CLIENT_VERSION ?? '1.20.4';
const FORCE_PROXY = process.env.USE_VIAPROXY?.toLowerCase() === 'true';
const DISABLE_PROXY = process.env.USE_VIAPROXY?.toLowerCase() === 'false';
const INITIAL_MODE = (process.env.BOT_MODE?.toLowerCase() ?? 'auto') as
  | 'auto'
  | 'guided';

const startX =
  process.env.START_X !== undefined ? Number(process.env.START_X) : null;
const startY =
  process.env.START_Y !== undefined ? Number(process.env.START_Y) : null;
const startZ =
  process.env.START_Z !== undefined ? Number(process.env.START_Z) : null;

state.targetY = TARGET_Y;
state.mode = INITIAL_MODE;
if (startX !== null && startY !== null && startZ !== null) {
  state.home = new Vec3(startX, startY, startZ);
  log('home from env', `(${startX}, ${startY}, ${startZ})`);
}

let proxyHandle: ViaProxyHandle | null = null;
let botHost = HOST;
let botPort = PORT;
let botVersion: string = MC_VERSION;
let mainLoopRunning = false;

function createBot() {
  log('connecting bot', `${botHost}:${botPort}`, botVersion);
  const bot = mineflayer.createBot({
    host: botHost,
    port: botPort,
    username: USER,
    version: botVersion,
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin((toolPlugin as any).plugin ?? toolPlugin);

  bot.on('spawn', async () => {
    const p = bot.entity.position;
    log(
      'spawn at',
      `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`,
    );

    if (!state.home) {
      state.home = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      log('home set to', `(${state.home.x}, ${state.home.y}, ${state.home.z})`);
    } else if (state.mode === 'auto') {
      log(
        'respawn, walking to home',
        `(${state.home.x}, ${state.home.y}, ${state.home.z})`,
      );
      await walkTo(bot, state.home);
    } else {
      log('guided mode: skipping home walk — type coords or "auto" to mine');
    }

    if (!mainLoopRunning) {
      mainLoopRunning = true;
      mainLoop(bot).catch((e) => log('mainLoop crashed', e));
    }
  });

  bot.on('death', () => log('died, will respawn'));
  bot.on('kicked', (r) => log('kicked', r));
  bot.on('error', (e) => log('error', e?.message));
  bot.on('end', (r) => {
    log('disconnected', r);
    state.shouldStop = true;
    mainLoopRunning = false;
    if (!state.forceStop) {
      log('reconnecting in 5s...');
      setTimeout(() => {
        state.shouldStop = false;
        createBot();
      }, 5000);
    }
  });

  bot.on('entityHurt', (e) => {
    if (e === bot.entity) fightNearby(bot, 6).catch(() => {});
  });
}

function startGuidedModeInput() {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });
  log(`bot mode: ${state.mode} — commands: x y z | auto | guided`);

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed === 'auto') {
      state.mode = 'auto';
      state.guidedTarget = null;
      log('mode: auto — resuming autonomous mining');
      return;
    }

    if (trimmed === 'guided') {
      state.mode = 'guided';
      log('mode: guided — waiting for coords (x y z)');
      return;
    }

    const parts = trimmed.split(/[\s,]+/);
    if (parts.length === 3) {
      const nums = parts.map(Number) as number[];
      const [x, y, z] = nums;
      if (nums.some((n) => isNaN(n))) {
        log('invalid coords, use: x y z');
        return;
      }
      state.mode = 'guided';
      state.guidedTarget = new Vec3(x!, y!, z!);
      log('guided: target set to', `(${x}, ${y}, ${z})`);
    } else {
      log('commands: x y z | auto | guided');
    }
  });
}

async function main() {
  const useProxy = FORCE_PROXY || (!DISABLE_PROXY && needsProxy(MC_VERSION));
  if (useProxy) {
    log('viaproxy: required for', MC_VERSION, '→ starting proxy');
    proxyHandle = await startViaProxy({
      bindPort: VIAPROXY_PORT,
      targetHost: HOST,
      targetPort: PORT,
      targetVersion: MC_VERSION,
    });
    botHost = '127.0.0.1';
    botPort = VIAPROXY_PORT;
    botVersion = CLIENT_VERSION;
  }

  startGuidedModeInput();
  createBot();
}

async function maintain(bot: mineflayer.Bot): Promise<void> {
  await fightNearby(bot, 6);
  await sealNearbyLava(bot, 4);
  await ensureTools(bot);
  if (countItem(bot, (n) => n === 'torch') < 4) {
    await craftTorches(bot, 16);
  }
}

function inventoryFull(bot: mineflayer.Bot): boolean {
  const slots = bot.inventory.slots.length;
  const used = bot.inventory.items().length;
  return used > slots - 6;
}

async function mainLoop(bot: mineflayer.Bot): Promise<void> {
  await sleep(2000);
  log('main: target Y', TARGET_Y);
  let lastMaintainAt = 0;

  while (!state.shouldStop) {
    try {
      if (state.mode === 'guided') {
        if (state.guidedTarget) {
          const target = state.guidedTarget;
          log('guided: walking to', `(${target.x}, ${target.y}, ${target.z})`);

          const arrived = await walkTo(bot, target);

          if (state.guidedTarget === target) {
            if (arrived) {
              state.guidedTarget = null;
              log('guided: arrived — type coords or "auto" to mine');
            } else {
              log('guided: failed to reach destination within time limit.');
            }
          }
        } else {
          const now = Date.now();
          if (now - lastMaintainAt > 30_000) {
            await maintain(bot);
            lastMaintainAt = Date.now();
          }
          await sleep(1000);
        }
        continue;
      }

      await maintain(bot);

      if (Math.floor(bot.entity.position.y) > TARGET_Y + 2) {
        log('descending');
        await descendTo(bot, TARGET_Y);
      }

      if (inventoryFull(bot)) {
        log('inventory full, depositing');
        const ok = await depositRoutine(bot);
        if (!ok) log('deposit failed, will retry');
      }

      await stripMineStep(bot, state.miningDir, 8);
    } catch (e: any) {
      log('loop iter error', e?.message);
      await sleep(1000);
    }
  }
}

function shutdown() {
  log('shutdown');
  state.shouldStop = true;
  state.forceStop = true;
  proxyHandle?.stop();
  setTimeout(() => process.exit(0), 200);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => {
  log('fatal', e?.message ?? e);
  proxyHandle?.stop();
  process.exit(1);
});
