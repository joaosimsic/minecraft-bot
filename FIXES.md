# Navigation fix list

Targets the gaps found auditing `src/navigation/` and `src/skills/Navigator.ts` against `navigator.md`. Each item has: file, line range, exact change, and acceptance test. Apply in order — later items can depend on earlier ones (e.g. test additions in §10 reference fixes from §1–9).

Code constraints from `CLAUDE.md` apply to every change: no `try`/`catch` outside the outermost boundary, no `any`, no `else`/`else if`, explicit return types, Go-style `[Error|null, T|null]` returns, no comments, run `prettier` after edits.

---

## 1. `stepInteract` align/activate phases lack tick caps

**File:** `src/navigation/movement/Executor.ts:365-441`
**Severity:** high (bot can hang indefinitely waiting on `lookAt` / `activateBlock`).

**Problem:** Only the `wait` phase honors `MAX_INTERACT_TICKS` (line 431). `align` and `activate` always `return` early after their await without checking `actionTicks`.

**Fix:**

1. At the very top of `stepInteract` (right after `const tick = this.gameTick();` on line 368), add a single tick-cap guard that fires for any phase:

```ts
if (this.actionTicks >= MAX_INTERACT_TICKS) {
  this.finish(
    ok({
      done: false,
      action: cur,
      reason: `interact_timeout_${this.interactPhase}`,
      phase: 'macro',
    }),
  );
  return;
}
```

2. Remove the duplicate cap check at lines 431–440; it's now covered by the top-of-method guard. Keep the post-validator branch (lines 416–429) intact.

**Acceptance:** new test in `navigation.test.ts` — fixture where `lookAt` resolves but `activateBlock` never produces a state change; assert drain returns `{ done: false, phase: 'macro', reason: /interact_timeout/ }` within `MAX_INTERACT_TICKS + 1` physics ticks.

---

## 2. `EdgeMemory` `learnedAdd` grows unbounded

**File:** `src/navigation/recovery/EdgeMemory.ts`
**Severity:** high (heuristic admissibility breaks; one stuck spot dominates planning).

**Problem:** `recordFailure` (lines 67–72) keeps adding `PENALTY_BUMP` with no cap. After N failures, `learnedAdd = N * 5`, and `costWithMemory` returns `baseCost + learnedAdd` — A\* will route around stuck areas the size of half the world.

**Fix:**

1. Add a constant near the top (line 9–11):

```ts
const MAX_LEARNED_ADD = 40;
```

2. In `recordFailure` first-failure branch (lines 55–64) — no change needed, initial bump is already `PENALTY_BUMP`.
3. In the existing-row branch (lines 67–71), clamp after the bump:

```ts
this.applyDecayForRow(prev, tick);
prev.failureCount += 1;
prev.learnedAdd = Math.min(prev.learnedAdd + PENALTY_BUMP, MAX_LEARNED_ADD);
prev.lastFailureTick = tick;
```

**Acceptance:** unit test — call `recordFailure` 50× on the same edge with the same tick; assert `costWithMemory` returns `baseCost + MAX_LEARNED_ADD` (within floating-point tolerance), not `baseCost + 250`.

---

## 3. `EdgeMemory` `try`/`catch` violates CLAUDE.md

**File:** `src/navigation/recovery/EdgeMemory.ts:121-200`
**Severity:** medium (style + silent-failure: `loadQuiet` swallows JSON parse errors with no observability).

**Problem:** `loadQuiet` (lines 121–157) and `persistToDiskInternal` (lines 159–200) use `try`/`catch` for control flow. Per `CLAUDE.md` rule §1, only the **outermost boundary** may catch, and it must convert immediately to a tuple. `loadQuiet` swallows entirely (line 154 `_e: unknown`).

**Fix:**

1. Add a private static helper that wraps `JSON.parse` once (this is the only library call that can throw synchronously here besides the fs calls, which already accept `Result`-style usage via `existsSync`/`readFileSync`):

```ts
private static parseJson(raw: string): Result<unknown> {
  try {
    return ok(JSON.parse(raw) as unknown);
  } catch (err: unknown) {
    if (err instanceof Error) return fail(err);
    return fail(new Error('edge_memory_parse'));
  }
}

private static readFileSafe(path: string): Result<string> {
  try {
    return ok(readFileSync(path, 'utf8'));
  } catch (err: unknown) {
    if (err instanceof Error) return fail(err);
    return fail(new Error('edge_memory_read'));
  }
}

private static writeFileSafe(path: string, body: string): Result<null> {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, 'utf8');
    return ok(null);
  } catch (err: unknown) {
    if (err instanceof Error) return fail(err);
    return fail(new Error('edge_memory_write'));
  }
}
```

2. Rewrite `loadQuiet` so it calls these helpers and returns early on each failure with no nested `try`. Replace lines 121–157 with:

```ts
private loadQuiet(): void {
  if (this.persistPath === undefined) return;
  if (!existsSync(this.persistPath)) return;

  const [readErr, raw] = EdgeMemory.readFileSafe(this.persistPath);
  if (readErr) return;
  if (raw === null) return;

  const [parseErr, parsed] = EdgeMemory.parseJson(raw);
  if (parseErr) return;
  if (parsed === null) return;

  const payload = parsed as PersistPayload | null;
  if (payload?.v !== 1) return;
  if (!Array.isArray(payload.rows)) return;

  this.rows.clear();
  for (const entry of payload.rows) {
    if (typeof entry.id !== 'string') continue;
    const row: EdgeRow = {
      failureCount: entry.failureCount,
      learnedAdd: entry.learnedAdd,
      lastFailureTick: entry.lastFailureTick,
      lastDecayTick: entry.lastDecayTick,
    };
    if (!Number.isFinite(row.failureCount)) continue;
    if (!Number.isFinite(row.learnedAdd)) continue;
    if (!Number.isFinite(row.lastFailureTick)) continue;
    if (!Number.isFinite(row.lastDecayTick)) continue;
    this.rows.set(entry.id, row);
  }
}
```

3. Rewrite `persistToDiskInternal` — remove the outer `try`/`catch`, route the file write through `writeFileSafe`. Replace lines 159–200 with:

```ts
private persistToDiskInternal(): Result<null> {
  if (this.persistPath === undefined) return ok(null);

  const entries = [...this.rows.entries()];
  entries.sort((a, b): number => {
    const db = b[1].lastFailureTick - a[1].lastFailureTick;
    if (db !== 0) return db;
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    return 0;
  });

  const cappedPairs =
    entries.length > this.maxEntries
      ? entries.slice(0, this.maxEntries)
      : entries;

  const payload: PersistPayload = {
    v: 1,
    rows: cappedPairs.map(([id, row]): EdgeRow & { id: string } => ({
      id,
      ...row,
    })),
  };

  const [writeErr] = EdgeMemory.writeFileSafe(
    this.persistPath,
    JSON.stringify(payload),
  );
  if (writeErr) return [writeErr, null];

  if (entries.length <= this.maxEntries) return ok(null);

  this.rows.clear();
  for (const [id, row] of cappedPairs) this.rows.set(id, row);
  return ok(null);
}
```

**Acceptance:**
- existing disk round-trip test still passes;
- new test: corrupt JSON in the persist file → `new EdgeMemory({ persistPath })` does not throw and yields an empty memory (no rows).

---

## 4. `probeStuck` `physicsTick` listener leak

**File:** `src/navigation/NavigationController.ts:63-66, 179-194`
**Severity:** medium (leaked closure for the kernel's lifetime; runs every tick forever).

**Problem:** Subscription installed in constructor, never removed. The handler short-circuits on `!this.draining`, so it's correctness-safe, but it allocates and runs `bot.entity.position` reads every tick.

**Fix:** Attach only while a drain is active.

1. Store the bound handler as a class field (so it can be removed):

```ts
private readonly onPhysicsProbe = (): void => this.probeStuck();
```

2. Remove lines 63–65 from the constructor.
3. In `walkTo`, immediately before `await this.executor.drainQueue(plan.path)` (currently line 121), add:

```ts
this.bot.on('physicsTick', this.onPhysicsProbe);
```

4. Immediately after the drain returns (currently after line 121, before reading `dErr`), detach:

```ts
this.bot.removeListener('physicsTick', this.onPhysicsProbe);
```

5. Move both attach/detach so that even on early return the listener is removed. Cleanest pattern: wrap the drain in a small block:

```ts
this.bot.on('physicsTick', this.onPhysicsProbe);
const drainResult = await this.executor.drainQueue(plan.path);
this.bot.removeListener('physicsTick', this.onPhysicsProbe);
```

(both `walkTo` returns are after these lines, so this is safe; double-check no `return` can sneak between them.)

**Acceptance:** unit test — instantiate `NavigationController`, call no `walkTo`, advance 1000 simulated ticks; assert `bot.listenerCount('physicsTick')` is 0 (or matches the count at construction time).

---

## 5. `stepWalk` lacks mid-action pre-validation

**File:** `src/navigation/movement/Executor.ts:178-239`
**Severity:** medium (mob walks into the cell mid-traverse → 56-tick wait before failing out).

**Problem:** `walkPrimed` is set once; subsequent ticks only run `postAction`. There's no re-check of `queuedEdgeLegal` while walking, so transient obstructions waste the full `MAX_WALK_TICKS` budget.

**Fix:** Re-run `validator.preAction` every N ticks during a walk; on failure, finish with `phase: 'pre_action'` so recovery can replan instead of penalizing the edge.

1. Add a constant near other tick caps (line 22):

```ts
const WALK_MIDCHECK_EVERY_TICKS = 8;
```

2. In `stepWalk`, **after** the `walkPrimed` guard (after line 206), **before** the `postAction` check (line 208), insert:

```ts
if (this.actionTicks % WALK_MIDCHECK_EVERY_TICKS === 0) {
  const pre = this.validator.preAction(this.world, this.bot, cur, this.gameTick());
  if (pre[0] !== null) {
    this.bot.setControlState('forward', false);
    this.finish(
      ok({
        done: false,
        action: cur,
        reason: pre[0].message,
        phase: 'pre_action',
      }),
    );
    return;
  }
}
```

**Acceptance:** new test — fixture with a 4-cell straight corridor; spawn a hostile in the next cell after the bot is primed but before the post-action passes; assert drain returns within `WALK_MIDCHECK_EVERY_TICKS + 1` ticks with `phase: 'pre_action'`.

---

## 6. `Recovery.state` is dead code

**File:** `src/navigation/recovery/Recovery.ts:11-105`
**Severity:** low (no behavior bug, but the spec §10 claims this is a state machine — it isn't).

**Decision required:** either drive transitions through the field (gating execution) or delete it. Recommend deletion — the controller already orchestrates the transitions implicitly, and adding gating would expand scope.

**Fix (deletion path):**

1. Remove the `RecoveryState` type (line 11) and the `state` field (line 14).
2. Remove every assignment to `this.state` (lines 25, 40, 53, 70, 99).
3. Remove `markExecuting` (lines 98–100) and `getState` (lines 102–104).
4. Grep the codebase for any references — none expected — and clean them up.

**Acceptance:** `bun test` and `tsc` both pass; `grep -r "RecoveryState\|markExecuting\|getState" src/` returns zero matches under `src/navigation/`.

---

## 7. `onPreActionRejected` consumes the same replan budget as verified failures

**File:** `src/navigation/NavigationController.ts:149-159`, `src/navigation/recovery/Recovery.ts:13-42`
**Severity:** medium (transient mob obstruction can burn the full 14-replan budget; the goal aborts when the world clears 1 second later).

**Problem:** Both verified failures (line 161–173) and pre-action rejections (line 149–158) call `consumeReplan`. Spec §3.1: pre-action rejections "typically replan when the obstruction looks transient rather than blindly penalizing." A separate, smaller budget keeps transient ones from exhausting the verified-failure budget.

**Fix:**

1. In `Recovery`, add a second budget. Replace lines 13–42 with:

```ts
export class Recovery {
  private replansUsed = 0;
  private transientReplansUsed = 0;

  public constructor(
    private readonly replanBudget: number,
    private readonly transientReplanBudget: number,
    private readonly memory: EdgeMemory,
    private readonly recorder: NavigationRecorder,
  ) {}

  public resetForNewGoal(): void {
    this.replansUsed = 0;
    this.transientReplansUsed = 0;
  }

  public canReplan(): boolean {
    return this.replansUsed < this.replanBudget;
  }

  public canTransientReplan(): boolean {
    return this.transientReplansUsed < this.transientReplanBudget;
  }

  public consumeReplan(
    reason: string,
    fromPos: Record<string, number>,
  ): Result<null> {
    if (!this.canReplan()) return fail(new Error('replan_budget'));
    this.replansUsed += 1;
    this.recorder.emit(NAV_EVENT.REPLAN, { reason, fromPos });
    return okVoid();
  }

  public consumeTransientReplan(
    reason: string,
    fromPos: Record<string, number>,
  ): Result<null> {
    if (!this.canTransientReplan())
      return fail(new Error('transient_replan_budget'));
    this.transientReplansUsed += 1;
    this.recorder.emit(NAV_EVENT.REPLAN, { reason, fromPos });
    return okVoid();
  }
  // ... keep recordVerifiedFailure, onPreActionRejected, notifyStuck unchanged
}
```

2. In `NavigationController`:
   - Add a second budget constant near line 15:
     ```ts
     const TRANSIENT_REPLAN_BUDGET = 6;
     ```
   - Update `Recovery` instantiation (line 55):
     ```ts
     this.recovery = new Recovery(REPLAN_BUDGET, TRANSIENT_REPLAN_BUDGET, this.edgeMemory, this.recorder);
     ```
   - In the pre-action branch (line 156), call `consumeTransientReplan` instead of `consumeReplan`.

**Acceptance:** unit test — drive 7 pre-action rejections through `walkTo`; assert the 7th aborts with `replan_budget` (the `transient_replan_budget` exhausted), but a single verified failure still has its full 14-budget available.

---

## 8. Telemetry payloads missing `observed` detail

**Files:** `src/navigation/recovery/Recovery.ts:44-86`, `src/navigation/movement/Validator.ts`
**Severity:** low (debuggability — current payloads tell you a failure happened but not what differed).

**Problem:**
- `pre_action_rejected` is emitted with `observed: { fromPos }` — that's the controller's pos, not the validator's mismatch detail.
- `movement_fail` payload in `recordVerifiedFailure` (lines 63–68) omits `observed` entirely.

**Fix:**

1. `Validator.preAction` and `Validator.postAction` currently return `Result<...>` with `Error` containing only a string code. Promote to a typed mismatch:

```ts
export type ValidationFail = {
  code: string;
  observed: Record<string, unknown>;
};
```

   Change return types to `Result<PreValidation, ValidationFail>` (using a custom error in the tuple's first slot). Or keep `Error` but subclass / attach `.observed` via a typed wrapper. Cleanest: switch the Result's error generic to allow `Error & { observed?: Record<string, unknown> }`.

   **Lower-touch alternative:** keep `Error`, but build a `ValidationError extends Error` with an `observed` field, throw it never, just return it.

```ts
class ValidationError extends Error {
  public readonly observed: Record<string, unknown>;
  public constructor(code: string, observed: Record<string, unknown>) {
    super(code);
    this.observed = observed;
  }
}
```

   Use it everywhere `fail(new Error('post_foot_mismatch'))` etc. lives. E.g.:

```ts
return fail(new ValidationError('post_foot_mismatch', {
  expected: { x: toNode.x, y: toNode.y, z: toNode.z },
  got: fb,
}));
```

2. Plumb through `Recovery.recordVerifiedFailure` — in the `MOVEMENT_FAIL` emit (line 63), include `observed: action instanceof ValidationError ? action.observed : undefined`. Actually the failure object is the `Error` returned in the drain outcome — pass it from `Executor` to `NavigationController` to `Recovery`.

   Concretely: change `DrainOutcome` (`Executor.ts:13-20`) to carry `observed?: Record<string, unknown>`, populate it from `pre[0]`/`post[0]` if they are `ValidationError`. Then in `NavigationController.walkTo` pass `drain.observed` to `recordVerifiedFailure`/`onPreActionRejected`.

3. Update `Recovery.onPreActionRejected` to accept observed from the drain rather than the controller's pos snapshot.

**Acceptance:** test — trigger a `post_foot_mismatch` failure; assert the emitted `movement_fail` event has `observed.expected` and `observed.got` populated.

---

## 9. AStar reconstruct error names — already distinct, but keep an eye

**File:** `src/navigation/planner/AStar.ts:281, 284`
**Severity:** none (false positive in audit).

**Status:** confirmed `astar_reconstruct_guard` (line 281, cycle) and `astar_reconstruct_break` (line 284, missing parent) are already distinct. **No change required.** Listed for reviewer awareness.

---

## 10. `Validator.velocityComponents` uses `unknown` for typed `Vec3`

**File:** `src/navigation/movement/Validator.ts:21-38`
**Severity:** low (style; not functionally wrong).

**Fix:** `bot.entity.velocity` is a `Vec3` from mineflayer's types. Replace lines 21–38 with:

```ts
private static velocityBounded(bot: Bot): Result<null> {
  const v = bot.entity.velocity;
  if (v === null || v === undefined) return ok(null);

  const h = Math.hypot(v.x, v.z);
  if (h > BETA_173.POST_ACTION_MAX_HORIZONTAL_SPEED_BLOCKS_PER_TICK) {
    return fail(new Error('post_velocity_horizontal'));
  }

  if (Math.abs(v.y) > BETA_173.POST_ACTION_MAX_VERTICAL_ABS_BLOCKS_PER_TICK) {
    return fail(new Error('post_velocity_vertical'));
  }

  return ok(null);
}
```

Delete `velocityComponents` entirely. **Acceptance:** existing velocity tests still pass; `tsc` passes.

---

## 11. `Executor.stepOnce` cascade should be a `switch`

**File:** `src/navigation/movement/Executor.ts:172-175`
**Severity:** low (style + safety net for new action kinds).

**Fix:** Replace the four `if`s with an exhaustive `switch` with `never` default — adding a new `ActionKind` will be a compile error until handled:

```ts
const k = cur.kind;
switch (k) {
  case 'walk':
    await this.stepWalk(cur);
    return;
  case 'jump_up':
    await this.stepJump(cur);
    return;
  case 'drop_down':
    await this.stepDrop(cur);
    return;
  case 'interact':
    await this.stepInteract(cur);
    return;
  default: {
    const _exhaustive: never = k;
    void _exhaustive;
    return;
  }
}
```

Note `cur` is narrowed inside each case so the cast inside `stepWalk(cur as ...)` style is unnecessary — the existing signatures `stepWalk(cur: NavigationAction & { kind: 'walk' })` already work with TS narrowing.

**Acceptance:** `tsc` passes; tests pass.

---

## 12. `canStandAt` head-hostile semantic

**File:** `src/navigation/world/Collision.ts:18-20`, `src/navigation/world/BotWorld.ts:128-149`
**Severity:** low (predicate name is misleading; over-rejects).

**Problem:** `Collision.canStandAt` calls `world.hostileOccupiesFootCell(node.x, node.y + 1, node.z)` to check the head cell. The predicate is named "foot cell" and `entityBlocksFootCell` widens by `±1` on Y axis. So an entity 1 block away vertically can over-reject.

**Fix:**

1. In `World.ts`, add a generic predicate:

```ts
hostileOccupiesCell(ix: number, iy: number, iz: number): boolean;
```

2. In `BotWorld.ts`, implement it with **strict** Y match (`by === iy`), and reuse the existing X/Z extents. Keep `hostileOccupiesFootCell` as a 2-cell convenience that calls the strict version twice (`iy` and `iy+1`) if other code still wants foot+head together.

3. In `Collision.canStandAt`, replace lines 19–20 with calls to `hostileOccupiesCell(node.x, node.y, node.z)` and `hostileOccupiesCell(node.x, node.y + 1, node.z)`.

4. Update `FixtureWorld.ts` to implement the new method.

**Acceptance:** new fixture test — hostile at (5, 64, 5) should not block standing at (5, 66, 5); but should block standing at (5, 64, 5) and (5, 65, 5).

---

## 13. Test gaps

**File:** `src/navigation/navigation.test.ts`
**Severity:** medium (spec §12 claims coverage that doesn't exist).

Add tests for:

1. **`snapshot_stale` abort:** drive A\*; mid-search, bump `world.snapshotGeneration` (FixtureWorld needs a setter or `notifyBlockUpdate()`); assert search returns `Error('world_snapshot_stale')` and emits `searchEnd` with `status: 'aborted', reason: 'snapshot_stale'`.
2. **AStar tie-break determinism:** corridor where two equal-cost paths exist; run search twice; assert action sequence is byte-identical.
3. **Replan-budget exhaustion:** stub `Recovery.replanBudget = 1`; force a verified failure; assert second iteration of `walkTo` returns `ok(false)` with `replan_budget` reason.
4. **Transient-replan-budget exhaustion** (after fix §7).
5. **EdgeMemory `maxEntries` trim:** insert `maxEntries + 5` rows; call `persistSyncQuiet`; reload; assert exactly `maxEntries` rows present, with the most-recent `lastFailureTick` retained.
6. **Executor macro tick caps** (after fix §1): 3 separate tests for `align`, `activate`, `wait` timeouts.
7. **stepWalk mid-action pre-validation** (after fix §5).
8. **Closed upper-half door:** `BotWorld.isClosedDoorBlock` returns false for `half: 'upper'`; assert `closedDoorAt` reflects this and that `findClosedDoorBlockingWalk` falls through to `y - 1`.
9. **`Collision.dropLanding`:** safe drop at `SAFE_FALL_HEIGHT_BLOCKS - 1`; unsafe drop at `SAFE_FALL_HEIGHT_BLOCKS + 1`.
10. **`Collision.canJumpUpAdjacent`:** clear step-up; head-blocked step-up.

**Acceptance:** all tests in `bun test` pass; coverage of `Executor.ts` rises from 0% to >70%.

---

## Order of execution (suggested)

1. §3 — converting `try`/`catch` is mechanical and unblocks confidence in disk persistence.
2. §6 — delete dead code; smallest diff, gets out of the way.
3. §10 — `Validator.velocityBounded` cleanup; tiny.
4. §11 — exhaustive switch in `Executor`; tiny.
5. §1 — interact tick caps. **Has runtime impact, fix early.**
6. §2 — clamp `learnedAdd`.
7. §4 — `probeStuck` listener lifecycle.
8. §5 — mid-walk pre-validation.
9. §7 — split replan budgets.
10. §12 — `hostileOccupiesCell` strict Y predicate.
11. §8 — telemetry `observed` plumbing (largest cross-file change; do last).
12. §13 — tests last so they cover the new behavior.

Run `bun test` and `tsc --noEmit` after each step. Run `prettier` after each file edit.

---

## What is intentionally **not** in this list

- `durationTicks: 0` caveat (§14.5) — already documented; A\* finishing in one synchronous turn is by design.
- Interact post-action not running full collision replay (§14.5) — documented caveat.
- Switching `EdgeMemory` to SQLite or NDJSON (§5.4 explicitly defers).
- Adding dig/build planning (§1.1 non-goal).