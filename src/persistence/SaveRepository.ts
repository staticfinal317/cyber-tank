import type { ReplayData, RunSummary, SaveData } from '../core/types';

export interface SaveRepository {
  load(): Promise<SaveData>;
  save(data: SaveData): Promise<void>;
  addRun(summary: RunSummary, replay?: ReplayData): Promise<SaveData>;
}

export function createDefaultSave(): SaveData {
  return {
    version: 2,
    highScore: 0,
    starShards: 0,
    totalRepaired: 0,
    unlockedWeapons: ['pulse'],
    unlockedChassis: ['spark'],
    techRanks: {},
    achievements: [],
    leaderboard: [],
    replays: [],
    settings: { music: true, sfx: true, quality: 'auto', leftHanded: false },
  };
}
