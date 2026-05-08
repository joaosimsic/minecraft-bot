# Plan — Fix Remaining TUI Freeze After Phase 1/2/3

## Context

The previous plan implemented three phases:

1. **Phase 1** — Expansion cap (`NAV_MAX_EXPANSIONS=20000`)
2. **Phase 2** — Binary heap (`OpenHeap`) replacing the linear `pickOpenNode` scan
3. **Phase 3** — Async yield via `setImmediate` every `NAV_YIELD_EVERY=2000` expansions,
   with a `snapshot_stale` abort when `world.snapshotGeneration` changes

All three phases are live. The TUI **still freezes**. This plan addresses the
two remaining root causes discovered in the latest log
`logs/bot-2026-05-08T12-40-34.log`.

---

## Symptoms (from the latest log)

Three A\* searches ran. All three:

- Expanded exactly **4 000 nodes** (2 × `NAV_YIELD_EVERY`)
- Took **5–9 seconds** of wall-clock time
- Aborted with `reason: "snapshot_stale"` (never hit the 20 000 expansion budget)
- No TUI events (position ticks, state ticks) appeared between `search_start`
  and `search_end` — confirming the **event loop was blocked** for the full
  duration of each synchronous batch

Timeline for search #1:

```
12:40:46.277  search_start
              ── 2000 expansions, ~4s, event loop blocked ──
              yield #1 (setImmediate) — no blockUpdate yet, snapshot OK
              ── 2000 more expansions, ~4s, event loop blocked ──
              yield #2 (setImmediate) — blockUpdate arrived, snapshot stale
12:40:55.069  search_end  status=aborted  reason=snapshot_stale  expanded=4000
```

Result: **~8 s freeze**, then the search aborts, `walkTo` returns `false`,
GuidedMode retries in 5 s, and the cycle repeats forever.

---

## Root Causes

### RC-A — Each synchronous batch (2 000 expansions) blocks the event loop for ~4 s

`NAV_YIELD_EVERY=2000` is far too high given the actual per-expansion cost.
Profiling via the subagent shows **~2 ms per expansion**, dominated by:

| Hot-path operation | Calls per expansion | Why it is expensive |
|-|-|-|
| `hostileOccupiesCell` | 24–72 | Each call runs `Object.values(bot.entities)` (allocates a fresh array) then **O(E)** iteration over **every entity** on the server. Zero caching. |
| `Node.key` getter | 30–40 | Computed (not cached): template-literal string, `[...set].sort().join(';')` when doors are present. Called from `offer`, `relaxEdge`, action constructors, telemetry. |
| `destinationNode` | 8–20 | Allocates `new Vec3` + `new Node` + regex test per call. |
| `Node.fromKey` | 1 | String parsing: `endsWith`, `slice`, `indexOf`, `split`, 3× `Number`, `new Set`, `new Node`. |
| `expand` tail sort | 1 | `[...byDest.keys()].sort(compareNodeKey)` — spreads Map keys, sorts, builds second array. |

At 2 ms/expansion, 2 000 expansions = **~4 s** of continuous blocking before
`setImmediate` gets a chance to fire. The TUI cannot render or process input.

### RC-B — `snapshot_stale` abort makes the search permanently unfulfillable

`BotWorld` bumps `snapshotGeneration` on **every** `blockUpdate` event —
including completely irrelevant ones (grass growing, leaves decaying, water
flowing, redstone changes). In a normal Minecraft world, at least one
`blockUpdate` arrives every few seconds. The search:

1. Yields at expansion 2 000 (first yield) — no `blockUpdate` has arrived yet,
   snapshot is still valid.
2. Continues to expansion 4 000 (second yield) — by now a `blockUpdate` has
   arrived during some earlier event-loop iteration, `snapshotGeneration` has
   bumped, and the post-yield check aborts the search.

The search can therefore **never expand more than `2 × NAV_YIELD_EVERY` nodes**,
regardless of the 20 000 budget. The bot retries every 5 s, each attempt aborts
identically, and the bot is permanently stuck.

The existing executor (`NavigationExecutor`) already validates each planned
action via `NeighborGenerator.queuedEdgeLegal` before executing it, and
`Recovery` handles any failures. This means an A\* path computed over
slightly-stale world data is **safe**: if a block changed mid-search and
invalidated a planned step, the executor catches it and triggers a replan.
The `snapshot_stale` abort is therefore both unnecessary and actively harmful.

---

## Fixes

Three changes, listed from most impactful to least. Each is independently
shippable, but all three should land together.

---

### Fix 1 — Remove the `snapshot_stale` abort from `AStar.search`

This is the **most critical** fix. Without it, the search can never complete.

#### Files to change

**`src/navigation/planner/AStar.ts`** (lines referenced are from the current
file, read them before editing since line numbers may shift):

1. **Delete `snap0` capture** (current line 66):

   ```ts
   const snap0 = world.snapshotGeneration;           // DELETE this line
   ```

2. **Delete the top-of-loop snapshot check** (current lines 121–135):

   ```ts
   // DELETE this entire block (lines 121-135):
   if (
     snap0 !== undefined &&
     world.snapshotGeneration !== undefined &&
     world.snapshotGeneration !== snap0
   ) {
     telemetry.searchEnd({
       status: 'aborted',
       reason: 'snapshot_stale',
       expanded,
       staleSkipped,
       cost: null,
       durationTicks: durationTicks(),
     });
     return fail(new Error('world_snapshot_stale'));
   }
   ```

3. **Delete the post-yield snapshot check** (current lines 237–251):

   ```ts
   // DELETE this entire block (lines 237-251):
   if (
     snap0 !== undefined &&
     world.snapshotGeneration !== undefined &&
     world.snapshotGeneration !== snap0
   ) {
     telemetry.searchEnd({
       status: 'aborted',
       reason: 'snapshot_stale',
       expanded,
       staleSkipped,
       cost: null,
       durationTicks: durationTicks(),
     });
     return fail(new Error('world_snapshot_stale'));
   }
   ```

   After deletion, the yield block (lines 235–252) should become just:

   ```ts
   if (yieldEvery > 0 && expanded % yieldEvery === 0) {
     await yieldToEventLoop();
   }
   ```

**`src/navigation/world/World.ts`** (line 16):

Remove `snapshotGeneration` from the `World` interface:

```ts
readonly snapshotGeneration?: number;   // DELETE this line
```

The interface should become:

```ts
export interface World {
  cell(x: number, y: number, z: number): WorldCell;
  closedDoorAt(x: number, y: number, z: number): boolean;
  footMovementClass(x: number, y: number, z: number): MovementClass;
  hostileOccupiesCell(ix: number, iy: number, iz: number): boolean;
  hostileOccupiesFootCell(x: number, y: number, z: number): boolean;
}
```

**`src/navigation/world/BotWorld.ts`**:

- Remove the `generation` field (line 21): `private generation = 0;`
- Remove the `generation += 1;` line inside the `bump` closure (line 27)
- Remove the `snapshotGeneration` getter (lines 40–42)
- Keep the cache-clearing in `bump()` — that is still needed so subsequent
  `cell()` lookups after a yield return fresh data

After the change, the `bump` closure should be just:

```ts
const bump = (): void => {
  this.cache.clear();
  this.closedDoorCache.clear();
};
```

**`src/navigation/test/FixtureWorld.ts`**:

- Remove `public snapshotGeneration = 1;` (line 5)
- Remove `public bumpSnapshot(): void { ... }` (lines 82–84)

**`tests/navigation/astar.test.ts`**:

- Delete the entire `describe('AStar staleness', ...)` block that tests
  `snapshot_stale` (lines 90–125). Specifically the test
  `'abort when snapshot bumps mid-search'`.
- Keep the `'repeated search same optimal cost'` test (lines 127–152),
  but move it outside the deleted describe block (it has nothing to do with
  staleness). Place it inside the main `describe('AStar', ...)` block.

After the change, `astar.test.ts` should have these tests:

1. `'finds straight corridor'` (existing)
2. `'expansion budget returns no_path_budget with exact expanded count'` (existing)
3. `'yieldEvery invokes yieldImpl on unreachable search with budget'` (existing)
4. `'repeated search same optimal cost'` (moved from staleness describe)

---

### Fix 2 — Lower `NAV_YIELD_EVERY` from 2 000 to 256

At ~2 ms/expansion, 256 expansions ≈ 500 ms per synchronous batch. Combined
with Fix 1 (no more aborts), the search will actually complete, and freezes
drop from ~4 s to ~500 ms.

Further reduction (e.g. 64) would give ~128 ms batches but adds more
context-switch overhead. 256 is a good starting point; the perf fix in Fix 3
will make this even better.

#### Files to change

**`src/config/schemas/bot.ts`** (line 38):

```ts
// BEFORE:
NAV_YIELD_EVERY: z.coerce.number().int().min(0).default(2000),

// AFTER:
NAV_YIELD_EVERY: z.coerce.number().int().min(0).default(256),
```

**`.env.example`** (line 31):

```
# BEFORE:
NAV_YIELD_EVERY=2000

# AFTER:
NAV_YIELD_EVERY=256
```

---

### Fix 3 — Cache `hostileOccupiesCell` results in `BotWorld`

This is the dominant per-expansion cost. Each call iterates all entities via
`Object.values(bot.entities)` — allocating a fresh array — then scans every one.
With 24–72 calls per expansion, this is the main reason each expansion takes
~2 ms. Caching the result per `(x,y,z)` cell within a synchronous batch
(cleared on `blockUpdate` just like the block cache) collapses the entity
iteration to at most once per unique cell coordinate.

#### Files to change

**`src/navigation/world/BotWorld.ts`**:

Add a hostile-entity cache alongside the existing block/door caches:

```ts
private readonly hostileCache = new Map<string, boolean>();
```

Clear it in the `bump` closure alongside the other caches:

```ts
const bump = (): void => {
  this.cache.clear();
  this.closedDoorCache.clear();
  this.hostileCache.clear();
};
```

Rewrite `hostileOccupiesCell` to check the cache first:

```ts
public hostileOccupiesCell(ix: number, iy: number, iz: number): boolean {
  const key = BotWorld.posKey(ix, iy, iz);
  const hit = this.hostileCache.get(key);
  if (hit !== undefined) return hit;

  let found = false;
  for (const entity of Object.values(this.bot.entities) as Entity[]) {
    if (entity === undefined) continue;
    if (entity.id === this.bot.entity.id) continue;
    if (!BotWorld.isHostileEntity(entity)) continue;
    if (!BotWorld.entityBlocksCell(entity, ix, iy, iz)) continue;
    found = true;
    break;
  }

  this.hostileCache.set(key, found);
  return found;
}
```

Note: this follows the project's "no early return inside loop" style while
still breaking out early when found. The early `break` avoids iterating the
rest of the entities once a hostile is found. The assignment + break pattern
avoids a bare `return true` inside the for loop which would skip the cache
write.

#### Expected effect

The cache hit rate will be very high because `canStandAt` checks cells
`(x, y, z)` and `(x, y+1, z)`, and adjacent expansions share many cell
coordinates. The 24–72 entity scans per expansion drop to ~1–3 cache misses
(unique cell lookups) per expansion, each doing a single entity iteration.

This should bring per-expansion cost from ~2 ms down to ~0.2–0.5 ms, making
the 256-expansion yield interval produce ~50–130 ms batches (smooth TUI).

---

## Caller/Test Audit

No callers of `AStar.search` need to change signatures — the `searchOpts`
parameter shape is unchanged. The only test change is removing the
`snapshot_stale` test and moving the `'repeated search same optimal cost'` test.

Full list of `AStar.search` call sites (verify each still works after changes):

| File | Line(s) | Change needed |
|-|-|-|
| `src/navigation/NavigationController.ts` | 116 | None — `world_snapshot_stale` was handled the same as `no_path`, so removing it is transparent |
| `tests/navigation/astar.test.ts` | 16, 42, 66, 112, 132, 140 | Delete lines 90–125 (snapshot test), move lines 127–152 up |
| `tests/navigation/hostile.test.ts` | 19 | None |
| `tests/navigation/navigation.test.ts` | 75 | None |
| `tests/navigation/neighbor-generator.test.ts` | 35, 56 | None |
| `tests/navigation/pathfinding-jumps.test.ts` | 16 | None |
| `tests/navigation/validator.test.ts` | 17, 75 | None |

---

## Verification

After all three fixes, run:

```bash
bun --env-file=.env.example test
bunx prettier --write src/navigation/planner/AStar.ts src/navigation/world/World.ts src/navigation/world/BotWorld.ts src/navigation/test/FixtureWorld.ts src/config/schemas/bot.ts tests/navigation/astar.test.ts .env.example
bun --env-file=.env.example test
```

Then, when testing manually against the Minecraft server:

1. Bot log should show `plan_failed expansion_budget` or `plan_failed no_path`
   (never `plan_failed world_snapshot_stale`)
2. TUI should remain responsive during searches (characters typed appear
   promptly, Ctrl-C exits within 100 ms)
3. `search_end` events should show `expanded` up to 20 000, not capped at
   `2 × NAV_YIELD_EVERY`

---

## Project Constraints Checklist (from `CLAUDE.md`)

Every code change in this plan must satisfy:

- No `try`/`catch`
- No `any` type
- No `else if` / `else` — use early returns / guard clauses
- Minimum indentation
- `public` keyword explicit on non-private methods
- Explicit return types on all functions/methods
- Go-style error tuples (`[Error | null, T | null]`)
- No comments
- Vertical spacing between unrelated logic blocks
- Run `bunx prettier --write` on every touched file
- Run `bun --env-file=.env.example test` after changes
