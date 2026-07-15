import { describe, expect, it } from 'vitest';
import { RNG, seedFromDate } from '../src/core/RNG';

describe('RNG', () => {
  it('repeats a seeded sequence', () => {
    const first = new RNG(317);
    const second = new RNG(317);
    expect([first.next(), first.next(), first.next()]).toEqual([second.next(), second.next(), second.next()]);
  });

  it('generates a stable daily seed', () => {
    expect(seedFromDate(new Date('2026-07-15T00:00:00Z'))).toBe(seedFromDate(new Date('2026-07-15T23:59:00Z')));
  });
});
