export type ThemeId =
  | 'neon-city'
  | 'cloud-garden'
  | 'toy-factory'
  | 'crystal-ocean'
  | 'dino-canyon'
  | 'aurora-ice';

export type GameMode = 'adventure' | 'endless' | 'last-core' | 'daily';
export type AssistLevel = 'easy' | 'standard' | 'expert';
export type EnemyKind =
  | 'scout' | 'charger' | 'gunner' | 'bulwark' | 'splitter' | 'medic' | 'sniper'
  | 'stalker' | 'summoner' | 'reflector' | 'warden' | 'boss';
export type BossVariant = 'tide-leviathan' | 'ridge-colossus' | 'storm-roc' | 'frost-mammoth';
export type WeaponId = 'pulse' | 'scatter' | 'rail' | 'arc';
export type ChassisId = 'spark' | 'guardian' | 'comet';
export type CompanionId = 'little-core' | 'sprout' | 'snowball';
export type CrewRole = 'navigator' | 'engineer' | 'wingman';
export type DailyObjective = 'score' | 'waves' | 'boss' | 'repair';
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
  | 'spring-bridge' | 'spring-river' | 'spring-garden'
  | 'summer-beacon' | 'summer-island' | 'summer-storm-eye'
  | 'autumn-orchard' | 'autumn-migration' | 'autumn-kite-trail'
  | 'winter-lighthouse' | 'winter-ice-rescue' | 'winter-aurora';

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
  role: 'chaser' | 'ranged' | 'tank' | 'support' | 'trickster' | 'boss';
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
  crewMode?: boolean;
  crewRoleP2?: CrewRole;
  companion?: CompanionId;
  weapon: WeaponId;
  chassis: ChassisId;
  loadout?: TankLoadout;
  biome?: BiomeId;
  season?: SeasonId;
  route?: RouteId;
  missionId?: ExpeditionMissionId;
  testDrive?: boolean;
  seed?: number;
  dailyKey?: string;
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
  dailyKey?: string;
  dailyComplete?: boolean;
  dailyReward?: number;
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
  dailyChallenges: Record<string, { bestScore: number; completedAt?: string; rewardClaimed: boolean }>;
  world: {
    valleyXp: number;
    valleyLevel: number;
    restoredLandmarks: ExpeditionMissionId[];
    encyclopedia: EnemyKind[];
    activeCompanion: CompanionId;
    unlockedCompanions: CompanionId[];
    companionBond: Record<CompanionId, number>;
    themeMastery: Partial<Record<ThemeId, number>>;
  };
  leaderboard: RunSummary[];
  replays: ReplayData[];
  settings: {
    music: boolean;
    sfx: boolean;
    quality: 'auto' | 'high' | 'balanced' | 'battery';
    leftHanded: boolean;
    vibration: boolean;
    reduceFlashes: boolean;
    largeText: boolean;
    colorMode: 'default' | 'deuteranopia' | 'high-contrast';
    masterVolume: number;
    aimSensitivity: number;
    gamepadLayout: 'standard' | 'southpaw';
  };
}
