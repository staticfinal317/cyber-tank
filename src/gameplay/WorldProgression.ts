import type { CompanionId, EnemyKind, ExpeditionMissionId, RunSummary, SaveData, ThemeId } from '../core/types';

export interface CompanionDefinition { id: CompanionId; name: string; personality: string; perk: string; unlockLevel: number; color: number }

export const COMPANIONS: Record<CompanionId, CompanionDefinition> = {
  'little-core': { id: 'little-core', name: '小核', personality: '好奇的天气助手', perk: '提前提示强天气', unlockLevel: 1, color: 0x55e9ff },
  sprout: { id: 'sprout', name: '芽芽', personality: '热心的修复伙伴', perk: '任务结算多获得羁绊经验', unlockLevel: 2, color: 0x86ef78 },
  snowball: { id: 'snowball', name: '雪球', personality: '勇敢的冰原向导', perk: '区域霸主出现时提示弱点', unlockLevel: 4, color: 0xd7f8ff },
};

export const VALLEY_LEVEL_XP = [0, 100, 260, 520, 900, 1400, 2100, 3000];

export function valleyLevelForXp(xp: number): number {
  let level = 1;
  VALLEY_LEVEL_XP.forEach((threshold, index) => { if (xp >= threshold) level = index + 1; });
  return level;
}

export function applyWorldRun(
  world: SaveData['world'], summary: RunSummary, encountered: Iterable<EnemyKind>, completedMission?: ExpeditionMissionId,
): SaveData['world'] {
  const next: SaveData['world'] = {
    ...world,
    restoredLandmarks: [...world.restoredLandmarks], encyclopedia: [...world.encyclopedia],
    unlockedCompanions: [...world.unlockedCompanions], companionBond: { ...world.companionBond }, themeMastery: { ...world.themeMastery },
  };
  next.valleyXp += Math.max(5, summary.repaired * 3 + summary.wave * 5 + (summary.missionComplete ? 35 : 0));
  next.valleyLevel = valleyLevelForXp(next.valleyXp);
  if (completedMission && !next.restoredLandmarks.includes(completedMission)) next.restoredLandmarks.push(completedMission);
  for (const kind of encountered) if (!next.encyclopedia.includes(kind)) next.encyclopedia.push(kind);
  (Object.values(COMPANIONS) as CompanionDefinition[]).forEach((companion) => { if (next.valleyLevel >= companion.unlockLevel && !next.unlockedCompanions.includes(companion.id)) next.unlockedCompanions.push(companion.id); });
  const bondGain = Math.max(1, Math.round(summary.duration / 30) + (summary.missionComplete ? 3 : 0));
  next.companionBond[next.activeCompanion] = (next.companionBond[next.activeCompanion] ?? 0)
    + Math.round(bondGain * (next.activeCompanion === 'sprout' ? 1.5 : 1));
  const theme = summary.theme as ThemeId; next.themeMastery[theme] = (next.themeMastery[theme] ?? 0) + summary.repaired;
  return next;
}
