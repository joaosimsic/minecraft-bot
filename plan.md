# Plan — Fix TUI Freeze During Pathfinding

## Goal

TUI must stay responsive (≤16 ms per render tick) regardless of plan size or
plan failures. Pathfinding may take longer, but never block the Node event
loop long enough to drop input or render frames.

## Non-Goals

- Improving navigation success rate or path quality.
- Refactoring `NavigationController.walkTo` retry / recovery shape.
- Touching `EdgeMemory` cost model semantics.
- Replacing `blessed` or LogPane internals (already throttled correctly).

## Project Constraints (apply to every code change in this plan)

From `CLAUDE.md` — these are hard rules, not stylistic preferences:

1. **No `try`/`catch`** anywhere except the absolute outermost boundary —
   convert library throws to tuple returns immediately.
2. **No `any` type.** Use `unknown` + narrowing if needed.
3. **No `else if` / `else`** — use early returns / guard clauses.
4. **Min indentation** — flatten with early returns.
5. **Public methods explicitly marked `public`.**
6. **Explicit return types** on every function and method.
7. **Go-style errors:** functions that can fail return
   `Result<T>` / `Promise<[Error|null, T|null]>`, never throw. Check
   immediately: `if (err) return [err, null];`.
8. **No comments.** Names carry meaning.
9. **Vertical spacing** between unrelated logic blocks.
10. **Run prettier** after edits (`bunx prettier --write <files>`).

Test runner is `bun test`; `package.json` script:

```json
"test": "bun --env-file=.env.example test"
```

Tests pull defaults from `.env.example`, so any new env var **must have a
sensible default in `.env.example`** or the test suite reads `undefined`.

---

## Symptoms

From `logs/bot-2026-05-08T01-30-33.log` and
`logs/events-2026-05-08T01-30-33.jsonl` (run with `NAV_TRACE=0`):

```
walk request → plan_failed gap:  ~27 s, 2 m 04 s, 2 m 16 s
search_end fail expanded=76998
search_end fail expanded=284687
search_end fail expanded=284395
```

During each gap:

- No log lines emitted.
- TUI frozen (no input handled, no redraw).
- Bot physics / network ticks still arriving but unprocessed.

Goal: walk to `(9, 75, 99.5)` from spawn — no path exists → search exhausts
entire reachable frontier before returning `no_path`.

---

## Root Causes

Three independent issues compound. Each must be fixed.

### RC1 — `pickOpenNode` is O(open) per expansion

`src/navigation/planner/AStar.ts:200-235`

```ts
for (const k of open) {
  const f = fScore.get(k);
  const g = gScore.get(k);
  ...
}
```

Linear scan over the entire open set on every iteration. Open set grows to
tens of thousands of keys on failed searches. Total cost ≈ Σ |open_i| for
i ∈ [0, expanded). For 284 687 expansions with peak open ≈ 30 k → ~10⁹
comparisons + `Map.get` calls per search. This dominates the 2-minute
freezes.

`compareNodeKey` at the bottom of the picker also does string comparison on
keys like `"x,y,z|doorA;doorB|m:w"` — dozens of characters each.

### RC2 — No node-expansion budget

`src/navigation/planner/AStar.ts:93`

```ts
while (open.size > 0) { ... }
```

No `NAV_MAX_EXPANSIONS` cap. Unreachable goals expand the whole reachable
component. `NavigationController.walkTo` already handles `no_path` cleanly
(`src/navigation/NavigationController.ts:127`), so capping early is safe and
turns a 3-minute freeze into a sub-second one.

### RC3 — Search is fully synchronous

`AStar.search` returns `Result<PlanResult>`, not `Promise`. The hot loop
never yields. Even after RC1+RC2 fixes, a healthy 20 k-expansion search is
still ~50–200 ms of pure compute — long enough to drop a render frame and
delay input.

`NavigationController.walkTo` is already `async` and `await`s its caller, so
making `search` async is mechanical.

---

## Fix Plan

Three phases. Ship in order; each is independently shippable and each one
on its own measurably reduces freeze time.

---

### Phase 1 — Cap node expansions (cheapest, biggest immediate win)

**File:** `src/navigation/planner/AStar.ts`
**Files touched:** also `src/config/schemas/bot.ts`,
`src/navigation/NavigationController.ts`, `.env.example`.

**Change:**

1. Add config:

   ```ts
   // src/config/schemas/bot.ts
   NAV_MAX_EXPANSIONS: z.coerce.number().int().min(100).default(20000),
   ```

   `.env.example`: append `NAV_MAX_EXPANSIONS=20000`.

2. Pass budget into `AStar.search` (new optional arg `maxExpansions`, default
   `Infinity` so existing callers / tests unaffected).

3. Inside the main loop, before `expanded += 1`:

   ```ts
   if (expanded >= maxExpansions) {
     telemetry.searchEnd({
       status: 'fail',
       reason: 'expansion_budget',
       expanded,
       cost: null,
       durationTicks: durationTicks(),
     });
     return fail(new Error('no_path_budget'));
   }
   ```

4. `NavigationController` passes
   `config.env.NAV_MAX_EXPANSIONS` into `AStar.search` and treats both
   `no_path` and `no_path_budget` identically (both already routed through
   `plan_failed` → `walk_returned_false`).

**Expected effect:** 284 k-expansion failure → 20 k-expansion failure.
With current O(n²) picker, a 20 k search is roughly `(20k/284k)² ≈ 0.5%`
of the work → ~1 s freeze instead of ~135 s. Phase 1 alone removes the
multi-minute hangs.

**Risk:** A solvable goal that legitimately needs >20 k expansions will now
fail. Mitigation: budget tunable via env. Default 20 k chosen because:

- Heuristic is admissible (Manhattan + 2× vertical) so optimal-cost
  searches stay tight.
- 20 k expansions of 6–8 neighbours each ≈ 120 k–160 k edge checks — far
  more than any sane single-leg replan in this game (legs typically
  rebuild every ~50 nodes via Recovery).

**Test plan:**

- Unit: existing AStar tests pass with default cap.
- Add unit in `tests/navigation/astar.test.ts`: search with
  `maxExpansions: 5` on an unreachable goal returns `no_path_budget` and
  `expanded === 5`.
- Update `.env.example` so the bun test runner picks up the default
  (otherwise `config.env.NAV_MAX_EXPANSIONS` will be `undefined` in tests).
- Manual: re-run the failing scenario from `bot-2026-05-08T01-30-33.log`,
  confirm `plan_failed` arrives in <2 s.

**Caller audit (must update if signature changes):**

```
src/navigation/NavigationController.ts:116
tests/navigation/astar.test.ts:17, 48, 68, 76
tests/navigation/hostile.test.ts:19
tests/navigation/navigation.test.ts:75
tests/navigation/neighbor-generator.test.ts:35, 56
tests/navigation/pathfinding-jumps.test.ts:16
tests/navigation/validator.test.ts:17, 75
```

Phase 1 keeps `AStar.search` synchronous (just adds an optional arg
defaulting to `Infinity`), so call sites do **not** need to change. Only
`NavigationController` opts into the cap.

---

### Phase 2 — Replace open set + linear scan with binary heap

**File:** `src/navigation/planner/AStar.ts` (+ new
`src/navigation/planner/OpenHeap.ts`).

**Change:**

1. New class `OpenHeap` — min-heap keyed by primitive triple `(f, g, seq)`.
   - `seq` is monotonic insertion counter; replaces `compareNodeKey`
     tiebreak. Avoids string comparison entirely on the hot path.
   - Stores entries `{ key: NodeKey; f: number; g: number; seq: number }`.
   - Operations: `push(entry)`, `popMin(): Entry | null`, `size: number`.
   - Lazy deletion: when `gScore.get(entry.key) < entry.g` at pop time,
     discard the stale entry and pop again.
   - No decrease-key. Improving `g` for a node = push a new entry; the
     stale one is filtered on pop.

2. Replace in `AStar.search`:

   - `const open = new Set<NodeKey>();` →
     `const heap = new OpenHeap();`
   - Drop `pickOpenNode` entirely.
   - Loop becomes:

     ```ts
     while (heap.size > 0) {
       const entry = heap.popMin();
       if (entry === null) break;
       const currentKey = entry.key;
       if (closed.has(currentKey)) continue;

       const currentG = gScore.get(currentKey);
       if (currentG === undefined) return fail(new Error('astar_g'));
       if (entry.g > currentG) continue; // stale

       closed.add(currentKey);
       ...
     }
     ```

   - In `relaxEdge`, after updating `gScore`/`fScore`, push a new entry
     into the heap instead of `open.add`.

3. Drop `compareNodeKey` import from `AStar.ts` (still used elsewhere; keep
   the export in `Node.ts`).

**Expected effect:** Replace O(n²) total picking with O(n log n). Expected
~50–100× speedup on large frontiers. A 284 k-expansion exhaustive search
should drop from ~135 s to ~1–3 s. With Phase 1 cap of 20 k, well under
100 ms.

**Risk:**

- Heap correctness bugs on tiebreaks. Mitigated by `seq` counter giving a
  total order on `(f, g, seq)`.
- Stale-entry filtering must use `gScore` lookup, not equality with the
  popped entry, so concurrent improvements during processing are tolerated
  (they can't happen in synchronous search but the invariant is the right
  one for Phase 3).

**Test plan:**

- New unit test `tests/navigation/openHeap.test.ts` (project convention is
  `tests/<area>/<camelCase>.test.ts`, not collocated):
  - `popMin` order matches sorted-array baseline across random
    `(f, g, seq)` triples.
  - `size` accurate after N pushes / M pops.
  - Stale-on-pop pattern: push `(f=10, g=10, seq=1)`, push
    `(f=10, g=5, seq=2)`, pop returns the lower-g entry; old entry then
    pops as stale.
- AStar regression: existing tests in `tests/navigation/astar.test.ts`,
  `pathfinding-jumps.test.ts`, `navigation.test.ts`,
  `neighbor-generator.test.ts`, `validator.test.ts`, `hostile.test.ts`
  must produce the **same path cost** as before. Path identity may differ
  (tiebreaks change with seq vs string compare), so assertions on exact
  action sequences may need relaxing to assertions on cost + endpoints.
  Audit each before changing.
- Add a `staleSkipped` counter to `searchEnd` telemetry to monitor heap
  correctness in production logs (sanity check: on a reachable goal,
  staleSkipped should be small relative to expanded).
- Manual: re-run failing scenario, confirm `expanded` counts match Phase 1
  budget (heap doesn't change which nodes get expanded under the same
  heuristic and tiebreak ordering modulo seq order, only how fast).

---

### Phase 3 — Yield to event loop during search

**File:** `src/navigation/planner/AStar.ts`,
`src/navigation/NavigationController.ts`.

**Change:**

1. Make `AStar.search` `async` and return `AsyncResult<PlanResult>`.

2. Add config:

   ```ts
   NAV_YIELD_EVERY: z.coerce.number().int().min(0).default(2000),
   ```

   `0` = never yield (preserve current behavior for tests / replay).

3. Inside the loop, every `NAV_YIELD_EVERY` expansions:

   ```ts
   if (yieldEvery > 0 && expanded % yieldEvery === 0) {
     await new Promise<void>((resolve): void => {
       setImmediate((): void => resolve());
     });
     // re-check snapshot after yielding
     if (snap0 !== world.snapshotGeneration) {
       telemetry.searchEnd({
         status: 'aborted',
         reason: 'snapshot_stale',
         expanded,
         cost: null,
         durationTicks: durationTicks(),
       });
       return fail(new Error('world_snapshot_stale'));
     }
   }
   ```

   The post-yield snapshot recheck is critical: `BotWorld` invalidates its
   cache on `blockUpdate` and bumps `snapshotGeneration`. If a block
   changed during the yield, the partial search is no longer valid and
   `walkTo` will replan from a fresh start.

4. `NavigationController.ts:116` — `await` the search:

   ```ts
   const planOp = await AStar.search(...);
   ```

5. Add `AsyncResult` import in `AStar.ts` from `../../shared/result`.

6. Update **all** sync call sites — Phase 3 makes the signature
   `Promise<Result<PlanResult>>`:

   ```
   src/navigation/NavigationController.ts:116    add `await`
   tests/navigation/astar.test.ts:17, 48, 68, 76
   tests/navigation/hostile.test.ts:19
   tests/navigation/navigation.test.ts:75
   tests/navigation/neighbor-generator.test.ts:35, 56
   tests/navigation/pathfinding-jumps.test.ts:16
   tests/navigation/validator.test.ts:17, 75
   ```

   Each test `it(...)` body that calls `AStar.search` must become `async`
   and `await` the result. Bun test supports `async` bodies natively.

7. Replay-mode determinism gate. `src/main.ts:208` reads
   `config.env.REPLAY_JSONL`. Pass an effective yield budget into
   `NavigationController` (or read inside `walkTo`):

   ```ts
   const yieldEvery =
     config.env.REPLAY_JSONL !== undefined ? 0 : config.env.NAV_YIELD_EVERY;
   ```

   `0` disables yields → loop is functionally synchronous → replay
   ordering matches recording.

8. `NeighborGenerator.queuedEdgeLegal` calls `NeighborGenerator.expand`
   directly, **not** `AStar.search`. Untouched — confirm by leaving
   `expand` synchronous.

**Expected effect:** Even under pathological searches, TUI redraws every
~16 ms (one tick of the event loop ≈ a few ms with yield interval 2000).
Input handling (Ctrl-C, command entry) responsive throughout.

**Risk:**

- Mid-search world mutation. Mitigated by post-yield snapshot recheck —
  same invariant the existing pre-yield code relies on.
- Multiple concurrent `walkTo` calls on the same controller. Already
  serialized by the `draining` flag and the `await` chain in
  `NavigationController.walkTo`. Confirm by grep: only one in-flight call
  per bot.
- Replay determinism. `setImmediate` ordering is non-deterministic across
  runs. Set `NAV_YIELD_EVERY=0` in replay mode (replay env reads from
  `REPLAY_JSONL`, gate via that).

**Test plan:**

- Unit: existing AStar tests pass with `NAV_YIELD_EVERY=0`.
- Unit: new test runs `AStar.search` with yield enabled and a fake
  `setImmediate`, asserts loop yields the expected number of times.
- Manual: spam guided commands while a long search is running; TUI input
  must respond <100 ms; Ctrl-C must kill the bot promptly.
- Manual: trigger a `blockUpdate` mid-search (place a block via a second
  client) and confirm `snapshot_stale` abort fires and `walkTo` retries.

---

## Config Surface (final state)

`src/config/schemas/bot.ts`:

```ts
NAV_MAX_EXPANSIONS: z.coerce.number().int().min(100).default(20000),
NAV_YIELD_EVERY:    z.coerce.number().int().min(0).default(2000),
```

`.env.example` additions:

```
NAV_MAX_EXPANSIONS=20000
NAV_YIELD_EVERY=2000
```

---

## Verification

After all three phases land, re-run the original failing case (guided
walk to `(9, 75, 99.5)` from spawn with no reachable path):

1. **Bot log** — `plan_failed` arrives in <2 s, repeatedly. No multi-minute
   gaps.
2. **Event log** — every `search_end` shows `expanded ≤ 20000` with
   `reason: "expansion_budget"`.
3. **TUI** — type into the command box during the search; characters
   appear within one frame. Ctrl-C exits within 100 ms.
4. **Telemetry** — `summary` `walk.nav.fail` counter still increments
   (semantics preserved), and a new aggregate of search durations should
   show p99 well under 1 s.
5. **Tests** — `bun test` green across all files in `tests/navigation/`.
6. **Replay** — `REPLAY_JSONL=...` against a previously recorded session
   reproduces identical action sequences (yield disabled in this mode).
7. **Heap sanity** — `staleSkipped / expanded` ratio in `search_end`
   events stays below ~0.5 on reachable goals.

---

## Rollout Order

1. **Phase 1** alone, ship and observe in a real session. Hitches should
   drop from minutes to ~1 s. Lowest-risk change.
2. **Phase 2** on top — hitches drop to <100 ms even at the cap.
3. **Phase 3** on top — hitches functionally invisible; TUI smooth under
   any plan size or any future pathological case.

If Phase 1 alone proves sufficient for current usage, Phases 2 and 3 may
be deferred but should still ship since the underlying complexity bug
(RC1) and event-loop-blocking pattern (RC3) are latent foot-guns for
larger maps and longer plans.

---

## Hand-Off Checklist (for the implementing agent)

Before marking each phase done, confirm:

- [ ] All file paths in this plan still exist and line numbers still match
      (grep before editing — codebase may have moved).
- [ ] `bun test` is green.
- [ ] `bunx prettier --write` run on every touched file.
- [ ] `bunx tsc --noEmit` (or whatever the type-check script is) clean.
- [ ] No `try`/`catch`, no `any`, no `else`/`else if`, no comments,
      explicit `public`, explicit return types, Go-style error tuples
      respected — these are non-negotiable per `CLAUDE.md`.
- [ ] `.env.example` updated for any new env var.
- [ ] Phase shipped as its own commit / PR — do **not** bundle phases.
- [ ] Manual repro of the freeze scenario captured in fresh logs and
      diffed against `logs/bot-2026-05-08T01-30-33.log` for the report.

## Out-of-Scope Follow-Ups (track separately, do not bundle)

- Heuristic upgrade (e.g. octile distance with diagonal flag, water-aware
  cost). Phase 2 makes overhead per node lower, encouraging this.
- Anytime / iterative-deepening A*. Lets long searches return a partial
  best-effort path. Real value only after Phase 3 unblocks the loop.
- Persistent open set across replans within the same goal. Big win when
  Recovery triggers many small replans, but unrelated to the freeze.
- Worker-thread planner. Cleaner than yielding but heavier change; only
  worth it if Phase 3 yield granularity proves insufficient.
