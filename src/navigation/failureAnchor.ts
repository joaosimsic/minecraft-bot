import type { NavigationAction } from './movement/Actions';
import { parseNodeKey } from './planner/Node';

export function failureAnchorFootBlock(
  action: NavigationAction,
): { x: number; y: number; z: number } | null {
  const k = action.kind;
  if (k === 'interact') {
    return {
      x: action.targetX,
      y: action.targetY,
      z: action.targetZ,
    };
  }
  const op = parseNodeKey(action.to);
  if (op[0] !== null) return null;
  const n = op[1];
  if (n === null) return null;
  return { x: n.x, y: n.y, z: n.z };
}
