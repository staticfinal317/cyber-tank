import type {
  AmmoId, ChassisId, CompanionId, EnemyKind, ExpeditionMissionId, GameMode, GameOptions,
  MovementModuleId, PaintId, ReplayData, ReplayFrame, RouteId, RunSummary, SaveData,
  SeasonId, TankLoadout, ThemeId, ToolId, WeaponId,
} from '../core/types';
import { createDefaultSave, type SaveRepository } from './SaveRepository';
import { AMMO, cloneLoadout, DEFAULT_LOADOUT, EXPEDITION_MISSIONS, MOVEMENT_MODULES, PAINTS, TOOLS } from '../content/expedition';
import { WEAPONS, TECH_TREE } from '../content/weapons';
import { CHASSIS } from '../content/chassis';
import { THEMES } from '../content/themes';
import { ENEMIES } from '../content/enemies';
import { ACHIEVEMENTS } from '../content/achievements';
import { COMPANIONS, valleyLevelForXp } from '../gameplay/WorldProgression';
import { rebaseReplayFrames } from '../core/Replay';

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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeText(value: unknown, fallback: string, max = 48): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[<>&\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return cleaned || fallback;
}

function safeDate(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return new Date(0).toISOString();
  return new Date(value).toISOString();
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function enumList<T extends string>(value: unknown, values: readonly T[], fallback: readonly T[]): T[] {
  if (!Array.isArray(value)) return [...fallback];
  const filtered = [...new Set(value.filter((item): item is T => isOneOf(item, values)))];
  return filtered.length ? filtered : [...fallback];
}

const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
const CHASSIS_IDS = Object.keys(CHASSIS) as ChassisId[];
const MOVEMENT_IDS = Object.keys(MOVEMENT_MODULES) as MovementModuleId[];
const AMMO_IDS = Object.keys(AMMO) as AmmoId[];
const TOOL_IDS = Object.keys(TOOLS) as ToolId[];
const PAINT_IDS = Object.keys(PAINTS) as PaintId[];
const THEME_IDS = Object.keys(THEMES) as ThemeId[];
const ENEMY_IDS = Object.keys(ENEMIES) as EnemyKind[];
const MISSION_IDS = Object.keys(EXPEDITION_MISSIONS) as ExpeditionMissionId[];
const COMPANION_IDS = Object.keys(COMPANIONS) as CompanionId[];
const ROUTE_IDS: RouteId[] = ['ridge-route', 'river-route'];
const SEASON_IDS: SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];
const MODE_IDS: GameMode[] = ['adventure', 'endless', 'last-core', 'daily'];

function normalizeLoadout(value: unknown): TankLoadout {
  const raw = record(value);
  const defaults = cloneLoadout(DEFAULT_LOADOUT);
  const slots = Array.isArray(raw.ammoSlots) ? raw.ammoSlots : [];
  return {
    chassis: isOneOf(raw.chassis, CHASSIS_IDS) ? raw.chassis : defaults.chassis,
    movement: isOneOf(raw.movement, MOVEMENT_IDS) ? raw.movement : defaults.movement,
    ammoSlots: [
      isOneOf(slots[0], AMMO_IDS) ? slots[0] : defaults.ammoSlots[0],
      isOneOf(slots[1], AMMO_IDS) ? slots[1] : defaults.ammoSlots[1],
    ],
    activeAmmoIndex: raw.activeAmmoIndex === 1 ? 1 : 0,
    tool: isOneOf(raw.tool, TOOL_IDS) ? raw.tool : defaults.tool,
    paint: isOneOf(raw.paint, PAINT_IDS) ? raw.paint : defaults.paint,
    decal: safeText(raw.decal, defaults.decal, 32),
    light: isOneOf(raw.light, ['cyan', 'gold', 'lime', 'violet'] as const) ? raw.light : defaults.light,
    trail: isOneOf(raw.trail, ['spark', 'rainbow', 'leaves', 'snow'] as const) ? raw.trail : defaults.trail,
  };
}

function normalizeSummary(value: unknown, index: number): RunSummary | undefined {
  const raw = record(value); if (!Object.keys(raw).length) return undefined;
  return {
    id: safeText(raw.id, `recovered-run-${index}`, 64), date: safeDate(raw.date),
    score: finite(raw.score, 0), wave: Math.floor(finite(raw.wave, 0, 0, 9999)),
    mode: isOneOf(raw.mode, MODE_IDS) ? raw.mode : 'adventure',
    theme: isOneOf(raw.theme, THEME_IDS) ? raw.theme : 'neon-city',
    duration: finite(raw.duration, 0, 0, 86400), repaired: Math.floor(finite(raw.repaired, 0, 0, 1_000_000)),
    stars: Math.floor(finite(raw.stars, 0, 0, 1_000_000)), title: safeText(raw.title, '勇敢探索家', 32),
    season: isOneOf(raw.season, SEASON_IDS) ? raw.season : undefined,
    missionId: isOneOf(raw.missionId, MISSION_IDS) ? raw.missionId : undefined,
    missionComplete: typeof raw.missionComplete === 'boolean' ? raw.missionComplete : undefined,
    dailyKey: typeof raw.dailyKey === 'string' ? safeText(raw.dailyKey, '', 16) || undefined : undefined,
    dailyComplete: typeof raw.dailyComplete === 'boolean' ? raw.dailyComplete : undefined,
    dailyReward: raw.dailyReward === undefined ? undefined : Math.floor(finite(raw.dailyReward, 0, 0, 10_000)),
  };
}

function normalizeOptions(value: unknown): GameOptions {
  const raw = record(value);
  return {
    mode: isOneOf(raw.mode, MODE_IDS) ? raw.mode : 'adventure',
    theme: isOneOf(raw.theme, THEME_IDS) ? raw.theme : 'neon-city',
    assist: isOneOf(raw.assist, ['easy', 'standard', 'expert'] as const) ? raw.assist : 'standard',
    coop: raw.coop === true,
    crewMode: raw.crewMode === true,
    crewRoleP2: isOneOf(raw.crewRoleP2, ['navigator', 'engineer', 'wingman'] as const) ? raw.crewRoleP2 : undefined,
    companion: isOneOf(raw.companion, COMPANION_IDS) ? raw.companion : 'little-core',
    weapon: isOneOf(raw.weapon, WEAPON_IDS) ? raw.weapon : 'pulse',
    chassis: isOneOf(raw.chassis, CHASSIS_IDS) ? raw.chassis : 'spark',
    loadout: raw.loadout && typeof raw.loadout === 'object' ? normalizeLoadout(raw.loadout) : undefined,
    biome: raw.biome === 'mountain-sea-valley' ? raw.biome : undefined,
    season: isOneOf(raw.season, SEASON_IDS) ? raw.season : undefined,
    route: isOneOf(raw.route, ROUTE_IDS) ? raw.route : undefined,
    missionId: isOneOf(raw.missionId, MISSION_IDS) ? raw.missionId : undefined,
    testDrive: raw.testDrive === true,
    seed: typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? raw.seed >>> 0 : undefined,
    dailyKey: typeof raw.dailyKey === 'string' ? safeText(raw.dailyKey, '', 16) || undefined : undefined,
  };
}

function normalizeReplay(value: unknown, index: number): ReplayData | undefined {
  const raw = record(value); const summary = normalizeSummary(raw.summary, index);
  if (!summary || !Array.isArray(raw.frames)) return undefined;
  const frames = raw.frames.slice(-3600).map((item): ReplayFrame | undefined => {
    const frame = record(item);
    if (![frame.t, frame.p1x, frame.p1z, frame.p1r].every((part) => typeof part === 'number' && Number.isFinite(part))) return undefined;
    return {
      t: finite(frame.t, 0, 0, 86400), p1x: finite(frame.p1x, 0, -100, 100), p1z: finite(frame.p1z, 0, -100, 100),
      p1r: finite(frame.p1r, 0, -Math.PI * 4, Math.PI * 4),
      p2x: typeof frame.p2x === 'number' && Number.isFinite(frame.p2x) ? finite(frame.p2x, 0, -100, 100) : undefined,
      p2z: typeof frame.p2z === 'number' && Number.isFinite(frame.p2z) ? finite(frame.p2z, 0, -100, 100) : undefined,
    };
  }).filter((frame): frame is ReplayFrame => Boolean(frame));
  if (!frames.length) return undefined;
  return { id: safeText(raw.id, `recovered-replay-${index}`, 64), createdAt: safeDate(raw.createdAt), options: normalizeOptions(raw.options), summary, frames: rebaseReplayFrames(frames) };
}

export function normalizeSave(input: Partial<SaveData> | null): SaveData {
  const defaults = createDefaultSave();
  if (!input || typeof input !== 'object') return defaults;
  const presets = Array.isArray(input.loadoutPresets) && input.loadoutPresets.length
    ? input.loadoutPresets.slice(0, 3).map((preset, index) => ({
      id: safeText(preset?.id, `preset-${index + 1}`, 48),
      name: safeText(preset?.name, `远征方案 ${index + 1}`, 16),
      loadout: normalizeLoadout(preset?.loadout),
      updatedAt: safeDate(preset?.updatedAt),
    })) as SaveData['loadoutPresets']
    : defaults.loadoutPresets;
  const rawSettings = record(input.settings);
  const settings: SaveData['settings'] = {
    music: typeof rawSettings.music === 'boolean' ? rawSettings.music : defaults.settings.music,
    sfx: typeof rawSettings.sfx === 'boolean' ? rawSettings.sfx : defaults.settings.sfx,
    quality: isOneOf(rawSettings.quality, ['auto', 'high', 'balanced', 'battery'] as const) ? rawSettings.quality : defaults.settings.quality,
    leftHanded: typeof rawSettings.leftHanded === 'boolean' ? rawSettings.leftHanded : defaults.settings.leftHanded,
    vibration: typeof rawSettings.vibration === 'boolean' ? rawSettings.vibration : defaults.settings.vibration,
    reduceFlashes: typeof rawSettings.reduceFlashes === 'boolean' ? rawSettings.reduceFlashes : defaults.settings.reduceFlashes,
    largeText: typeof rawSettings.largeText === 'boolean' ? rawSettings.largeText : defaults.settings.largeText,
    colorMode: isOneOf(rawSettings.colorMode, ['default', 'deuteranopia', 'high-contrast'] as const) ? rawSettings.colorMode : defaults.settings.colorMode,
    masterVolume: finite(rawSettings.masterVolume, defaults.settings.masterVolume, 0, 1),
    aimSensitivity: finite(rawSettings.aimSensitivity, defaults.settings.aimSensitivity, .55, 1.75),
    gamepadLayout: isOneOf(rawSettings.gamepadLayout, ['standard', 'southpaw'] as const) ? rawSettings.gamepadLayout : defaults.settings.gamepadLayout,
  };
  const inputWorld = record(input.world);
  const valleyXp = finite(inputWorld.valleyXp, 0, 0, 10_000_000);
  const unlockedCompanions = enumList(inputWorld.unlockedCompanions, COMPANION_IDS, defaults.world.unlockedCompanions);
  if (!unlockedCompanions.includes('little-core')) unlockedCompanions.unshift('little-core');
  const activeCompanion = isOneOf(inputWorld.activeCompanion, COMPANION_IDS) && unlockedCompanions.includes(inputWorld.activeCompanion) ? inputWorld.activeCompanion : 'little-core';
  const rawBond = record(inputWorld.companionBond); const rawMastery = record(inputWorld.themeMastery);
  const world: SaveData['world'] = {
    valleyXp, valleyLevel: valleyLevelForXp(valleyXp),
    restoredLandmarks: enumList(inputWorld.restoredLandmarks, MISSION_IDS, []),
    encyclopedia: enumList(inputWorld.encyclopedia, ENEMY_IDS, []),
    activeCompanion, unlockedCompanions,
    companionBond: {
      'little-core': finite(rawBond['little-core'], 0, 0, 1_000_000),
      sprout: finite(rawBond.sprout, 0, 0, 1_000_000), snowball: finite(rawBond.snowball, 0, 0, 1_000_000),
    },
    themeMastery: Object.fromEntries(THEME_IDS.flatMap((id) => rawMastery[id] === undefined ? [] : [[id, finite(rawMastery[id], 0, 0, 1_000_000)]])),
  };
  const rawTech = record(input.techRanks);
  const techRanks = Object.fromEntries(TECH_TREE.flatMap((node) => rawTech[node.id] === undefined ? [] : [[node.id, Math.floor(finite(rawTech[node.id], 0, 0, node.maxRank))]]));
  const leaderboard = Array.isArray(input.leaderboard) ? input.leaderboard.slice(0, 20).map(normalizeSummary).filter((run): run is RunSummary => Boolean(run)) : [];
  const replays = Array.isArray(input.replays) ? input.replays.slice(0, 5).map(normalizeReplay).filter((replay): replay is ReplayData => Boolean(replay)) : [];
  const seasonBestRaw = record(input.seasonBestScores);
  const dailyRaw = record(input.dailyChallenges);
  const dailyChallenges = Object.fromEntries(Object.entries(dailyRaw).slice(-370).flatMap(([key, value]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return [];
    const entry = record(value);
    return [[key, {
      bestScore: finite(entry.bestScore, 0, 0, 1_000_000_000),
      completedAt: typeof entry.completedAt === 'string' ? safeDate(entry.completedAt) : undefined,
      rewardClaimed: entry.rewardClaimed === true,
    }]];
  })) as SaveData['dailyChallenges'];
  return {
    version: 3,
    highScore: finite(input.highScore, 0), starShards: finite(input.starShards, 0), totalRepaired: finite(input.totalRepaired, 0),
    unlockedWeapons: enumList(input.unlockedWeapons, WEAPON_IDS, defaults.unlockedWeapons),
    unlockedChassis: enumList(input.unlockedChassis, CHASSIS_IDS, defaults.unlockedChassis),
    unlockedMovementModules: enumList(input.unlockedMovementModules, MOVEMENT_IDS, defaults.unlockedMovementModules),
    unlockedAmmo: enumList(input.unlockedAmmo, AMMO_IDS, defaults.unlockedAmmo),
    unlockedTools: enumList(input.unlockedTools, TOOL_IDS, defaults.unlockedTools),
    unlockedPaints: enumList(input.unlockedPaints, PAINT_IDS, defaults.unlockedPaints),
    loadoutPresets: presets,
    activePresetId: presets.some((preset) => preset.id === input.activePresetId) ? input.activePresetId! : presets[0]!.id,
    discoveredRoutes: enumList(input.discoveredRoutes, ROUTE_IDS, defaults.discoveredRoutes),
    completedMissions: enumList(input.completedMissions, MISSION_IDS, defaults.completedMissions),
    seasonBestScores: Object.fromEntries(SEASON_IDS.flatMap((id) => seasonBestRaw[id] === undefined ? [] : [[id, finite(seasonBestRaw[id], 0)]])),
    techRanks,
    achievements: enumList(input.achievements, ACHIEVEMENTS.map((item) => item.id), []),
    dailyChallenges,
    world, settings, leaderboard, replays,
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

  constructor(private readonly storage?: StorageLike) {}

  getStatus(): SaveStatus { return { ...this.status }; }

  async load(): Promise<SaveData> {
    if (this.memory) return normalizeSave(this.memory);
    let current: string | null = null; let backup: string | null = null; let legacy: string | null = null;
    try {
      const storage = this.storage ?? localStorage;
      current = storage.getItem(KEY); backup = storage.getItem(BACKUP_KEY); legacy = storage.getItem(LEGACY_KEY);
    } catch {
      this.status = { mode: 'memory', message: '浏览器存储不可用，本次进度将在关闭页面后清除。' };
      this.memory = createDefaultSave(); return normalizeSave(this.memory);
    }
    const candidates = [{ raw: current, source: 'current' }, { raw: backup, source: 'backup' }, { raw: legacy, source: 'legacy' }] as const;
    for (const candidate of candidates) {
      if (!candidate.raw) continue;
      try {
        const normalized = normalizeSave(JSON.parse(candidate.raw) as Partial<SaveData>);
        if (candidate.source !== 'current') {
          this.status = { mode: 'recovered', message: candidate.source === 'backup' ? '检测到存档异常，已从安全备份恢复。' : '旧版进度已安全升级。' };
          try { (this.storage ?? localStorage).setItem(KEY, JSON.stringify(normalized)); } catch { this.memory = normalized; this.status.mode = 'memory'; }
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
      const storage = this.storage ?? localStorage;
      const previous = storage.getItem(KEY);
      if (previous) storage.setItem(BACKUP_KEY, previous);
      storage.setItem(KEY, JSON.stringify(normalized));
      this.memory = undefined; this.status = { mode: 'persistent' };
      return;
    } catch { /* Retry after removing large, reproducible replay history. */ }
    const compact = compactSave(normalized);
    try {
      (this.storage ?? localStorage).setItem(KEY, JSON.stringify(compact));
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
