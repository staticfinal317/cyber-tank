import type { ChassisId } from '../core/types';

export interface ChassisDefinition {
  id: ChassisId;
  name: string;
  role: string;
  description: string;
  unlockCost: number;
  color: number;
}

export const CHASSIS: Record<ChassisId, ChassisDefinition> = {
  spark: { id: 'spark', name: '星火号', role: '均衡型', description: '转向灵活、耐久均衡，适合所有小驾驶员。', unlockCost: 0, color: 0xffd84a },
  guardian: { id: 'guardian', name: '守护者', role: '防护型', description: '额外 25 点耐久，移动稍慢，适合保护队友。', unlockCost: 360, color: 0x65f2ff },
  comet: { id: 'comet', name: '彗星号', role: '速度型', description: '移动最快，但耐久更少，适合灵巧走位。', unlockCost: 620, color: 0xb8ff70 },
};
