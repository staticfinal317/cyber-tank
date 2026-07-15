import { describe, expect, it } from 'vitest';
import { missionGraphProgress, MISSION_GRAPHS } from '../src/gameplay/MissionGraph';
import { SEASONS } from '../src/content/expedition';

describe('data driven mission graphs', () => {
  it('offers three missions for every season', () => {
    expect(Object.values(SEASONS).every((season) => season.missions.length === 3)).toBe(true);
    expect(Object.keys(MISSION_GRAPHS)).toHaveLength(12);
  });

  it('advances a two-stage family mission without bespoke simulation branches', () => {
    expect(missionGraphProgress('spring-garden', { repaired: 3, wave: 2, score: 0, bosses: 0 })).toMatchObject({ stage: 0, value: 3, complete: false });
    expect(missionGraphProgress('spring-garden', { repaired: 4, wave: 3, score: 0, bosses: 0 })).toMatchObject({ stage: 1, value: 3, target: 4, complete: false });
    expect(missionGraphProgress('spring-garden', { repaired: 4, wave: 4, score: 0, bosses: 0 }).complete).toBe(true);
  });

  it('supports region boss objectives', () => {
    expect(missionGraphProgress('winter-aurora', { repaired: 0, wave: 5, score: 1800, bosses: 0 }).label).toContain('冰原守护者');
    expect(missionGraphProgress('winter-aurora', { repaired: 0, wave: 5, score: 1800, bosses: 1 }).complete).toBe(true);
  });
});
