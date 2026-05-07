import type { Result } from '../../shared/result';
import { fail, ok } from '../../shared/result';
import { compareNodeKey, Node, type NodeKey } from './Node';
import { Heuristic } from './Heuristic';
import {
  NeighborGenerator,
  type ExpandOpts,
  type Neighbor,
} from './NeighborGenerator';
import type { NavigationAction } from '../movement/Actions';
import type { World } from '../world/World';
import type { EdgeMemory } from '../recovery/EdgeMemory';
import { Collision } from '../world/Collision';

export type PlanResult = {
  path: NavigationAction[];
  nodesExpanded: number;
  cost: number;
};

export type AStarTelemetry = {
  searchStart: (data: Record<string, unknown>) => void;
  searchEnd: (data: Record<string, unknown>) => void;
  nodeExpand: (data: Record<string, unknown>) => void;
  pathSelected: (data: Record<string, unknown>) => void;
  candidateGenerated: (data: Record<string, unknown>) => void;
  candidateRejected: (data: Record<string, unknown>) => void;
};

const noopTelemetry: AStarTelemetry = {
  searchStart: (): void => {},
  searchEnd: (): void => {},
  nodeExpand: (): void => {},
  pathSelected: (): void => {},
  candidateGenerated: (): void => {},
  candidateRejected: (): void => {},
};

type CameFrom = { parent: NodeKey; via: NavigationAction };

export class AStar {
  public static search(
    world: World,
    start: Node,
    goal: Node,
    edgeMemory: EdgeMemory,
    gameTick: number,
    runId: string,
    telemetry: AStarTelemetry = noopTelemetry,
    tickNow?: () => number,
    expandOpts?: ExpandOpts,
  ): Result<PlanResult> {
    if (!Collision.canStandAt(world, start))
      return fail(new Error('start_not_standable'));
    if (!Collision.canStandAt(world, goal))
      return fail(new Error('goal_not_standable'));

    const snap0 = world.snapshotGeneration;
    const tickStart = tickNow !== undefined ? tickNow() : gameTick;
    const durationTicks = (): number => {
      const tickEnd = tickNow !== undefined ? tickNow() : gameTick;
      const d = tickEnd - tickStart;
      if (d < 0) return 0;
      return d;
    };

    telemetry.searchStart({
      start: start.key,
      goal: goal.key,
      tick: tickStart,
      runId,
    });

    let actionSeq = 0;
    const nextActionId = (_kind: string, _from: Node, _to: Node): string => {
      actionSeq += 1;
      return `${runId}:${actionSeq}`;
    };

    const gScore = new Map<NodeKey, number>();
    const fScore = new Map<NodeKey, number>();
    const cameFrom = new Map<NodeKey, CameFrom>();
    const open = new Set<NodeKey>();
    const closed = new Set<NodeKey>();

    gScore.set(start.key, 0);
    const startF = Heuristic.estimate(start, goal);
    fScore.set(start.key, startF);
    open.add(start.key);

    let expanded = 0;

    while (open.size > 0) {
      if (
        snap0 !== undefined &&
        world.snapshotGeneration !== undefined &&
        world.snapshotGeneration !== snap0
      ) {
        telemetry.searchEnd({
          status: 'aborted',
          reason: 'snapshot_stale',
          expanded,
          cost: null,
          durationTicks: durationTicks(),
        });
        return fail(new Error('world_snapshot_stale'));
      }

      const currentKeyOp = AStar.pickOpenNode(open, fScore, gScore);
      if (currentKeyOp[0] !== null) return [currentKeyOp[0], null];
      const currentKey = currentKeyOp[1];
      if (currentKey === null) break;

      open.delete(currentKey);
      if (closed.has(currentKey)) continue;
      closed.add(currentKey);

      const currentNodeOp = Node.fromKey(currentKey);
      if (currentNodeOp[0] !== null) return [currentNodeOp[0], null];
      const currentNode = currentNodeOp[1];
      if (currentNode === null) return fail(new Error('astar_node'));

      const currentG = gScore.get(currentKey);
      if (currentG === undefined) return fail(new Error('astar_g'));

      expanded += 1;
      const currentF = fScore.get(currentKey);
      telemetry.nodeExpand({
        node: currentKey,
        g: currentG,
        f: currentF ?? Heuristic.estimate(currentNode, goal) + currentG,
      });

      if (currentNode.footEquals(goal)) {
        const pathOp = AStar.reconstruct(cameFrom, start.key, currentKey);
        if (pathOp[0] !== null) return [pathOp[0], null];
        const path = pathOp[1];
        if (path === null) return fail(new Error('astar_path'));
        telemetry.pathSelected({
          actions: path.map((a): Record<string, unknown> => a.toTelemetry()),
          totalCost: currentG,
        });
        telemetry.searchEnd({
          status: 'ok',
          expanded,
          cost: currentG,
          durationTicks: durationTicks(),
        });
        return ok({ path, nodesExpanded: expanded, cost: currentG });
      }

      const candidateHook = (
        name: 'candidate_generated' | 'candidate_rejected',
        data: Record<string, unknown>,
      ): void => {
        if (name === 'candidate_generated') {
          telemetry.candidateGenerated(data);
          return;
        }
        telemetry.candidateRejected(data);
      };

      const neighborsOp = NeighborGenerator.expand(
        world,
        currentNode,
        nextActionId,
        candidateHook,
        expandOpts,
      );
      if (neighborsOp[0] !== null) return [neighborsOp[0], null];
      const neighbors = neighborsOp[1];
      if (neighbors === null) return fail(new Error('astar_neighbors'));

      for (const n of neighbors) {
        AStar.relaxEdge(
          edgeMemory,
          cameFrom,
          fScore,
          gScore,
          open,
          closed,
          goal,
          gameTick,
          currentKey,
          currentG,
          n,
        );
      }
    }

    telemetry.searchEnd({
      status: 'fail',
      expanded,
      cost: null,
      durationTicks: durationTicks(),
    });
    return fail(new Error('no_path'));
  }

  private static pickOpenNode(
    open: Set<NodeKey>,
    fScore: Map<NodeKey, number>,
    gScore: Map<NodeKey, number>,
  ): Result<NodeKey | null> {
    if (open.size === 0) return ok(null);
    let bestKey: NodeKey | null = null;
    let bestF = Infinity;
    let bestG = Infinity;
    for (const k of open) {
      const f = fScore.get(k);
      if (f === undefined) return fail(new Error('open_missing_f'));
      const g = gScore.get(k);
      if (g === undefined) return fail(new Error('open_missing_g'));
      if (f > bestF) continue;
      if (f < bestF) {
        bestKey = k;
        bestF = f;
        bestG = g;
        continue;
      }
      if (g > bestG) continue;
      if (g < bestG) {
        bestKey = k;
        bestG = g;
        continue;
      }
      if (bestKey === null) {
        bestKey = k;
        continue;
      }
      if (compareNodeKey(k, bestKey) >= 0) continue;
      bestKey = k;
    }
    return ok(bestKey);
  }

  private static relaxEdge(
    edgeMemory: EdgeMemory,
    cameFrom: Map<NodeKey, CameFrom>,
    fScore: Map<NodeKey, number>,
    gScore: Map<NodeKey, number>,
    open: Set<NodeKey>,
    closed: Set<NodeKey>,
    goal: Node,
    gameTick: number,
    fromKey: NodeKey,
    fromG: number,
    neighbor: Neighbor,
  ): void {
    const nk = neighbor.to.key;
    if (closed.has(nk)) return;
    const step = edgeMemory.costWithMemory(
      fromKey,
      nk,
      neighbor.action.kind,
      neighbor.edgeCost,
      gameTick,
    );
    const tentativeG = fromG + step;
    const prevG = gScore.get(nk);
    if (prevG !== undefined) {
      if (tentativeG >= prevG) return;
    }
    cameFrom.set(nk, { parent: fromKey, via: neighbor.action });
    gScore.set(nk, tentativeG);
    const h = Heuristic.estimate(neighbor.to, goal);
    fScore.set(nk, tentativeG + h);
    open.add(nk);
  }

  private static reconstruct(
    cameFrom: Map<NodeKey, CameFrom>,
    startKey: NodeKey,
    goalKey: NodeKey,
  ): Result<NavigationAction[]> {
    const rev: NavigationAction[] = [];
    let cursor: NodeKey | null = goalKey;
    let guard = 0;
    while (cursor !== startKey) {
      guard += 1;
      if (guard > 10_000) return fail(new Error('astar_reconstruct_guard'));

      const step = cameFrom.get(cursor);
      if (step === undefined) return fail(new Error('astar_reconstruct_break'));

      rev.push(step.via);
      cursor = step.parent;
    }

    rev.reverse();
    return ok(rev);
  }
}
