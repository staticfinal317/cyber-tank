import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../src/gameplay/SpatialHash';

describe('SpatialHash', () => {
  const items = [
    { id: 1, pos: { x: 0, z: 0 }, tag: 'center' },
    { id: 2, pos: { x: 2.8, z: 0 }, tag: 'near' },
    { id: 3, pos: { x: 9, z: 9 }, tag: 'far' },
  ];

  it('returns only entities inside a circular query', () => {
    const hash = new SpatialHash<(typeof items)[number]>(3.2);
    hash.rebuild(items);
    expect(hash.query({ x: 0, z: 0 }, 3).map((item) => item.id).sort()).toEqual([1, 2]);
  });

  it('finds the closest matching entity across cell boundaries', () => {
    const hash = new SpatialHash<(typeof items)[number]>(2);
    hash.rebuild(items);
    expect(hash.nearest({ x: 2.4, z: 0 }, 12)?.tag).toBe('near');
    expect(hash.nearest({ x: 0, z: 0 }, 13, (item) => item.id === 3)?.tag).toBe('far');
  });
});
