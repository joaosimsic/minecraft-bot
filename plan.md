# Plan: Strategy Pattern Mode System

## Context

The current mode system in `src/` has several problems:
- `state.mode` is a plain string in global state; mode is static (set from env at startup only)
- `BotRunner.runLoop()` branches with `if (state.mode === 'guided')` — violates the no-else constraint
- `shouldStop`, `forceStop`, `guidedTarget` are loose boolean/nullable flags in global state
- No runtime mode switching exists (the old code had stdin readline, but `src/` dropped it)
- Adding a new mode requires editing the main loop

**Goal:** Replace the string-flag pattern with a **Strategy Pattern** — each mode is a class, the loop
delegates to the current mode unconditionally via polymorphism.

---

## New File Structure

```
src/
  modes/
    BotMode.ts          (new) — interface
    IdleMode.ts         (new) — sleeps 1 s/tick; initial/paused state
    AutoMode.ts         (new) — wraps Mine + Craft + Chest
    GuidedMode.ts       (new) — owns target: Vec3 | null, wraps Navigator
    ModeController.ts   (new) — holds currentMode, runs while-loop, exposes switchTo/stop/halt
  InputHandler.ts       (new) — readline stdin; dispatch table → no if/else
  state.ts              (modify) — remove mode, guidedTarget, shouldStop, forceStop
  Mine.ts               (modify) — remove state.shouldStop guard at line 70
  main.ts               (modify) — remove runLoop/runGuided/runAuto; wire new classes
```

---

## Implementation

### `src/modes/BotMode.ts`
```typescript
export interface BotMode {
  tick(): Promise<void>;
}
```

### `src/modes/IdleMode.ts`
```typescript
import { Utils } from '../Utils';
import type { BotMode } from './BotMode';

export class IdleMode implements BotMode {
  public async tick(): Promise<void> {
    await Utils.sleep(1000);
  }
}
```

### `src/modes/AutoMode.ts`
```typescript
import type { BotMode } from './BotMode';
import type { Mine } from '../Mine';
import type { Craft } from '../Craft';
import type { Chest } from '../Chest';
import { state } from '../state';

export class AutoMode implements BotMode {
  public constructor(
    private readonly mine: Mine,
    private readonly craft: Craft,
    private readonly chest: Chest,
  ) {}

  public async tick(): Promise<void> {
    await this.craft.ensureTools();
    await this.craft.craftTorches();
    await this.mine.descendTo(state.targetY);
    await this.mine.stripMineStep(state.miningDir, 16);
    await this.chest.depositRoutine();
  }
}
```

### `src/modes/GuidedMode.ts`
```typescript
import { Vec3 } from 'vec3';
import { Utils } from '../Utils';
import type { BotMode } from './BotMode';
import type { Navigator } from '../Navigator';

export class GuidedMode implements BotMode {
  private target: Vec3 | null = null;

  public constructor(private readonly navigator: Navigator) {}

  public setTarget(target: Vec3): void {
    this.target = target;
  }

  public async tick(): Promise<void> {
    const t = this.target;
    if (t === null) {
      await Utils.sleep(1000);
      return;
    }
    await this.navigator.walkTo(t);
    this.target = null;
  }
}
```

### `src/modes/ModeController.ts`
```typescript
import { Logger } from '../Logger';
import type { BotMode } from './BotMode';
import { IdleMode } from './IdleMode';

export class ModeController {
  private readonly log = new Logger('ModeController');
  private currentMode: BotMode = new IdleMode();
  private active = true;

  public switchTo(mode: BotMode): void {
    this.log.info('mode ->', mode.constructor.name);
    this.currentMode = mode;
  }

  public stop(): void {
    this.log.info('pausing');
    this.currentMode = new IdleMode();
  }

  public halt(): void {
    this.log.info('halting');
    this.active = false;
  }

  public async run(): Promise<void> {
    while (this.active) {
      await this.currentMode.tick();
    }
  }
}
```

`run()` is a clean `while (this.active)` — no branching on mode type.

### `src/InputHandler.ts`
```typescript
import * as readline from 'node:readline';
import { Vec3 } from 'vec3';
import { Logger } from './Logger';
import type { ModeController } from './modes/ModeController';
import type { AutoMode } from './modes/AutoMode';
import type { GuidedMode } from './modes/GuidedMode';

export class InputHandler {
  private readonly log = new Logger('InputHandler');
  private readonly rl: readline.Interface;

  public constructor(
    private readonly controller: ModeController,
    private readonly autoMode: AutoMode,
    private readonly guidedMode: GuidedMode,
  ) {
    this.rl = readline.createInterface({ input: process.stdin, terminal: false });
    this.rl.on('line', (line: string) => this.handleLine(line.trim()));
  }

  private handleLine(line: string): void {
    const parts = line.split(/\s+/);

    const commands: Record<string, () => void> = {
      auto:   () => this.controller.switchTo(this.autoMode),
      guided: () => this.controller.switchTo(this.guidedMode),
      stop:   () => this.controller.stop(),
      exit:   () => { this.controller.halt(); this.rl.close(); },
    };

    const cmd = commands[parts[0] ?? ''];
    if (cmd !== undefined) {
      cmd();
      return;
    }

    const coords = this.parseCoords(parts);
    if (coords !== null) {
      this.guidedMode.setTarget(coords);
      this.controller.switchTo(this.guidedMode);
      this.log.info('target ->', `(${coords.x}, ${coords.y}, ${coords.z})`);
      return;
    }

    this.log.warn('unknown command. try: auto | guided | stop | exit | <x> <y> <z>');
  }

  private parseCoords(parts: string[]): Vec3 | null {
    if (parts.length < 3) return null;
    const [x, y, z] = parts.slice(0, 3).map(Number);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return null;
    return new Vec3(x, y, z);
  }

  public close(): void {
    this.rl.close();
  }
}
```

Dispatch uses a `Record` lookup — no `if`/`else`.

### `src/state.ts` — remove 4 fields
```typescript
import { Vec3 } from 'vec3';
import { config } from './config';

export interface BotState {
  home: Vec3 | null;
  targetY: number;
  miningDir: Vec3;
  busy: boolean;
}

export const state: BotState = {
  home: config.env.home,
  targetY: config.env.TARGET_Y,
  miningDir: new Vec3(1, 0, 0),
  busy: false,
};
```

`mode`, `guidedTarget`, `shouldStop`, `forceStop` move into their respective classes.

### `src/Mine.ts` — line 70
```diff
-      if (state.shouldStop) return;
```
Remove the `state` import if it becomes unused after this deletion.

### `src/main.ts` — simplified BotRunner
Remove `runLoop`, `runGuided`, `runAuto`. Replace with:

```typescript
// inside BotRunner.run(), after creating mine/craft/chest/navigator:

const autoMode   = new AutoMode(mine, craft, chest);
const guidedMode = new GuidedMode(navigator);
const controller = new ModeController();
const input      = new InputHandler(controller, autoMode, guidedMode);

if (config.env.MODE === 'auto') controller.switchTo(autoMode);

bot.once('spawn', () => {
  log.info('spawned — commands: auto | guided | stop | exit | <x> <y> <z>');
  controller.run().catch((e: Error) => log.error('loop crashed', e.message));
});

bot.on('end', () => {
  log.info('disconnected');
  controller.halt();
  input.close();
  this.proxy?.stop();
});
```

---

## Why This Is Better

| Before | After |
|--------|-------|
| `if (state.mode === 'guided')` in loop | `currentMode.tick()` — pure polymorphism |
| Mode set only at startup from env | `InputHandler` switches at runtime |
| `shouldStop`/`forceStop` flags in global state | `controller.stop()` / `controller.halt()` |
| `guidedTarget` in global state | Owned by `GuidedMode` instance |
| Adding a mode = editing `runLoop` | Adding a mode = new class implementing `BotMode` |

---

## Constraint Compliance

| Constraint | How |
|---|---|
| No `any` | All types explicit; `Record<string, () => void>` not `any` |
| No `else if` / `else` | Loop: `while (active)`. Dispatch: `Record` lookup + early `return` |
| Minimum indentation | Dispatch table + early returns flatten `handleLine` to one level |
| OOP | Every concept is a class |
| Non-private methods use `public` | All public methods declared |
| Explicit return types | Every method annotated |