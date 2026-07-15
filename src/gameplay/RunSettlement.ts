import type { EnemyKind, ExpeditionMissionId, ReplayData, RouteId, RunSummary, SaveData } from '../core/types';
import { rebaseReplayFrames } from '../core/Replay';
import { EXPEDITION_MISSIONS } from '../content/expedition';
import { applyWorldRun } from './WorldProgression';

export interface RunSettlementInput {
  summary: RunSummary;
  replay: ReplayData;
  route?: RouteId;
  encounteredEnemies: Iterable<EnemyKind>;
  coop: boolean;
}

export interface RunSettlementResult {
  save: SaveData;
  unlockedAchievements: string[];
}

/** Builds the complete post-run state before the repository performs one durable save. */
export function settleRun(current: SaveData, input: RunSettlementInput): RunSettlementResult {
  const { summary } = input;
  const missionId = summary.missionId;
  const completedMission = missionId && summary.missionComplete ? missionId : undefined;
  const firstMissionCompletion = Boolean(completedMission && !current.completedMissions.includes(completedMission));
  const totalRepaired = current.totalRepaired + summary.repaired;
  const achievementCandidates = [
    ...(summary.repaired >= 1 ? ['first-repair'] : []),
    ...(totalRepaired >= 50 ? ['helper-50'] : []),
    ...(summary.wave >= 5 ? ['wave-5'] : []),
    ...(summary.wave >= 10 ? ['wave-10'] : []),
    ...(input.coop ? ['coop'] : []),
  ];
  const unlockedAchievements = [...new Set(achievementCandidates)].filter((id) => !current.achievements.includes(id));
  const replay: ReplayData = { ...input.replay, frames: rebaseReplayFrames(input.replay.frames) };
  const previousDaily = summary.dailyKey ? current.dailyChallenges[summary.dailyKey] : undefined;
  const dailyRewardEarned = Boolean(summary.dailyKey && summary.dailyComplete && !previousDaily?.rewardClaimed);
  const dailyChallenges: SaveData['dailyChallenges'] = { ...current.dailyChallenges };
  if (summary.dailyKey) {
    dailyChallenges[summary.dailyKey] = {
      bestScore: Math.max(previousDaily?.bestScore ?? 0, summary.score),
      completedAt: summary.dailyComplete ? previousDaily?.completedAt ?? summary.date : previousDaily?.completedAt,
      rewardClaimed: previousDaily?.rewardClaimed || dailyRewardEarned,
    };
  }

  const save: SaveData = {
    ...current,
    highScore: Math.max(current.highScore, summary.score),
    starShards: current.starShards + summary.stars
      + (firstMissionCompletion ? EXPEDITION_MISSIONS[completedMission!].reward : 0)
      + (dailyRewardEarned ? summary.dailyReward ?? 0 : 0)
      + unlockedAchievements.length * 20,
    totalRepaired,
    leaderboard: [...current.leaderboard, summary]
      .sort((a, b) => b.score - a.score || b.wave - a.wave).slice(0, 20),
    replays: [replay, ...current.replays].slice(0, 5),
    discoveredRoutes: input.route && !current.discoveredRoutes.includes(input.route)
      ? [...current.discoveredRoutes, input.route] : [...current.discoveredRoutes],
    completedMissions: firstMissionCompletion
      ? [...current.completedMissions, completedMission!] : [...current.completedMissions],
    seasonBestScores: { ...current.seasonBestScores },
    achievements: [...current.achievements, ...unlockedAchievements],
    dailyChallenges,
    world: applyWorldRun(current.world, summary, input.encounteredEnemies, completedMission),
  };
  if (summary.season) save.seasonBestScores[summary.season] = Math.max(save.seasonBestScores[summary.season] ?? 0, summary.score);
  return { save, unlockedAchievements };
}
