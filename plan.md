# A* Reproducible World Dumps — Implementation Plan

## Feature Overview

When A* pathfinding fails (e.g., "goal unreachable"), we cannot determine whether the failure stems from a legitimate obstacle, a heuristic bug, or a world desync (the bot's cached world state diverging from reality). This feature captures the bot's exact mental model—its block cache—at the moment of failure and persists it to JSON. An offline test environment can then load this dump, instantiate an identical world state, and replay the A* search deterministically to reproduce the failure and debug root causes.

**Success Criteria:**
- Dumps are written to `logs/repro-<runId>.json` whenever `AStar.search()` returns failure.
- Dumps contain complete block state: coordinates, block names, collision properties, water state, doors, and hostile mobs.
- Offline test harness can reconstruct the world and re-run A* with identical inputs.
- Test output clearly indicates search success/failure and provides path length or failure reason.

---

## Phase 1: Implement the World Dumper

### Target: `src/navigation/world/BotWorld.ts`

**Objective:** Add an `exportWorldDump()` method that serializes the bot's cached world state to a portable JSON structure.

### Implementation Details

#### Method Signature
```typescript
public exportWorldDump(): WorldDumpData {
  // Serialize this.cache to a structured JSON object
}
```

#### Return Type Definition
```typescript
interface WorldDumpData {
  metadata: {
    timestamp: number; // ISO 8601 or Unix ms
    runId: string;
    botPosition: { x: number; y: number; z: number };
    goalPosition?: { x: number; y: number; z: number };
  };
  cells: Record<string, CellDumpData>;
}

interface CellDumpData {
  name: string;
  blocksBody: boolean;
  topSupportStand: boolean;
  isMc: boolean; // minecraft:air vs other
  isWater: boolean;
  isWaterFoot: boolean;
  isDoor: boolean;
  isHostile: boolean;
  meta?: { doorState?: "open" | "closed"; hostileType?: string };
}
```

### Algorithm
1. Iterate over all entries in `this.cache` (assumed to be a Map or object keyed by coordinate string).
2. For each cached block, extract all relevant properties from the block object.
3. Normalize coordinate keys to a consistent format (e.g., `"x:y:z"`) for reconstruction.
4. Include bot position and (if available) the goal position that was being searched for.
5. Return the structured `WorldDumpData` object (JSON-serializable).

### Code Structure
```typescript
public exportWorldDump(): WorldDumpData {
  const cells: Record<string, CellDumpData> = {};

  for (const [key, block] of this.cache) {
    cells[key] = {
      name: block.name,
      blocksBody: block.blocksBody ?? false,
      topSupportStand: block.topSupportStand ?? false,
      isMc: block.isMc ?? false,
      isWater: block.isWater ?? false,
      isWaterFoot: block.isWaterFoot ?? false,
      isDoor: block.isDoor ?? false,
      isHostile: block.isHostile ?? false,
      meta: this.extractMetadata(block),
    };
  }

  return {
    metadata: {
      timestamp: Date.now(),
      runId: process.env.RUN_ID || "unknown",
      botPosition: { x: this.bot.entity.position.x, y: this.bot.entity.position.y, z: this.bot.entity.position.z },
      goalPosition: this.lastGoal || undefined,
    },
    cells,
  };
}

private extractMetadata(block: any): Record<string, any> {
  const meta: Record<string, any> = {};
  if (block.isDoor) {
    meta.doorState = block.isOpen ? "open" : "closed";
  }
  if (block.isHostile) {
    meta.hostileType = block.mobType || "generic";
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}
```

---

## Phase 2: Triggering Dumps on Failure

### Target: `src/navigation/NavigationController.ts`

**Objective:** Integrate dump triggering into the `walkTo` method so that every pathfinding failure automatically captures the world state.

### Implementation Details

#### Dependencies
- Require Node's `fs` module at the top of `NavigationController.ts`.
- Ensure logs directory exists or create it during bot initialization.

#### Modify `walkTo` Method
When `AStar.search()` returns a failure (null or error result), immediately:

1. Call `this.world.exportWorldDump()` to get the serialized state.
2. Generate a unique filename: `repro-<runId>-<timestamp>.json`.
3. Write the dump to `logs/` using `fs.writeFileSync`.
4. Include the filename in the existing debugLog telemetry payload.

#### Code Structure
```typescript
import fs from "fs";
import path from "path";

public async walkTo(goal: Vec3): Promise<[Error | null, boolean]> {
  // ... setup code ...

  const [searchErr, path] = AStar.search(start, goal, this.world, heuristic);

  if (searchErr || !path) {
    // Dump world state on failure
    const dump = this.world.exportWorldDump();
    const timestamp = Date.now();
    const runId = process.env.RUN_ID || "unknown";
    const dumpFilename = `repro-${runId}-${timestamp}.json`;
    const dumpPath = path.join(process.cwd(), "logs", dumpFilename);

    // Ensure logs directory exists
    fs.mkdirSync(path.dirname(dumpPath), { recursive: true });

    fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2), "utf-8");

    // Include in telemetry
    this.debugLog({
      event: "pathfinding_failure",
      reason: searchErr?.message || "no_path",
      dumpFile: dumpFilename,
      goal,
      startPos: start,
    });

    return [searchErr || new Error("Goal unreachable"), false];
  }

  // ... continue with successful path execution ...
  return [null, true];
}
```

#### Telemetry Update
Ensure the debugLog payload includes:
- `dumpFile: string` — the filename written to disk
- `reason: string` — the specific failure reason (if available)
- `goal: Vec3` — the target position
- `startPos: Vec3` — the starting position

This allows correlating telemetry events with dump files for later analysis.

---

## Phase 3: The Offline Reproduction Test

### Target: Create `tests/navigation/repro.test.ts`

**Objective:** Build a Bun test harness that loads a world dump JSON, reconstructs the exact world state, and replays the A* search for debugging.

### Implementation Details

#### Test Structure
```typescript
import { describe, it, expect } from "bun:test";
import fs from "fs";
import path from "path";
import { FixtureWorld } from "./fixtures/FixtureWorld";
import { AStar } from "../../src/navigation/planner/AStar";
import type { WorldDumpData } from "../../src/navigation/world/BotWorld";

describe("A* Reproducible World Dumps", () => {
  it("should reproduce world state and search from dump", () => {
    // 1. Load the dump file
    const dumpPath = process.argv[2] || "logs/repro-latest.json";
    const dumpText = fs.readFileSync(dumpPath, "utf-8");
    const dump: WorldDumpData = JSON.parse(dumpText);

    // 2. Instantiate a FixtureWorld (mock world for testing)
    const fixtureWorld = new FixtureWorld();

    // 3. Populate the fixture world from the dump
    for (const [key, cellData] of Object.entries(dump.cells)) {
      const [x, y, z] = key.split(":").map(Number);

      fixtureWorld.putCell(x, y, z, {
        name: cellData.name,
        blocksBody: cellData.blocksBody,
        topSupportStand: cellData.topSupportStand,
        isMc: cellData.isMc,
        isWater: cellData.isWater,
        isWaterFoot: cellData.isWaterFoot,
        isDoor: cellData.isDoor,
        isHostile: cellData.isHostile,
      });

      // Mark water feet if needed
      if (cellData.isWaterFoot) {
        fixtureWorld.markWaterFoot(x, y, z);
      }

      // Mark doors with state
      if (cellData.isDoor && cellData.meta?.doorState) {
        fixtureWorld.markDoor(x, y, z, cellData.meta.doorState === "open");
      }

      // Mark hostiles
      if (cellData.isHostile) {
        fixtureWorld.markHostile(x, y, z, cellData.meta?.hostileType || "generic");
      }
    }

    // 4. Extract start and goal from metadata
    const start = dump.metadata.botPosition;
    const goal = dump.metadata.goalPosition;

    if (!goal) {
      console.warn("No goal position in dump; skipping search");
      return;
    }

    // 5. Run A* search
    const [searchErr, pathResult] = AStar.search(
      { x: Math.floor(start.x), y: Math.floor(start.y), z: Math.floor(start.z) },
      { x: Math.floor(goal.x), y: Math.floor(goal.y), z: Math.floor(goal.z) },
      fixtureWorld,
      (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) // Euclidean heuristic
    );

    // 6. Log results
    if (searchErr) {
      console.error(`Search failed: ${searchErr.message}`);
      console.error(`Dump: ${dumpPath}`);
      expect(searchErr).toBeNull(); // Test will fail and print dump info
    } else if (pathResult) {
      console.log(`✓ Path found: ${pathResult.length} steps`);
      console.log(`  Start: (${start.x}, ${start.y}, ${start.z})`);
      console.log(`  Goal: (${goal.x}, ${goal.y}, ${goal.z})`);
      expect(pathResult.length).toBeGreaterThan(0);
    } else {
      console.warn("No path exists (goal unreachable)");
      expect(pathResult).toBeDefined();
    }
  });
});
```

### FixtureWorld Class Design

Create `tests/navigation/fixtures/FixtureWorld.ts` to mirror `BotWorld.ts`:

```typescript
export class FixtureWorld {
  private cache: Map<string, BlockData> = new Map();

  public putCell(x: number, y: number, z: number, blockData: BlockData): void {
    const key = `${x}:${y}:${z}`;
    this.cache.set(key, blockData);
  }

  public markWaterFoot(x: number, y: number, z: number): void {
    const key = `${x}:${y}:${z}`;
    const block = this.cache.get(key);
    if (block) {
      block.isWaterFoot = true;
    }
  }

  public markDoor(x: number, y: number, z: number, isOpen: boolean): void {
    const key = `${x}:${y}:${z}`;
    const block = this.cache.get(key);
    if (block) {
      block.isDoor = true;
      block.isOpen = isOpen;
    }
  }

  public markHostile(x: number, y: number, z: number, type: string): void {
    const key = `${x}:${y}:${z}`;
    const block = this.cache.get(key);
    if (block) {
      block.isHostile = true;
      block.mobType = type;
    }
  }

  // Implement BotWorld's public interface for A* compatibility
  public getBlockStateAt(x: number, y: number, z: number): BlockData | null {
    const key = `${x}:${y}:${z}`;
    return this.cache.get(key) || null;
  }

  public blocksBody(x: number, y: number, z: number): boolean {
    return this.getBlockStateAt(x, y, z)?.blocksBody ?? false;
  }

  public canWalkOnTop(x: number, y: number, z: number): boolean {
    return this.getBlockStateAt(x, y, z)?.topSupportStand ?? false;
  }

  // ... other methods as required by A* heuristic ...
}
```

### Running the Test

**Command:**
```bash
bun test tests/navigation/repro.test.ts -- logs/repro-<runId>-<timestamp>.json
```

**Expected Output (Success):**
```
✓ Path found: 42 steps
  Start: (100, 64, 200)
  Goal: (150, 64, 250)
```

**Expected Output (Failure):**
```
Search failed: Heuristic returned Infinity (hostile mob blocking path)
Dump: logs/repro-local-1620000000000.json
```

---

## Integration Checklist

- [ ] Add `exportWorldDump()` to `BotWorld.ts` with complete serialization logic
- [ ] Update `NavigationController.walkTo()` to catch failures and write dumps
- [ ] Create `FixtureWorld` class and populate from JSON structure
- [ ] Implement `repro.test.ts` with command-line dump file argument
- [ ] Ensure `logs/` directory is created during bot startup
- [ ] Add dump filename to telemetry payload for traceability
- [ ] Test with a real navigation failure to validate dump completeness
- [ ] Document the process in a developer guide (optional Phase 4)

---

## Notes

- **Performance:** `exportWorldDump()` is only called on failure, so overhead is negligible.
- **Storage:** Dumps can be large (~1 MB per 100,000 blocks). Consider rotating old dumps.
- **Determinism:** The FixtureWorld must exactly mirror the dump; any deviation will produce misleading results.
- **Heuristic Consistency:** Ensure the offline test uses the same heuristic function as the real A* instance.