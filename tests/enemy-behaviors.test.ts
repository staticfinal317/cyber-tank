import { describe, expect, it } from 'vitest';
import { ENEMY_BEHAVIORS, behaviorSpeedScale, behaviorSteering, incomingDamageScale, isEnemyCloaked } from '../src/gameplay/EnemyBehaviors';
import { availableEnemyKinds, ENEMIES } from '../src/content/enemies';

describe('composable enemy behavior profiles', () => {
  it('unlocks eleven non-boss enemy families as waves grow', () => {
    expect(availableEnemyKinds(1)).toEqual(['scout']);
    expect(availableEnemyKinds(12)).toHaveLength(11);
    expect(ENEMIES.summoner.role).toBe('support');
  });

  it('kites at close range and orbits inside its preferred band', () => {
    const away = behaviorSteering(ENEMY_BEHAVIORS.sniper, { x: 0, z: 1 }, 3, 0);
    expect(away.z).toBeLessThan(0);
    const orbit = behaviorSteering(ENEMY_BEHAVIORS.warden, { x: 0, z: 1 }, 7, 1);
    expect(Math.abs(orbit.x)).toBeGreaterThan(.2);
  });

  it('exposes deterministic charge, cloak and reflect windows', () => {
    expect(behaviorSpeedScale(ENEMY_BEHAVIORS.charger, .3)).toBeGreaterThan(1);
    expect(isEnemyCloaked(ENEMY_BEHAVIORS.stalker, 2)).toBe(true);
    expect(incomingDamageScale(ENEMY_BEHAVIORS.reflector, 1)).toBeLessThan(1);
  });
});
