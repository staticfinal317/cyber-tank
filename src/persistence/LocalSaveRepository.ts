import type { ReplayData, RunSummary, SaveData } from '../core/types';
import { createDefaultSave, type SaveRepository } from './SaveRepository';
import { cloneLoadout, DEFAULT_LOADOUT } from '../content/expedition';

const KEY = 'cyber-tank.save.v3';
const LEGACY_KEY = 'cyber-tank.save.v2';

export function normalizeSave(input: Partial<SaveData> | null): SaveData {
  const defaults = createDefaultSave();
  if (!input) return defaults;
  const presets = Array.isArray(input.loadoutPresets) && input.loadoutPresets.length
    ? input.loadoutPresets.slice(0, 3).map((preset, index) => ({
      id: typeof preset?.id === 'string' ? preset.id : `preset-${index + 1}`,
      name: typeof preset?.name === 'string' ? preset.name.slice(0, 16) : `远征方案 ${index + 1}`,
      loadout: { ...cloneLoadout(DEFAULT_LOADOUT), ...(preset?.loadout ?? {}), ammoSlots: Array.isArray(preset?.loadout?.ammoSlots) && preset.loadout.ammoSlots.length === 2 ? [...preset.loadout.ammoSlots] : [...DEFAULT_LOADOUT.ammoSlots] },
      updatedAt: typeof preset?.updatedAt === 'string' ? preset.updatedAt : new Date(0).toISOString(),
    })) as SaveData['loadoutPresets']
    : defaults.loadoutPresets;
  return {
    ...defaults,
    ...input,
    version: 3,
    unlockedMovementModules: Array.isArray(input.unlockedMovementModules) ? input.unlockedMovementModules : defaults.unlockedMovementModules,
    unlockedAmmo: Array.isArray(input.unlockedAmmo) ? input.unlockedAmmo : defaults.unlockedAmmo,
    unlockedTools: Array.isArray(input.unlockedTools) ? input.unlockedTools : defaults.unlockedTools,
    unlockedPaints: Array.isArray(input.unlockedPaints) ? input.unlockedPaints : defaults.unlockedPaints,
    loadoutPresets: presets,
    activePresetId: presets.some((preset) => preset.id === input.activePresetId) ? input.activePresetId! : presets[0]!.id,
    settings: { ...defaults.settings, ...input.settings },
    leaderboard: Array.isArray(input.leaderboard) ? input.leaderboard.slice(0, 20) : [],
    replays: Array.isArray(input.replays) ? input.replays.slice(0, 5) : [],
  };
}

export class LocalSaveRepository implements SaveRepository {
  async load(): Promise<SaveData> {
    try {
      const current = localStorage.getItem(KEY);
      const legacy = current ?? localStorage.getItem(LEGACY_KEY);
      const normalized = normalizeSave(JSON.parse(legacy ?? 'null') as Partial<SaveData> | null);
      if (!current && legacy) localStorage.setItem(KEY, JSON.stringify(normalized));
      return normalized;
    } catch {
      return createDefaultSave();
    }
  }

  async save(data: SaveData): Promise<void> {
    localStorage.setItem(KEY, JSON.stringify(normalizeSave(data)));
  }

  async addRun(summary: RunSummary, replay?: ReplayData): Promise<SaveData> {
    const data = await this.load();
    data.highScore = Math.max(data.highScore, summary.score);
    data.starShards += summary.stars;
    data.totalRepaired += summary.repaired;
    data.leaderboard = [...data.leaderboard, summary]
      .sort((a, b) => b.score - a.score || b.wave - a.wave)
      .slice(0, 20);
    if (replay) data.replays = [replay, ...data.replays].slice(0, 5);
    await this.save(data);
    return data;
  }
}
