import { describe, expect, it } from 'vitest';
import { abilityCooldown, CHASSIS_ABILITIES } from '../src/gameplay/ChassisAbilities';
import { eventPool, WORLD_EVENTS } from '../src/gameplay/WorldEvents';

describe('chassis abilities and region events', () => {
  it('gives every chassis a distinct active ability identity', () => {
    expect(CHASSIS_ABILITIES.guardian.teamShieldRadius).toBeGreaterThan(0);
    expect(CHASSIS_ABILITIES.comet.dashDamage).toBeGreaterThan(0);
    expect(CHASSIS_ABILITIES.spark.stormDamage).toBeGreaterThan(CHASSIS_ABILITIES.guardian.stormDamage);
    expect(abilityCooldown('comet', 'dash', 10)).toBeLessThan(abilityCooldown('spark', 'dash', 10));
  });

  it('selects a signature event for each theme and season', () => {
    expect(eventPool({ theme: 'toy-factory' })).toContain('toy-march');
    expect(eventPool({ theme: 'neon-city', biome: 'mountain-sea-valley', season: 'winter' })).toContain('snow-squall');
    expect(WORLD_EVENTS['aurora-pulse'].message).toContain('护盾');
  });
});
