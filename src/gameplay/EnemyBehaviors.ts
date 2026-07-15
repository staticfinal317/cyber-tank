import type { EnemyKind, Vec2 } from '../core/types';

export type EnemyBehaviorTag = 'seek' | 'kite' | 'orbit' | 'charge' | 'heal' | 'cloak' | 'summon' | 'reflect' | 'suppress';

export interface EnemyBehaviorProfile {
  tags: readonly EnemyBehaviorTag[];
  preferredRange?: number;
  orbitStrength?: number;
  chargePulse?: number;
  healRadius?: number;
  healPerSecond?: number;
  summonEvery?: number;
  summonKind?: EnemyKind;
  reflectedDamageScale?: number;
}

export const ENEMY_BEHAVIORS: Record<EnemyKind, EnemyBehaviorProfile> = {
  scout: { tags: ['seek', 'orbit'], preferredRange: 3.5, orbitStrength: .28 },
  charger: { tags: ['seek', 'charge'], chargePulse: 1.7 },
  gunner: { tags: ['kite', 'orbit'], preferredRange: 6, orbitStrength: .5 },
  bulwark: { tags: ['seek'] },
  splitter: { tags: ['seek', 'orbit'], preferredRange: 4.5, orbitStrength: .4 },
  medic: { tags: ['kite', 'heal'], preferredRange: 6, healRadius: 4.5, healPerSecond: 9 },
  sniper: { tags: ['kite'], preferredRange: 9 },
  stalker: { tags: ['seek', 'orbit', 'cloak'], preferredRange: 3.2, orbitStrength: .8 },
  summoner: { tags: ['kite', 'summon'], preferredRange: 8, summonEvery: 6.5, summonKind: 'charger' },
  reflector: { tags: ['seek', 'reflect'], reflectedDamageScale: .3 },
  warden: { tags: ['kite', 'orbit', 'suppress'], preferredRange: 7, orbitStrength: .7 },
  boss: { tags: ['seek', 'orbit', 'summon', 'suppress'], preferredRange: 5.5, orbitStrength: .32, summonEvery: 7.5, summonKind: 'scout' },
};

export function behaviorSteering(profile: EnemyBehaviorProfile, toward: Vec2, targetDistance: number, phase: number): Vec2 {
  let x = toward.x; let z = toward.z;
  const preferred = profile.preferredRange ?? 0;
  if (profile.tags.includes('kite') && preferred > 0) {
    if (targetDistance < preferred - 1) { x = -toward.x; z = -toward.z; }
    else if (targetDistance < preferred + 1) { x = 0; z = 0; }
  }
  if (profile.tags.includes('orbit')) {
    const orbit = (profile.orbitStrength ?? .35) * (Math.sin(phase * .65) >= 0 ? 1 : -1);
    x += -toward.z * orbit; z += toward.x * orbit;
  }
  const length = Math.hypot(x, z);
  return length > .001 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

export function behaviorSpeedScale(profile: EnemyBehaviorProfile, phase: number): number {
  return profile.tags.includes('charge') && Math.sin(phase * 3) > .5 ? (profile.chargePulse ?? 1.6) : 1;
}

export function isEnemyCloaked(profile: EnemyBehaviorProfile, phase: number): boolean {
  return profile.tags.includes('cloak') && Math.sin(phase * .9) > .35;
}

export function incomingDamageScale(profile: EnemyBehaviorProfile, phase: number): number {
  return profile.tags.includes('reflect') && Math.sin(phase * 1.35) > .15 ? (profile.reflectedDamageScale ?? .35) : 1;
}
