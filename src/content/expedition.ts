import type {
  AmmoId, BiomeId, MovementModuleId, PaintId, SeasonId, SurfaceId, TankLoadout, ToolId, WeatherId,
} from '../core/types';

export interface SurfaceDefinition {
  id: SurfaceId;
  name: string;
  traction: number;
  drag: number;
  description: string;
}

export interface MovementModuleDefinition {
  id: MovementModuleId;
  name: string;
  shortName: string;
  description: string;
  unlockCost: number;
  color: number;
  ratings: Record<'mountain' | 'water' | 'road', number>;
  surfaceGrip: Partial<Record<SurfaceId, number>>;
}

export interface AmmoDefinition {
  id: AmmoId;
  name: string;
  description: string;
  role: string;
  unlockCost: number;
  color: number;
}

export interface ToolDefinition {
  id: ToolId;
  name: string;
  description: string;
  unlockCost: number;
  color: number;
}

export interface PaintDefinition {
  id: PaintId;
  name: string;
  description: string;
  unlockCost: number;
  color: number;
}

export interface SeasonDefinition {
  id: SeasonId;
  name: string;
  forecast: string;
  weather: WeatherId;
  accent: number;
  recommendedMovement: MovementModuleId;
  routeHint: string;
}

export interface BiomeDefinition {
  id: BiomeId;
  name: string;
  description: string;
  surfaces: SurfaceId[];
  routes: Array<{ id: string; name: string; focus: 'mountain' | 'water' }>;
}

export const SURFACES: Record<SurfaceId, SurfaceDefinition> = {
  road: { id: 'road', name: '公路', traction: 1, drag: 1, description: '稳定、快速，适合公路轮。' },
  mud: { id: 'mud', name: '泥地', traction: .72, drag: 1.28, description: '雨后容易打滑，越野模块更可靠。' },
  sand: { id: 'sand', name: '沙地', traction: .66, drag: 1.35, description: '松软地面会拖慢窄轮。' },
  'shallow-water': { id: 'shallow-water', name: '浅水', traction: .62, drag: 1.42, description: '水流会轻推机体。' },
  'deep-water': { id: 'deep-water', name: '深水', traction: .1, drag: 2.2, description: '只有浮航模块可以安全通过。' },
  ice: { id: 'ice', name: '冰面', traction: .38, drag: .72, description: '速度很快，但转向会保留惯性。' },
  'deep-snow': { id: 'deep-snow', name: '深雪', traction: .52, drag: 1.7, description: '雪履带可以压出稳定路线。' },
};

export const MOVEMENT_MODULES: Record<MovementModuleId, MovementModuleDefinition> = {
  'road-wheel': { id: 'road-wheel', name: '霓光公路轮', shortName: '公路轮', description: '公路极速与灵敏转向，泥地和深雪表现较弱。', unlockCost: 0, color: 0xffd84a, ratings: { mountain: 2, water: 0, road: 5 }, surfaceGrip: { road: 1.18, ice: .65 } },
  'all-terrain': { id: 'all-terrain', name: '全地形轮', shortName: '全地形轮', description: '山路与泥地的可靠选择，适合第一次远征。', unlockCost: 120, color: 0x55e9ff, ratings: { mountain: 4, water: 1, road: 4 }, surfaceGrip: { road: 1, mud: 1.2, sand: 1.05, 'shallow-water': .88 } },
  'snow-tread': { id: 'snow-tread', name: '雪原履带', shortName: '雪履带', description: '在冰面和深雪中保持抓地，转向沉稳。', unlockCost: 220, color: 0xc8f4ff, ratings: { mountain: 4, water: 0, road: 2 }, surfaceGrip: { ice: 1.3, 'deep-snow': 1.4, mud: 1.08 } },
  'sand-float': { id: 'sand-float', name: '沙海气囊轮', shortName: '沙地轮', description: '宽大低压轮胎不会陷进沙滩，也能轻松越过浅水。', unlockCost: 260, color: 0xffb653, ratings: { mountain: 2, water: 2, road: 3 }, surfaceGrip: { sand: 1.42, 'shallow-water': 1.05, mud: .98 } },
  amphibious: { id: 'amphibious', name: '浮航模块', shortName: '浮航模块', description: '轮毂展开为浮航环，可以进入湖泊与近海水道。', unlockCost: 380, color: 0x35e8ff, ratings: { mountain: 3, water: 5, road: 4 }, surfaceGrip: { road: 1, mud: .95, sand: .92, 'shallow-water': 1.25, 'deep-water': 1.5 } },
};

export const AMMO: Record<AmmoId, AmmoDefinition> = {
  'star-pulse': { id: 'star-pulse', name: '星脉弹', description: '稳定明亮的基础能量弹。', role: '均衡', unlockCost: 0, color: 0x40e9ff },
  ricochet: { id: 'ricochet', name: '弹跳弹', description: '命中岩壁后改变方向，适合洞穴。', role: '技巧', unlockCost: 160, color: 0xffd84a },
  frost: { id: 'frost', name: '冰霜弹', description: '减慢目标，也能冻结浅水形成临时道路。', role: '控场', unlockCost: 220, color: 0xaef3ff },
  'repair-seed': { id: 'repair-seed', name: '修复弹', description: '修复友方和设施，不会伤害伙伴。', role: '协作', unlockCost: 180, color: 0x68ff9f },
  'chain-lightning': { id: 'chain-lightning', name: '闪电链', description: '在靠近的目标之间弹射。', role: '群体', unlockCost: 320, color: 0xb88cff },
  'seed-core': { id: 'seed-core', name: '种子核心', description: '让贫瘠地面长出可恢复能量的植物。', role: '环境', unlockCost: 420, color: 0xb8ff70 },
};

export const TOOLS: Record<ToolId, ToolDefinition> = {
  'repair-arm': { id: 'repair-arm', name: '修复臂', description: '快速修复设施和倒地伙伴。', unlockCost: 0, color: 0x68ff9f },
  scanner: { id: 'scanner', name: '扫描雷达', description: '发现隐藏路线、图鉴目标和宝箱。', unlockCost: 180, color: 0x55e9ff },
  tractor: { id: 'tractor', name: '牵引器', description: '拖动岩石、木筏和受困机器人。', unlockCost: 260, color: 0xffd84a },
  'bridge-projector': { id: 'bridge-projector', name: '临时桥投射器', description: '为短距离沟壑投射一座光桥。', unlockCost: 380, color: 0xb88cff },
};

export const PAINTS: Record<PaintId, PaintDefinition> = {
  'sunrise-yellow': { id: 'sunrise-yellow', name: '晨曦黄', description: '勇气与好奇心的经典配色。', unlockCost: 0, color: 0xffc928 },
  'sky-cyan': { id: 'sky-cyan', name: '天空青', description: '像瀑布与晴空一样清爽。', unlockCost: 80, color: 0x35e8ff },
  'forest-green': { id: 'forest-green', name: '森林绿', description: '适合自然观察员。', unlockCost: 80, color: 0x77dd79 },
  'aurora-violet': { id: 'aurora-violet', name: '极光紫', description: '夜间任务中的温柔亮光。', unlockCost: 100, color: 0x9b7cff },
};

export const SEASONS: Record<SeasonId, SeasonDefinition> = {
  spring: { id: 'spring', name: '春季', forecast: '春雨将至', weather: 'spring-rain', accent: 0x8de8a7, recommendedMovement: 'amphibious', routeHint: '河道水位上涨，浮航路线将开放。' },
  summer: { id: 'summer', name: '夏季', forecast: '午后雷阵雨', weather: 'thunderstorm', accent: 0x55e9ff, recommendedMovement: 'sand-float', routeHint: '沙滩路径干燥，雷雨时远离高地。' },
  autumn: { id: 'autumn', name: '秋季', forecast: '山谷叶风', weather: 'leaf-wind', accent: 0xffb653, recommendedMovement: 'all-terrain', routeHint: '山路落叶较滑，越野轮更稳定。' },
  winter: { id: 'winter', name: '冬季', forecast: '傍晚降雪', weather: 'snowfall', accent: 0xc8f4ff, recommendedMovement: 'snow-tread', routeHint: '湖面冻结形成捷径，深雪区需要履带。' },
};

export const BIOMES: Record<BiomeId, BiomeDefinition> = {
  'mountain-sea-valley': {
    id: 'mountain-sea-valley', name: '山海谷', description: '山路、瀑布、河流、沙滩与小岛相连的四季实验谷。',
    surfaces: ['road', 'mud', 'sand', 'shallow-water', 'deep-water', 'ice', 'deep-snow'],
    routes: [{ id: 'ridge', name: '云岭山路', focus: 'mountain' }, { id: 'river', name: '碧水航道', focus: 'water' }],
  },
};

export const DEFAULT_LOADOUT: TankLoadout = {
  chassis: 'spark', movement: 'road-wheel', ammoSlots: ['star-pulse', 'repair-seed'], activeAmmoIndex: 0,
  tool: 'repair-arm', paint: 'sunrise-yellow', decal: 'little-explorer', light: 'cyan', trail: 'spark',
};

export function cloneLoadout(loadout: TankLoadout): TankLoadout {
  return { ...loadout, ammoSlots: [...loadout.ammoSlots] as [AmmoId, AmmoId] };
}
