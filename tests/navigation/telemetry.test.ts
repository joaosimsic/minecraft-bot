import { describe, expect, test } from 'bun:test';
import { Node } from '../../src/navigation/planner/Node';
import { WalkAction } from '../../src/navigation/movement/Actions';
import { ValidationError } from '../../src/navigation/movement/Validator';
import { EdgeMemory } from '../../src/navigation/recovery/EdgeMemory';
import { Recovery } from '../../src/navigation/recovery/Recovery';
import { NAV_EVENT } from '../../src/navigation/telemetry/Events';
import { CaptureRecorder } from './helpers';

describe('Telemetry observed', () => {
  test('movement_fail emits validator observed payloads', () => {
    const rec = new CaptureRecorder('telemetry');
    const mem = new EdgeMemory();
    const r = new Recovery(14, 6, mem, rec);
    void r.recordVerifiedFailure(
      '0,0,0',
      '1,0,0',
      'walk',
      0,
      'post_foot_mismatch',
      'post_action',
      new WalkAction(
        'a',
        new Node(0, 65, 0).key,

        new Node(1, 65, 0).key,

        1,
        0,
      ),
      new ValidationError('post_foot_mismatch', {
        expected: { x: 1, y: 65, z: 0 },
        got: { x: 0, y: 65, z: 0 },
      }).observed,
    );

    const hit = rec.frames.find(
      (f): boolean => f.type === NAV_EVENT.MOVEMENT_FAIL,
    );
    expect(hit?.data?.observed).toEqual({
      expected: { x: 1, y: 65, z: 0 },
      got: { x: 0, y: 65, z: 0 },
    });
  });
});
