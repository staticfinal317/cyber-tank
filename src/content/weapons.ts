import type { TechNode, WeaponDefinition, WeaponId } from '../core/types';

export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  pulse: { id: 'pulse', name: '星脉炮', description: '稳定、明亮，适合第一次出发。', damage: 20, cooldown: .24, speed: 17, pellets: 1, spread: 0, color: 0x40e9ff, unlockCost: 0 },
  scatter: { id: 'scatter', name: '彩虹散射器', description: '近距离一次发射三枚能量星。', damage: 13, cooldown: .48, speed: 14, pellets: 3, spread: .2, color: 0xffd84a, unlockCost: 180 },
  rail: { id: 'rail', name: '极光轨道炮', description: '慢速充能，穿透多个目标。', damage: 56, cooldown: .85, speed: 27, pellets: 1, spread: 0, color: 0xb9ff6b, unlockCost: 420 },
  arc: { id: 'arc', name: '闪电链路', description: '命中后弹射到附近的伙伴机。', damage: 16, cooldown: .36, speed: 15, pellets: 1, spread: .04, color: 0xb389ff, unlockCost: 680 },
};

export const TECH_TREE: TechNode[] = [
  { id: 'armor', name: '守护装甲', description: '每级最大耐久 +10。', maxRank: 5, costs: [80, 140, 220, 340, 520] },
  { id: 'engine', name: '灵巧引擎', description: '每级移动速度 +4%。', maxRank: 5, costs: [80, 150, 240, 360, 540] },
  { id: 'power', name: '星核增幅', description: '每级武器威力 +5%。', maxRank: 5, costs: [100, 170, 270, 410, 620] },
  { id: 'cooling', name: '冷却回路', description: '每级射击间隔 -4%。', maxRank: 4, costs: [120, 220, 380, 600], requires: 'power' },
  { id: 'rescue', name: '伙伴协议', description: '双人模式中重建队友更快。', maxRank: 3, costs: [140, 260, 480], requires: 'armor' },
  { id: 'fortune', name: '寻宝雷达', description: '提高强化芯片出现几率。', maxRank: 3, costs: [160, 300, 560], requires: 'engine' },
];
