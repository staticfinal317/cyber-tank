export type ThemeId =
  | 'neon-city'
  | 'cloud-garden'
  | 'toy-factory'
  | 'crystal-ocean'
  | 'dino-canyon'
  | 'aurora-ice';

export type GameMode = 'adventure' | 'endless' | 'last-core' | 'daily';
export type AssistLevel = 'easy' | 'standard' | 'expert';
export type EnemyKind = 'scout' | 'charger' | 'gunner' | 'bulwark' | 'splitter' | 'medic' | 'sniper' | 'boss';
export type BossVariant = 'tide-leviathan' | 'ridge-colossus';
export type WeaponId = 'pulse' | 'scatter' | 'rail' | 'arc';
export type ChassisId = 'spark' | 'guardian' | 'comet';
export type AbilityId = 'shield' | 'repair' | 'dash' | 'storm';
export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';
export type BiomeId = 'mountain-sea-valley';
export type WeatherId = 'clear' | 'spring-rain' | 'thunderstorm' | 'leaf-wind' | 'snowfall';
export type SurfaceId = 'road' | 'mud' | 'sand' | 'shallow-water' | 'deep-water' | 'ice' | 'deep-snow';
export type MovementModuleId = 'road-wheel' | 'all-terrain' | 'snow-tread' | 'sand-float' | 'amphibious';
export type AmmoId = 'star-pulse' | 'ricochet' | 'frost' | 'repair-seed' | 'chain-lightning' | 'seed-core';
export type ToolId = 'repair-arm' | 'scanner' | 'tractor' | 'bridge-projector';
export type PaintId = 'sunrise-yellow' | 'sky-cyan' | 'forest-green' | 'aurora-violet';
export type RouteId = 'ridge-route' | 'river-route';
export type ExpeditionMissionId =
  | 'spring-bridge' | 'spring-river'
  | 'summer-beacon' | 'summer-island'
  | 'autumn-orchard' | 'autumn-migration'
  | 'winter-lighthouse' | 'winter-ice-rescue';

export interface TankLoadout {
  chassis: ChassisId;
  movement: MovementModuleId;
  ammoSlots: [AmmoId, AmmoId];
  activeAmmoIndex: 0 | 1;
  tool: ToolId;
  paint: PaintId;
  decal: string;
  light: 'cyan' | 'gold' | 'lime' | 'violet';
  trail: 'spark' | 'rainbow' | 'leaves' | 'snow';
}

export interface LoadoutPreset {
  id: string;
  name: string;
  loadout: TankLoadout;
  updatedAt: string;
}

export interface Vec2 { x: number; z: number }

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  subtitle: string;
  description: string;
  sky: number;
  fog: number;
  ground: number;
  grid: number;
  primary: number;
  accent: number;
  danger: number;
  mechanic: string;
}

export interface EnemyDefinition {
  id: EnemyKind;
  name: string;
  hp: number;
  speed: number;
  radius: number;
  score: number;
  fireRate: number;
  damage: number;
  color: number;
  unlockWave: number;
}

export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  description: string;
  damage: number;
  cooldown: number;
  speed: number;
  pellets: number;
  spread: number;
  color: number;
  unlockCost: number;
}

export interface TechNode {
  id: string;
  name: string;
  description: string;
  maxRank: number;
  costs: number[];
  requires?: string;
}

export interface GameOptions {
  mode: GameMode;
  theme: ThemeId;
  assist: AssistLevel;
  coop: boolean;
  weapon: WeaponId;
  chassis: ChassisId;
  loadout?: TankLoadout;
  biome?: BiomeId;
  season?: SeasonId;
  route?: RouteId;
  missionId?: ExpeditionMissionId;
  testDrive?: boolean;
  seed?: number;
}

export interface RunSummary {
  id: string;
  date: string;
  score: number;
  wave: number;
  mode: GameMode;
  theme: ThemeId;
  duration: number;
  repaired: number;
  stars: number;
  title: string;
  season?: SeasonId;
  missionId?: ExpeditionMissionId;
  missionComplete?: boolean;
}

export interface ReplayFrame {
  t: number;
  p1x: number;
  p1z: number;
  p1r: number;
  p2x?: number;
  p2z?: number;
}

export interface ReplayData {
  id: string;
  createdAt: string;
  options: GameOptions;
  summary: RunSummary;
  frames: ReplayFrame[];
}

export interface SaveData {
  version: 3;
  highScore: number;
  starShards: number;
  totalRepaired: number;
  unlockedWeapons: WeaponId[];
  unlockedChassis: ChassisId[];
  unlockedMovementModules: MovementModuleId[];
  unlockedAmmo: AmmoId[];
  unlockedTools: ToolId[];
  unlockedPaints: PaintId[];
  loadoutPresets: LoadoutPreset[];
  activePresetId: string;
  discoveredRoutes: RouteId[];
  completedMissions: ExpeditionMissionId[];
  seasonBestScores: Partial<Record<SeasonId, number>>;
  techRanks: Record<string, number>;
  achievements: string[];
  leaderboard: RunSummary[];
  replays: ReplayData[];
  settings: {
    music: boolean;
    sfx: boolean;
    quality: 'auto' | 'high' | 'balanced' | 'battery';
    leftHanded: boolean;
  };
}
