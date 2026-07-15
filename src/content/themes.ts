import type { ThemeDefinition, ThemeId } from '../core/types';

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  'neon-city': {
    id: 'neon-city', name: '霓虹雨城', subtitle: '高楼与电路雨',
    description: '穿梭数据街区，路面电轨会周期性加速战车。',
    sky: 0x050912, fog: 0x08101f, ground: 0x091322, grid: 0x19d9ff,
    primary: 0x20e3ff, accent: 0xffd84a, danger: 0xff4d7d, mechanic: '加速电轨',
  },
  'cloud-garden': {
    id: 'cloud-garden', name: '云端花园', subtitle: '天空岛与萤光植物',
    description: '漂浮花粉会治疗队友，边缘气流会轻推战车。',
    sky: 0x172b3b, fog: 0x24485a, ground: 0x163b39, grid: 0x9af5b2,
    primary: 0x8df4b4, accent: 0xffe779, danger: 0xff826f, mechanic: '治愈花粉',
  },
  'toy-factory': {
    id: 'toy-factory', name: '积木工厂', subtitle: '齿轮与弹跳传送带',
    description: '移动传送带改变走位，积木掩体可以被击碎。',
    sky: 0x19213a, fog: 0x26304b, ground: 0x24305b, grid: 0xffd447,
    primary: 0x61e5ff, accent: 0xffd447, danger: 0xff6677, mechanic: '移动传送带',
  },
  'crystal-ocean': {
    id: 'crystal-ocean', name: '水晶海沟', subtitle: '透明晶簇与深海光带',
    description: '晶体可反射电弧，潮汐会让所有单位短暂漂移。',
    sky: 0x041827, fog: 0x062e42, ground: 0x073349, grid: 0x54f5e4,
    primary: 0x45f1dc, accent: 0x9fffe8, danger: 0xff5c91, mechanic: '能量潮汐',
  },
  'dino-canyon': {
    id: 'dino-canyon', name: '恐龙峡谷', subtitle: '化石、岩桥与熔光',
    description: '脚印会预告冲锋路线，岩柱能挡住远程火力。',
    sky: 0x25160f, fog: 0x40251a, ground: 0x4b2e1d, grid: 0xffa94d,
    primary: 0x9be564, accent: 0xffc857, danger: 0xff5e45, mechanic: '恐龙冲锋',
  },
  'aurora-ice': {
    id: 'aurora-ice', name: '极光冰原', subtitle: '冰面、星光与磁暴',
    description: '冰面保留移动惯性，极光照耀时技能恢复更快。',
    sky: 0x07162b, fog: 0x133553, ground: 0x163f59, grid: 0x9de7ff,
    primary: 0xa9f0ff, accent: 0xc6ff72, danger: 0xff6b9c, mechanic: '冰面惯性',
  },
};

export const THEME_ORDER: ThemeId[] = [
  'neon-city', 'cloud-garden', 'toy-factory', 'crystal-ocean', 'dino-canyon', 'aurora-ice',
];
