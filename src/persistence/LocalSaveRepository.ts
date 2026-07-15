import type { ReplayData, RunSummary, SaveData } from '../core/types';
import { createDefaultSave, type SaveRepository } from './SaveRepository';
import { cloneLoadout, DEFAULT_LOADOUT } from '../content/expedition';

const KEY = 'cyber-tank.save.v3';
const BACKUP_KEY = 'cyber-tank.save.v3.backup';
const LEGACY_KEY = 'cyber-tank.save.v2';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SaveStatus {
  mode: 'persistent' | 'recovered' | 'memory';
  message?: string;
}

function finite(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function normalizeSave(input: Partial<SaveData> | null): SaveData {
  const defaults = createDefaultSave();
  if (!input || typeof input !== 'object') return defaults;
  const presets = Array.isArray(input.loadoutPresets) && input.loadoutPresets.length
    ? input.loadoutPresets.slice(0, 3).map((preset, index) => ({
      id: typeof preset?.id === 'string' ? preset.id : `preset-${index + 1}`,
      name: typeof preset?.name === 'string' ? preset.name.slice(0, 16) : `远征方案 ${index + 1}`,
      loadout: { ...cloneLoadout(DEFAULT_LOADOUT), ...(preset?.loadout ?? {}), ammoSlots: Array.isArray(preset?.loadout?.ammoSlots) && preset.loadout.ammoSlots.length === 2 ? [...preset.loadout.ammoSlots] : [...DEFAULT_LOADOUT.ammoSlots] },
      updatedAt: typeof preset?.updatedAt === 'string' ? preset.updatedAt : new Date(0).toISOString(),
    })) as SaveData['loadoutPresets']
    : defaults.loadoutPresets;
  const settings = { ...defaults.settings, ...(input.settings ?? {}) };
  const inputWorld = input.world ?? defaults.world;
  const world: SaveData['world'] = {
    ...defaults.world, ...inputWorld,
    valleyXp: finite(inputWorld.valleyXp, 0), valleyLevel: finite(inputWorld.valleyLevel, 1, 1, 99),
    restoredLandmarks: Array.isArray(inputWorld.restoredLandmarks) ? inputWorld.restoredLandmarks : [],
    encyclopedia: Array.isArray(inputWorld.encyclopedia) ? inputWorld.encyclopedia : [],
    unlockedCompanions: Array.isArray(inputWorld.unlockedCompanions) && inputWorld.unlockedCompanions.length ? inputWorld.unlockedCompanions : ['little-core'],
    companionBond: { ...defaults.world.companionBond, ...(inputWorld.companionBond ?? {}) },
    themeMastery: inputWorld.themeMastery && typeof inputWorld.themeMastery === 'object' ? inputWorld.themeMastery : {},
  };
  if (!world.unlockedCompanions.includes(world.activeCompanion)) world.activeCompanion = 'little-core';
  settings.masterVolume = finite(settings.masterVolume, defaults.settings.masterVolume, 0, 1);
  settings.aimSensitivity = finite(settings.aimSensitivity, defaults.settings.aimSensitivity, .55, 1.75);
  if (!['default', 'deuteranopia', 'high-contrast'].includes(settings.colorMode)) settings.colorMode = 'default';
  if (!['standard', 'southpaw'].includes(settings.gamepadLayout)) settings.gamepadLayout = 'standard';
  return {
    ...defaults,
    ...input,
    version: 3,
    highScore: finite(input.highScore, 0), starShards: finite(input.starShards, 0), totalRepaired: finite(input.totalRepaired, 0),
    unlockedMovementModules: Array.isArray(input.unlockedMovementModules) ? input.unlockedMovementModules : defaults.unlockedMovementModules,
    unlockedAmmo: Array.isArray(input.unlockedAmmo) ? input.unlockedAmmo : defaults.unlockedAmmo,
    unlockedTools: Array.isArray(input.unlockedTools) ? input.unlockedTools : defaults.unlockedTools,
    unlockedPaints: Array.isArray(input.unlockedPaints) ? input.unlockedPaints : defaults.unlockedPaints,
    loadoutPresets: presets,
    activePresetId: presets.some((preset) => preset.id === input.activePresetId) ? input.activePresetId! : presets[0]!.id,
    discoveredRoutes: Array.isArray(input.discoveredRoutes) ? input.discoveredRoutes : defaults.discoveredRoutes,
    completedMissions: Array.isArray(input.completedMissions) ? input.completedMissions : defaults.completedMissions,
    seasonBestScores: input.seasonBestScores && typeof input.seasonBestScores === 'object' ? input.seasonBestScores : defaults.seasonBestScores,
    world,
    settings,
    leaderboard: Array.isArray(input.leaderboard) ? input.leaderboard.slice(0, 20) : [],
    replays: Array.isArray(input.replays) ? input.replays.slice(0, 5) : [],
  };
}

/** Removes only reproducible history when browser storage is nearly full. */
export function compactSave(input: SaveData): SaveData {
  const data = normalizeSave(input);
  return { ...data, leaderboard: data.leaderboard.slice(0, 8), replays: [] };
}

export class LocalSaveRepository implements SaveRepository {
  private memory?: SaveData;
  private status: SaveStatus = { mode: 'persistent' };

  constructor(private readonly storage: StorageLike = localStorage) {}

  getStatus(): SaveStatus { return { ...this.status }; }

  async load(): Promise<SaveData> {
    if (this.memory) return normalizeSave(this.memory);
    let current: string | null = null; let backup: string | null = null; let legacy: string | null = null;
    try {
      current = this.storage.getItem(KEY); backup = this.storage.getItem(BACKUP_KEY); legacy = this.storage.getItem(LEGACY_KEY);
    } catch {
      this.status = { mode: 'memory', message: '浏览器存储不可用，本次进度将在关闭页面后清除。' };
      return createDefaultSave();
    }
    const candidates = [{ raw: current, source: 'current' }, { raw: backup, source: 'backup' }, { raw: legacy, source: 'legacy' }] as const;
    for (const candidate of candidates) {
      if (!candidate.raw) continue;
      try {
        const normalized = normalizeSave(JSON.parse(candidate.raw) as Partial<SaveData>);
        if (candidate.source !== 'current') {
          this.status = { mode: 'recovered', message: candidate.source === 'backup' ? '检测到存档异常，已从安全备份恢复。' : '旧版进度已安全升级。' };
          try { this.storage.setItem(KEY, JSON.stringify(normalized)); } catch { this.memory = normalized; this.status.mode = 'memory'; }
        }
        return normalized;
      } catch { /* Try the next recovery candidate. */ }
    }
    if (current || backup || legacy) this.status = { mode: 'recovered', message: '损坏的存档无法读取，已创建新的安全存档。' };
    return createDefaultSave();
  }

  async save(data: SaveData): Promise<void> {
    const normalized = normalizeSave(data);
    try {
      const previous = this.storage.getItem(KEY);
      if (previous) this.storage.setItem(BACKUP_KEY, previous);
      this.storage.setItem(KEY, JSON.stringify(normalized));
      this.memory = undefined; this.status = { mode: 'persistent' };
      return;
    } catch { /* Retry after removing large, reproducible replay history. */ }
    const compact = compactSave(normalized);
    try {
      this.storage.setItem(KEY, JSON.stringify(compact));
      this.status = { mode: 'recovered', message: '存储空间不足，已保留成长进度并清理旧回放。' };
    } catch {
      this.memory = compact;
      this.status = { mode: 'memory', message: '无法写入浏览器存储，已切换到本次会话安全模式。' };
    }
  }

  async addRun(summary: RunSummary, replay?: ReplayData): Promise<SaveData> {
    const data = await this.load();
    data.highScore = Math.max(data.highScore, summary.score);
    data.starShards += summary.stars;
    data.totalRepaired += summary.repaired;
    data.leaderboard = [...data.leaderboard, summary].sort((a, b) => b.score - a.score || b.wave - a.wave).slice(0, 20);
    if (replay) data.replays = [replay, ...data.replays].slice(0, 5);
    await this.save(data);
    return this.memory ? normalizeSave(this.memory) : data;
  }
}
