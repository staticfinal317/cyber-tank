import type { AbilityId, ChassisId } from '../core/types';

export interface ChassisAbilityProfile {
  title: string;
  cooldownScale: Partial<Record<AbilityId, number>>;
  shieldDuration: number;
  teamShieldRadius: number;
  repairRatio: number;
  dashImpulse: number;
  dashDamage: number;
  stormDamage: number;
  stormRadius: number;
}

export const CHASSIS_ABILITIES: Record<ChassisId, ChassisAbilityProfile> = {
  spark: {
    title: '星链脉冲', cooldownScale: { storm: .88 }, shieldDuration: 5, teamShieldRadius: 0,
    repairRatio: .38, dashImpulse: 5.8, dashDamage: 0, stormDamage: 72, stormRadius: 5.1,
  },
  guardian: {
    title: '伙伴堡垒', cooldownScale: { shield: .82, repair: .9 }, shieldDuration: 7, teamShieldRadius: 5.2,
    repairRatio: .48, dashImpulse: 4.8, dashDamage: 0, stormDamage: 54, stormRadius: 6.4,
  },
  comet: {
    title: '彗星穿梭', cooldownScale: { dash: .72 }, shieldDuration: 4, teamShieldRadius: 0,
    repairRatio: .3, dashImpulse: 8.4, dashDamage: 38, stormDamage: 62, stormRadius: 4.4,
  },
};

export function abilityCooldown(chassis: ChassisId, ability: AbilityId, base: number): number {
  return base * (CHASSIS_ABILITIES[chassis].cooldownScale[ability] ?? 1);
}
