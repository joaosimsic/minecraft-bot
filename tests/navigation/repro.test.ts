import { describe, it, expect } from 'bun:test';
import fs from 'fs';
import { FixtureWorld } from '../../src/navigation/test/FixtureWorld';
import { Collision } from '../../src/navigation/world/Collision';
import { AStar } from '../../src/navigation/planner/AStar';
import { EdgeMemory } from '../../src/navigation/recovery/EdgeMemory';
import type { WorldDumpData } from '../../src/navigation/world/BotWorld';

describe('A* Reproducible World Dumps', () => {
  it('should reproduce world state and search from dump', async () => {
    const dumpPath = process.env.REPRO_FILE || 'logs/repro-latest.json';

    if (!fs.existsSync(dumpPath)) {
      console.warn(`Dump file not found: ${dumpPath}`);
      console.warn('Run a failing pathfinding operation to generate a dump.');
      return;
    }

    const dumpText = fs.readFileSync(dumpPath, 'utf-8');
    const dump: WorldDumpData = JSON.parse(dumpText);

    const fixtureWorld = new FixtureWorld();

    for (const [key, cellData] of Object.entries(dump.cells)) {
      const parts = key.split(',');
      if (parts.length < 3) continue;
      const x = parseInt(parts[0]!, 10);
      const y = parseInt(parts[1]!, 10);
      const z = parseInt(parts[2]!, 10);

      fixtureWorld.putCell(x, y, z, {
        blocksBody: cellData.blocksBody,
        topSupportStand: cellData.topSupportStand,
      });

      if (cellData.isWaterFoot) {
        fixtureWorld.markWaterFoot(x, y, z);
      }

      if (cellData.isDoor) {
        fixtureWorld.addClosedDoor(x, y, z);
      }

      if (cellData.isHostile) {
        fixtureWorld.addHostileFoot(x, y, z);
      }
    }

    const start = dump.metadata.botPosition;
    const goal = dump.metadata.goalPosition;

    if (!goal) {
      console.warn('No goal position in dump; skipping search');
      return;
    }

    const startNode = Collision.destinationNode(
      fixtureWorld,
      Math.floor(start.x),
      Math.floor(start.y),
      Math.floor(start.z),
      new Set(),
    );

    const goalNode = Collision.destinationNode(
      fixtureWorld,
      Math.floor(goal.x),
      Math.floor(goal.y),
      Math.floor(goal.z),
      new Set(),
    );

    const edgeMemory = new EdgeMemory({
      maxEntries: 10000,
      saveEveryFailures: 100,
    });

    const [searchErr, pathResult] = await AStar.search(
      fixtureWorld,
      startNode,
      goalNode,
      edgeMemory,
      0,
      'repro-test',
    );

    if (searchErr) {
      console.error(`✗ Search failed: ${searchErr.message}`);
      console.error(`  Dump: ${dumpPath}`);
      expect(searchErr).toBeNull();
    } else if (pathResult) {
      console.log(`✓ Path found: ${pathResult.path.length} steps`);
      console.log(
        `  Start: (${Math.floor(start.x)}, ${Math.floor(start.y)}, ${Math.floor(start.z)})`,
      );
      console.log(
        `  Goal: (${Math.floor(goal.x)}, ${Math.floor(goal.y)}, ${Math.floor(goal.z)})`,
      );
      expect(pathResult.path.length).toBeGreaterThan(0);
    } else {
      console.warn('No path exists (goal unreachable)');
      expect(pathResult).toBeDefined();
    }
  });
});
