import type { GameOptions, SeasonId, ThemeId } from '../core/types';

export type WorldEventKind =
  | 'none' | 'emp' | 'meteor' | 'supply' | 'flood' | 'lightning' | 'leaf-gust' | 'snow-squall'
  | 'neon-blackout' | 'sky-current' | 'toy-march' | 'crystal-surge' | 'dino-stampede' | 'aurora-pulse';

export interface WorldEventDefinition { id: WorldEventKind; label: string; message: string; duration: number; color: number }

export const WORLD_EVENTS: Record<WorldEventKind, WorldEventDefinition> = {
  none: { id: 'none', label: '场景稳定', message: '所有系统运行稳定', duration: 0, color: 0x55e9ff },
  emp: { id: 'emp', label: '电磁风暴', message: '电磁风暴：技能恢复加速', duration: 8, color: 0xb88cff },
  meteor: { id: 'meteor', label: '流星雨', message: '流星雨：留意地面预警圈', duration: 8, color: 0xff8b3d },
  supply: { id: 'supply', label: '补给信标', message: '补给信标：星核芯片已送达', duration: 8, color: 0xffd84a },
  flood: { id: 'flood', label: '春汛上涨', message: '春汛上涨：河流推力增强，浮航模块最稳定', duration: 9, color: 0x72eaff },
  lightning: { id: 'lightning', label: '雷暴预警', message: '雷暴预警：闪电即将净化高地目标', duration: 8, color: 0xbba0ff },
  'leaf-gust': { id: 'leaf-gust', label: '山谷叶风', message: '山谷叶风：横风将轻推所有机体', duration: 10, color: 0xffb653 },
  'snow-squall': { id: 'snow-squall', label: '冰原暴雪', message: '暴雪来临：深雪区域阻力暂时增大', duration: 10, color: 0xc8f4ff },
  'neon-blackout': { id: 'neon-blackout', label: '霓虹熄灯', message: '城市熄灯：跟随青色安全电轨行动', duration: 7, color: 0x35e8ff },
  'sky-current': { id: 'sky-current', label: '云海上升流', message: '云海上升流：冲刺系统已获得轻量充能', duration: 8, color: 0x8df8ff },
  'toy-march': { id: 'toy-march', label: '玩具大巡游', message: '玩具大巡游：一队积木伙伴正在靠近', duration: 8, color: 0xff6fd2 },
  'crystal-surge': { id: 'crystal-surge', label: '晶潮共振', message: '晶潮共振：炮弹能量暂时增强', duration: 9, color: 0x7efcff },
  'dino-stampede': { id: 'dino-stampede', label: '恐龙足迹', message: '峡谷震动：躲开移动的橙色足迹', duration: 8, color: 0xff9548 },
  'aurora-pulse': { id: 'aurora-pulse', label: '极光脉冲', message: '极光脉冲：所有小队成员获得护盾', duration: 9, color: 0xb5f7ff },
};

const SEASON_EVENT: Record<SeasonId, WorldEventKind> = { spring: 'flood', summer: 'lightning', autumn: 'leaf-gust', winter: 'snow-squall' };
const THEME_EVENT: Record<ThemeId, WorldEventKind> = {
  'neon-city': 'neon-blackout', 'cloud-garden': 'sky-current', 'toy-factory': 'toy-march',
  'crystal-ocean': 'crystal-surge', 'dino-canyon': 'dino-stampede', 'aurora-ice': 'aurora-pulse',
};

export function eventPool(options: Pick<GameOptions, 'biome' | 'season' | 'theme'>): WorldEventKind[] {
  if (options.biome && options.season) return [SEASON_EVENT[options.season], 'meteor', 'supply'];
  return [THEME_EVENT[options.theme], 'emp', 'meteor', 'supply'];
}
