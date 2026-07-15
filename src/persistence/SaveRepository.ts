import type { ReplayData, RunSummary, SaveData } from '../core/types';
import { cloneLoadout, DEFAULT_LOADOUT } from '../content/expedition';

export interface SaveRepository {
  load(): Promise<SaveData>;
  save(data: SaveData): Promise<void>;
  addRun(summary: RunSummary, replay?: ReplayData): Promise<SaveData>;
}

export function createDefaultSave(): SaveData {
  const now = new Date(0).toISOString();
  return {
    version: 3,
    highScore: 0,
    starShards: 0,
    totalRepaired: 0,
    unlockedWeapons: ['pulse'],
    unlockedChassis: ['spark'],
    unlockedMovementModules: ['road-wheel', 'all-terrain', 'amphibious'],
    unlockedAmmo: ['star-pulse', 'repair-seed'],
    unlockedTools: ['repair-arm'],
    unlockedPaints: ['sunrise-yellow', 'sky-cyan'],
    loadoutPresets: [
      { id: 'preset-1', name: '我的远征车', loadout: cloneLoadout(DEFAULT_LOADOUT), updatedAt: now },
      { id: 'preset-2', name: '备用方案', loadout: cloneLoadout(DEFAULT_LOADOUT), updatedAt: now },
      { id: 'preset-3', name: '家庭伙伴', loadout: cloneLoadout(DEFAULT_LOADOUT), updatedAt: now },
    ],
    activePresetId: 'preset-1',
    techRanks: {},
    achievements: [],
    leaderboard: [],
    replays: [],
    settings: { music: true, sfx: true, quality: 'auto', leftHanded: false },
  };
}
