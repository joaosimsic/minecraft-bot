import { describe, expect, test } from 'bun:test';
import { MiniMapFormatter } from '../src/ui/MiniMap';

describe('MiniMapFormatter', () => {
  test('empty yields no pos', () => {
    const s = MiniMapFormatter.render({
      cols: 4,
      rows: 3,
      homeX: null,
      homeZ: null,
      bots: [],
    });
    expect(s).toContain('no pos');
  });

  test('single online bot shows glyph', () => {
    const s = MiniMapFormatter.render({
      cols: 6,
      rows: 4,
      homeX: null,
      homeZ: null,
      bots: [
        {
          id: 'alice',
          mapX: 10,
          mapZ: 20,
          online: true,
          focused: false,
        },
      ],
    });
    expect(s.includes('A')).toBe(true);
  });

  test('home plus bot far apart shows plus and glyph', () => {
    const s = MiniMapFormatter.render({
      cols: 8,
      rows: 4,
      homeX: 0,
      homeZ: 0,
      bots: [
        {
          id: 'bob',
          mapX: 50,
          mapZ: 50,
          online: true,
          focused: false,
        },
      ],
    });
    expect(s.includes('+')).toBe(true);
    expect(s.includes('B')).toBe(true);
  });

  test('two bots same cell becomes star', () => {
    const s = MiniMapFormatter.render({
      cols: 3,
      rows: 3,
      homeX: null,
      homeZ: null,
      bots: [
        {
          id: 'a1',
          mapX: 1,
          mapZ: 1,
          online: true,
          focused: false,
        },
        {
          id: 'b2',
          mapX: 1,
          mapZ: 1,
          online: true,
          focused: false,
        },
      ],
    });
    expect(s.includes('*')).toBe(true);
  });
});
