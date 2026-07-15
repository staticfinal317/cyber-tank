import type { EnemyDefinition, EnemyKind } from '../core/types';

export const ENEMIES: Record<EnemyKind, EnemyDefinition> = {
  scout: { id: 'scout', name: '巡游球', hp: 28, speed: 4.1, radius: .65, score: 80, fireRate: 2.1, damage: 6, color: 0xff5f8f, unlockWave: 1 },
  charger: { id: 'charger', name: '疾风蜂', hp: 20, speed: 6.4, radius: .48, score: 95, fireRate: 0, damage: 10, color: 0xffb13b, unlockWave: 2 },
  gunner: { id: 'gunner', name: '脉冲卫士', hp: 48, speed: 2.7, radius: .78, score: 130, fireRate: 1.45, damage: 8, color: 0xa975ff, unlockWave: 3 },
  bulwark: { id: 'bulwark', name: '重装堡垒', hp: 125, speed: 1.45, radius: 1.05, score: 240, fireRate: 2.7, damage: 12, color: 0x4ea9ff, unlockWave: 4 },
  splitter: { id: 'splitter', name: '分裂棱镜', hp: 70, speed: 2.2, radius: .88, score: 190, fireRate: 2, damage: 7, color: 0xf26cff, unlockWave: 5 },
  medic: { id: 'medic', name: '修复工蜂', hp: 60, speed: 2.9, radius: .72, score: 210, fireRate: 3.5, damage: 4, color: 0x61f5a1, unlockWave: 6 },
  sniper: { id: 'sniper', name: '远星棱镜', hp: 45, speed: 2, radius: .7, score: 260, fireRate: 3.2, damage: 18, color: 0xffe16a, unlockWave: 7 },
  boss: { id: 'boss', name: '区域霸主', hp: 1100, speed: 1.2, radius: 2.15, score: 2500, fireRate: .85, damage: 13, color: 0xff3f70, unlockWave: 5 },
};

export function availableEnemyKinds(wave: number): EnemyKind[] {
  return (Object.keys(ENEMIES) as EnemyKind[]).filter((kind) => kind !== 'boss' && ENEMIES[kind].unlockWave <= wave);
}
