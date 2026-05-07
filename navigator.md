# Minecraft Beta 1.7.3 Navigation System

Agent-facing specification for replacing ad-hoc or pathfinder-based bots with a **deterministic, telemetry-first** navigation stack. Execution favors **reliability and observability** over shortest geometric path. Movement is expressed as **discrete actions** planned ahead of time, not continuous control-state steering.

This document is the north star for code under `src/navigation/`. **`Navigator`** (`src/skills/Navigator.ts`) is the **outward** walking API; it delegates to **`NavigationController`** (`src/navigation/NavigationController.ts`), which **`BotKernel`** keeps **`private`**. **`mineflayer-pathfinder` is not used** in this codebase; avoidance is **edge-level** (`EdgeMemory`), not blunt node bans.

---

## 1. Objectives

| Goal                | Meaning                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic       | Same world snapshot + same policy inputs → same planned action sequence (modulo explicit randomness knobs, default off).                                         |
| Telemetry-first     | Every phase emits structured events so runs are debuggable without reproducing in-game.                                                                          |
| Reliable execution  | Prefer plans that survive physics, chunk boundaries, and narrow gaps; accept longer paths.                                                                       |
| Discrete actions    | Planner outputs a queue of `Action` values; executor maps them to bot operations per physics tick.                                                               |
| Beta 1.7.3 fidelity | Rules for step-up height, fall damage thresholds, fluid behavior, and collisions must match the target version (encode version-specific constants in one place). |

### 1.1 Non-goals

- Global optimality or minimum block count at the expense of success rate.
- Mixing dig/build planning into v1 (optional later layer).
- Using `sleep()` or wall-clock timing for movement synchronization.

---

## 2. Strict coding constraints

Align with `CLAUDE.md` and apply consistently under `src/navigation/`:

1. **No `try` / `catch`** except at the outermost boundary when an external library forces it; convert immediately to a tuple result.
2. **No `any`**; use explicit types and narrow unions.
3. **No `else if` / `else`**; use early returns and guard clauses.
4. **Explicit return types** on every function and method.
5. **Go-style errors**: fallible APIs return `[Error | null, T | null]` (or `Promise<…>`). After each call: `if (err) return [err, null];`. Do not throw for control flow.
6. **Sets and maps** for membership, deduplication, and caches keyed by stable ids (open sets, closed sets, edge keys, chunk-local block queries).
7. **OOP**: prefer classes for cohesive state; **`public` keyword required** on non-private methods.
8. **Minimum indentation**: flatten with early returns; avoid deep nesting.

---

## 3. Architectural separation of concerns

Do **not** merge search, execution, and recovery in one type. **One-way data flow:**

```text
Planner → Action[] (queue) → loop:
  Validator (pre-action) → Executor → Validator (post-action / tick) → (ok | Recovery)
```

Current integration: **`NavigationController`** owns plan → **`NavigationExecutor`** → **`Recovery`** on failure (see §14).

| Layer         | Responsibility                                                                                                                                                                                                                           | Must not                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Planner**   | Graph search over navigable states; outputs ordered `Action` list.                                                                                                                                                                       | Touch `bot.setControlState` or wait on real time.                 |
| **Executor**  | Consumes actions; applies bot inputs synchronized to **physics ticks**; resumes **macro** steps across ticks without blocking the event loop.                                                                                            | Run A\* or mutate world models beyond confirmed bot state.        |
| **Validator** | **Before** applying the **next** queued action: re-check dynamic world/state (blocking mobs, opened/closed gap, mined block). **After** each action or tick: compare predicted vs actual (position, support, heading, interact outcome). | Silently “fix” drift without emitting telemetry.                  |
| **Recovery**  | On failure: update **edge** statistics, optionally invalidate local cache, request **replan**.                                                                                                                                           | Permanently ban destinations or whole nodes without edge context. |

### 3.1 Pre-action vs post-action validation

The world is **dynamic**. A plan edge that was valid at search time can become invalid while the bot finishes the **previous** action (mob steps into the cell, a block breaks, a door state flips, liquid flows).

- **Pre-action (look-ahead):** Immediately **before** the `Executor` starts the **next** `Action`, run the same predicates the planner used for that transition (passability, headroom, door open, hostile occupancy if modeled, etc.) against **current** `World`/`Bot` input. If the check fails: emit telemetry (`pre_action_rejected` or `movement_fail` with `phase: pre_action`), do **not** start the executor step, and hand off to **Recovery** (typically **replan** when the obstruction looks transient rather than blindly penalizing an edge never attempted).
- **Post-action:** After executor work for a tick or for a completed atomic/macro step, confirm the bot achieved the expected post-condition; if not, fail and recover.

Neither phase may use wall-clock `sleep()` to wait for the world to change; retries and observes advance on **physics ticks** or discrete game events.

**Code note (§14):** **`NavigationValidator`** applies **`NeighborGenerator.queuedEdgeLegal`** (with the same **`ExpandOpts`** as **`NavigationController`**, e.g. diagonal) for pre-action replay plus foot-cell alignment and **`movementClass`**, matching **`World.footMovementClass`**, **`World.hostileOccupiesFootCell`**, and **`Collision`**. Post-action checks foot **`to`**, **`Collision.canStandAt`**, **`Interact`** door openness on **`World`**, and **`BETA_173`** velocity caps (see §14).

---

## 4. Discrete action model

The planner reasons about **edges** in a graph whose nodes represent foot positions (or equivalent canonical cell state). Each **traversal** corresponds to a concrete `Action` (or short **macro** expanded by the executor).

### 4.1 Primitive actions (initial set)

- **`WalkAction`**: horizontal move by one cell (cardinal; diagonal only if explicitly supported and encoded as a single stable transition).
- **`JumpUpAction`**: gain exactly one block of height at a cell boundary (clear headroom, step-up rules).
- **`DropDownAction`**: intentional descent (one or more blocks with safe fall policy).
- **`InteractAction`**: door, gate, or other block interaction required to realize an edge (open/close with validation).

### 4.2 Rules

- Control is **not** “steer until close”; it is “emit `WalkAction` N times” or until validator confirms segment complete.
- Each `Action` must serialize to telemetry (`action_id`, `from_node`, `to_node`, `kind`).

### 4.3 Macro actions and yielding (multi-tick)

Some logical actions span **multiple physics ticks** (e.g. **`InteractAction`**: use block → wait until door is visually/passably open → then allow the following **`WalkAction`**).

- **`Executor`** treats a macro as an internal **state machine** or queued **micro-steps** (e.g. `interact_press`, `interact_wait_open`, done). On each **`physicsTick`**, it performs **at most** the next micro-step—or observes and advances when conditions are met—then **returns** (yields). It must **never** busy-loop or **`sleep()`** waiting for animations or door state.
- **Yielding:** advancing the macro is strictly “do a little work on this tick → return control to the event loop → resume on the next **`physicsTick`** (or targeted event such as block update **if** the stack exposes it reliably). The following **`WalkAction`** runs only after **post-action** validation confirms the macro’s success condition (e.g. traversal through the doorway is legal in `Collision`/`World`).
- **Telemetry:** emit `movement_start` for the **logical** `Action`; optional `movement_tick` with `phase: macro_step` while in progress; `movement_complete` when the macro and any required follow-up invariant pass.

---

## 5. Graph model: nodes and edges

### 5.1 Node

- Canonical key: integer block coordinates for the **foot cell** (and any extra state needed for 1.7.3, e.g. “in water” if it changes movement class).
- `Node` holds **world-fixed** data only (position key, optional metadata from `World`).

**Code note:** **`Node.key`** appends **`|m:w`** when **`movementClass === 'water'`** (from **`World.footMovementClass`**). **`Collision.destinationNode`** attaches class from the live world snapshot.

### 5.2 Edge (critical)

- Directed: `from` → `to`.
- Carries **kinematic cost** (time/effort estimate) separate from **learned penalty**.
- On **verified failure** along that transition:
  - `failureCount++`
  - `cost += penalty` (e.g. constant bump such as `+5` on top of base cost)
  - apply **time decay** so old failures fade (half-life or sliding window; store `lastFailureTick` or timestamp from game tick counter).

**Do not** implement “bad nodes” as the primary signal. A node may be reachable from another direction; only the **failed edge** should be expensive.

### 5.3 Edge memory

`EdgeMemory` (or equivalent) stores:

- Key: stable edge id `(fromKey, toKey, actionKind)`.
- Fields: `failureCount`, `penalty`, `lastUpdatedTick`.
- Decay function run on read or on a schedule tick (document chosen policy in class header).

**Code:** `EdgeMemory.costWithMemory` applies learned additive cost with exponential decay (`HALF_LIFE_TICKS`).

### 5.4 Persistence scope (explicit default)

Agents must **not** infer database technology from this spec.

- **Default (v1):** `EdgeMemory` is **in-memory only** for the **current bot process/session**. Restarting the script clears penalties; this is intentional to avoid stale world assumptions and stale file paths across servers/world seeds.
- **Optional (later):** If cross-session learning is desired, add an explicit, small **JSON file** (or append-only NDJSON log merged on boot) behind a **config flag and file path**. Load once at startup, save on a **bounded** schedule (e.g. every N failures, on clean shutdown) with a **max entries** cap. **Do not** introduce SQLite or heavy persistence unless a future revision of this document requires it.

**Code:** Optional JSON persistence when **`NAV_EDGE_MEMORY_FILE`** is set (see **`EdgeMemory`** constructor in **`src/config/schemas/bot.ts`**). Loads on startup, saves every **`NAV_EDGE_MEMORY_SAVE_EVERY_FAILURES`** verified failures, trims to **`NAV_EDGE_MEMORY_MAX_ENTRIES`**, and flushes on **`beforeExit`**. In-memory remains the default when unset.

---

## 6. Planner module (`src/navigation/planner/`)

| File                   | Role                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Node.ts`              | Node type, key factory, ordering for queues.                                                                                                                                                     |
| `Edge.ts`              | Edge type, cost, penalty fields, serialization.                                                                                                                                                  |
| `NeighborGenerator.ts` | From a **`Node` + `World`**, legal moves (cardinal plus **optional diagonal** **`WalkAction`** when **`NAV_DIAGONAL=1`**), aquatics cost bump. **`queuedEdgeLegal`** re-expands with the same **ExpandOpts** as the controller.                                                                                                                                                                 |
| `Heuristic.ts`         | Admissible or conservative estimate to goal (Manhattan/octile on grid; vertical weighting for falls/climbs).                                                                                     |
| `AStar.ts`             | Open set (e.g. `Map` + priority queue), closed set, replan entry points, integration with `EdgeMemory` for dynamic edge weight.                                                                  |

**Search contract:** given `start`, `goal`, `World` interface, and `EdgeMemory`, return **fallible planner result** (this repo uses **`Result<PlanResult>`** from `src/shared/result.ts`; same intent as `[err, …]` elsewhere).

---

## 7. Movement module (`src/navigation/movement/`)

| File           | Role                                                                                                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Actions.ts`   | Discriminated union / class hierarchy for `Action`; encode to JSON for telemetry.                                                                                                                                                                                                         |
| `Executor.ts`  | Runs the queue; subscribes to **`physicsTick`** (or the project’s equivalent mineflayer hook); never uses `sleep()` for physics pacing.                                                                                                                                                   |
| `Validator.ts` | **`preAction`**: foot **`from`**, **`movementClass`**, **`NeighborGenerator.queuedEdgeLegal`** (including **diagonal** when **`NAV_DIAGONAL`**). **`postAction`**: foot **`to`**, **`movementClass`**, **`Collision.canStandAt`**, door open for **`Interact`**, **velocity caps** from **`BETA_173`** (**`post_velocity_*`** errors). **`Result<…>`** per **`CLAUDE.md`**. |

**Synchronization rule:** all movement progression advances on **physics ticks**, not wall-clock delays. **Macros** advance by yielding between ticks (see §4.3).

---

## 8. World module (`src/navigation/world/`)

| File           | Role                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `World.ts`     | **Interface**: cells, doors, **`footMovementClass`**, **`hostileOccupiesFootCell`**, optional **`snapshotGeneration`**.                                                                                      |
| `BotWorld.ts`  | Live **`World`** over `mineflayer`: caches; fluids non-colliding for **`cell`**; **`footMovementClass`** by block name; **`hostileOccupiesFootCell`** scans **`entities`** typed **`hostile`** / **`kind`**.   |
| `Collision.ts` | **`destinationNode`**, cardinal/diagonal walk predicates, step-up / fall, doors; **`canStandAt`** rejects hostile overlap at feet/head.                                                                      |
| `Beta173.ts`   | Collision + **post-action velocity limits** (blocks/tick).                                                                                                                                                   |

The planner and neighbor generator depend on **`World`**, not on `Bot` directly, to keep search testable **`FixtureWorld`** in **`src/navigation/test/`**.

---

## 9. Telemetry module (`src/navigation/telemetry/`)

Structured **JSON** events (one object per line or existing logger sink; align with `Logger` / metrics conventions in `src/shared/`).

### 9.1 Search

| Event                 | When                      | Suggested fields                              |
| --------------------- | ------------------------- | --------------------------------------------- |
| `search_start`        | Planner invoked           | `start`, `goal`, `tick`, `runId`              |
| `search_end`          | Success or failure        | `status`, `expanded`, `cost`, `durationTicks` |
| `node_expand`         | Node popped from open set | `node`, `g`, `f`                              |
| `candidate_generated` | Neighbor considered       | `from`, `to`, `action`                        |
| `candidate_rejected`  | Pruned by rules           | `from`, `to`, `reason`                        |
| `path_selected`       | Final path                | `actions[]`, `totalCost`                      |

### 9.2 Execution

| Event                 | When                                                 | Suggested fields                                                                   |
| --------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pre_action_rejected` | Look-ahead failed before starting next queued action | `next_action`, `reason`, `observed`, `tick`                                        |
| `movement_start`      | Executor begins action                               | `action`, `tick`                                                                   |
| `movement_tick`       | Optional high-rate                                   | `phase`, `pos`, `tick`                                                             |
| `movement_complete`   | Validator ok                                         | `action`, `pos`                                                                    |
| `movement_fail`       | Validator or timeout                                 | `action`, `reason`, `observed`, `phase` (`pre_action` \| `post_action` \| `macro`) |

### 9.3 Recovery

| Event            | When                | Suggested fields                  |
| ---------------- | ------------------- | --------------------------------- |
| `edge_penalized` | Edge memory updated | `edge`, `failureCount`, `penalty` |
| `replan`         | New search          | `reason`, `fromPos`               |
| `stuck_detected` | No progress         | `windowTicks`, `lastProgressPos`  |

---

## 10. Recovery module (`src/navigation/recovery/`)

| File            | Role                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Recovery.ts`   | State machine: `EXECUTING` → `VALIDATE_FAIL` → penalize edge → `REPLAN` with budget (max replans per goal).                                                                                     |
| `EdgeMemory.ts` | In-process edge penalties + decay by default (§5.4); API aligned with **`recordFailure`** / **`costWithMemory`** / **`tickDecay`**. Optional file backing only if explicitly enabled in config. |

---

## 11. Directory structure (repository)

```text
src/navigation/
  NavigationController.ts   # orchestration: A* → drainQueue → Recovery
  navigation.test.ts
  planner/
    AStar.ts
    Node.ts
    Edge.ts
    NeighborGenerator.ts
    Heuristic.ts
  movement/
    Executor.ts
    Actions.ts
    Validator.ts
  world/
    World.ts
    BotWorld.ts
    Collision.ts
    Beta173.ts
  telemetry/
    Events.ts
    Recorder.ts
  recovery/
    Recovery.ts
    EdgeMemory.ts
  test/
    FixtureWorld.ts
```

- **`Events.ts`**: event name literals, payload types (no `any`; some fields use **`Record<string, unknown>`** for JSON-shaped blobs).
- **`Recorder.ts`**: thin wrapper emitting via shared **`Logger`**.

---

## 12. Determinism and testing

- **Stable ordering**: neighbor expansion order must be fixed (e.g. sorted direction list) when costs tie. **Implemented:** fixed cardinal order plus **sorted destination keys** (`NeighborGenerator`).
- **Snapshot planning**: planner reads a **consistent** world snapshot for one search iteration; if world changes mid-search, abort with **`snapshot_stale`**. **Implemented:** **`AStar`** compares `world.snapshotGeneration` from search start (`BotWorld` bumps generation on **`blockUpdate`**).
- **Unit tests**: **`navigation.test.ts`** covers **`Heuristic`**, **`EdgeMemory`** (decay + optional disk round-trip), **`AStar`** corridor, **`NeighborGenerator`** doors + **diagonal expand**, **`queuedEdgeLegal`**, **hostile fixture**, **water `Node` key**, **velocity post-check**, **`NavigationValidator`**. Extend with more maps and **`Collision`** corners as needed.

---

## 13. Migration and integration (`Navigator`)

Historical note: navigation used to rely on **`mineflayer-pathfinder`** and **`badNodes`**-style bans. Current state:

1. **`package.json`** does not include **`mineflayer-pathfinder`**; planner is internal **A\***.
2. **`EdgeMemory`** supplies **directed edge** penalties plus decay; **`Recovery`** emits **`edge_penalized`** and consumes **replan budget** in **`NavigationController`**.
3. **`NavigationRecorder`** routes search/movement/recovery events through **`Logger.event`** aligned with **`NAV_EVENT`**.
4. **`Navigator.walkTo`** is the **only** high-level walking API: **`Logger`** and **`metrics`** for walks plus delegation to **`NavigationController.walkTo`** (no manual **`setControlState`** fallback). **`GuidedMode`** and **`Mine`** navigate through **`navigator.walkTo`**; **`NavigationController`** is **`private`** inside **`BotKernel`** (**`navigator`** is the outward seam).

---

## 14. Implementation status (maintain this section)

Maintenance section: bump when modules change materially.

### 14.1 Implemented

| Area      | Detail                                                                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planner   | **`AStar.search`**, **`NeighborGenerator.expand`** + **`ExpandOpts`**, **`Heuristic`**, **`Node`** / **`SearchEdge`**; **`EdgeMemory.costWithMemory`**; **aquatic cost bump** on edges touching **`movementClass: water`**                                                                                                         |
| Snapshot  | **`BotWorld.snapshotGeneration`**; search abort **`world_snapshot_stale`**                                                                                                                                                                                                                          |
| Ordering  | Stable neighbor enumeration and **tie-break on `compareNodeKey`** in open-node pick                                                                                                                                                                                                                 |
| Actions   | **`WalkAction`** (cardinal + optional diagonal), **`JumpUpAction`**, **`DropDownAction`**, **`InteractAction`** with **`toTelemetry()`**                                                                                                                                                              |
| Executor  | **`physicsTick`** subscription; **`drainQueue`**; per-action tick caps; **interact** macro phases **align → activate → wait**; **`movement_tick`** with **`macro_step`**                                                                                                                            |
| Recovery  | Replan budget, **`recordVerifiedFailure`**, **`onPreActionRejected`**, **`notifyStuck`** (when position unchanged **`STUCK_TICKS`** during drain). **`NavigationController.probeStuck`** on **`physicsTick`**                                                                                         |
| World     | **`World`** + **`BotWorld`**, **`Collision.destinationNode`**, **`Beta173`** (collisions + velocity caps); **`footMovementClass`**, **`hostileOccupiesFootCell`**                                                                                                                                   |
| Validator | **`preAction`**: foot + **`movementClass`** + **`queuedEdgeLegal`**. **`postAction`**: **`to`**, **`movementClass`**, **`canStandAt`**, door check, **velocity bounds** (**`BETA_173.POST_ACTION_*`**)                                                                                                                |
| Telemetry | **`NAV_EVENT`** + **`Recorder.aStarHooks()`** + executor/recovery emits for listed events; **`search_end`** includes **`durationTicks`** (**`AStar`** passes **`tickNow`**)                                                                                                                          |
| Edge file | Optional **`NAV_EDGE_MEMORY_*`** env: JSON file, max rows, save cadence, **`beforeExit`** flush                                                                                                                                                                                                     |
| Wiring    | **`BotKernel`**: **`private NavigationController`**, **`public navigator`**, **`Mine`**/**`GuidedMode`** call **`navigator.walkTo`**                                                                                                                                                                 |
| Config    | **`NAV_DIAGONAL`** (**`0`** / **`1`**), **`NAV_EDGE_MEMORY_FILE`**, **`NAV_EDGE_MEMORY_MAX_ENTRIES`**, **`NAV_EDGE_MEMORY_SAVE_EVERY_FAILURES`** in **`bot` schema**                                                                                                                                |
| Tests     | **`bun test`**: heuristic, corridor A\*, door **`interact`**, **`queuedEdgeLegal`**, disk **`EdgeMemory`**, diagonal fixtures, hostile no-path, water key parsing, **`NavigationValidator`** including velocity gate                                                                                   |

### 14.2 Partial / stubbed

| Area | Detail |
| ---- | ------ |
| —    | _(none at this revision; prior velocity gap closed in §14.1)_        |

### 14.3 Not implemented (spec backlog)

| Item                  | Spec ref      |
| --------------------- | ------------- |
| Dig/build planning    | §1.1 non-goal |

### 14.4 Intentionally deferred / non-goals

- SQLite or heavy persistence for edge memory (**absent unless this doc is revised**).
- Global shortest-path optimality.

### 14.5 Practical caveats (known limitations)

| Topic            | Detail                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`durationTicks`** | Often **0** when the planner finishes in one synchronous CPU turn unless **`tickNow`** advances between search start/end (passed from **`NavigationController`**). |
| **`Interact` post** | Success is modeled as **`closedDoorAt`** false at the interacted block (**`InteractAction`** target), not a full same-tick collision replay after walking through it. |

---

## 15. Quick reference checklist

- [x] Planner emits **`NavigationAction[]` only**; no control-state steering in planner (**`AStar` / `NeighborGenerator`**).
- [x] Executor driven by **`physicsTick`**; no movement **`sleep()`**; macros yield tick-to-tick (**`NavigationExecutor`**).
- [x] **Pre-action** look-ahead before each new action; **post-action** validation after executor work (**`NavigationValidator`** + **`NeighborGenerator.queuedEdgeLegal`**).
- [x] Optional **`EdgeMemory`** JSON persistence behind **`NAV_EDGE_MEMORY_*`** (**§5.4**); **`beforeExit`** flush.
- [x] Failures penalize **`from → to` edges** with decay via **`Recovery.recordVerifiedFailure`** (not node bans).
- [x] Telemetry for search / execute / recover (**`search_end.durationTicks`** included when **`tickNow`** is passed).
- [x] **`Result`** / async **`AsyncResult`** patterns; **`Record<string, unknown>`** allowed for payloads; **`any`** disallowed project-wide (**`CLAUDE.md`**).
- [x] **Sets/maps** for open/closed/frontier, **`EdgeMemory`** rows, **`BotWorld`** caches.

Legend: **`[x]`** done **`[~]`** partial **`[ ]`** missing
