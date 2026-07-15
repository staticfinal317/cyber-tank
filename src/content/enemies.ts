import type { EnemyDefinition, EnemyKind } from '../core/types';

export const ENEMIES: Record<EnemyKind, EnemyDefinition> = {
  scout: { id: 'scout', name: '巡游球', hp: 28, speed: 4.1, radius: .65, score: 80, fireRate: 2.1, damage: 6, color: 0xff5f8f, unlockWave: 1, role: 'chaser' },
  charger: { id: 'charger', name: '疾风蜂', hp: 20, speed: 6.4, radius: .48, score: 95, fireRate: 0, damage: 10, color: 0xffb13b, unlockWave: 2, role: 'chaser' },
  gunner: { id: 'gunner', name: '脉冲卫士', hp: 48, speed: 2.7, radius: .78, score: 130, fireRate: 1.45, damage: 8, color: 0xa975ff, unlockWave: 3, role: 'ranged' },
  bulwark: { id: 'bulwark', name: '重装堡垒', hp: 125, speed: 1.45, radius: 1.05, score: 240, fireRate: 2.7, damage: 12, color: 0x4ea9ff, unlockWave: 4, role: 'tank' },
  splitter: { id: 'splitter', name: '分裂棱镜', hp: 70, speed: 2.2, radius: .88, score: 190, fireRate: 2, damage: 7, color: 0xf26cff, unlockWave: 5, role: 'trickster' },
  medic: { id: 'medic', name: '修复工蜂', hp: 60, speed: 2.9, radius: .72, score: 210, fireRate: 3.5, damage: 4, color: 0x61f5a1, unlockWave: 6, role: 'support' },
  sniper: { id: 'sniper', name: '远星棱镜', hp: 45, speed: 2, radius: .7, score: 260, fireRate: 3.2, damage: 18, color: 0xffe16a, unlockWave: 7, role: 'ranged' },
  stalker: { id: 'stalker', name: '幻影狐', hp: 58, speed: 4.8, radius: .68, score: 280, fireRate: 2.6, damage: 12, color: 0x56f0ff, unlockWave: 8, role: 'trickster' },
  summoner: { id: 'summoner', name: '蜂群母巢', hp: 150, speed: 1.75, radius: 1.15, score: 420, fireRate: 3.8, damage: 7, color: 0xff78d8, unlockWave: 9, role: 'support' },
  reflector: { id: 'reflector', name: '镜盾甲虫', hp: 180, speed: 1.55, radius: 1.08, score: 470, fireRate: 2.9, damage: 13, color: 0x8ffaff, unlockWave: 10, role: 'tank' },
  warden: { id: 'warden', name: '磁轨典狱长', hp: 220, speed: 2.15, radius: 1.22, score: 620, fireRate: 1.8, damage: 15, color: 0xe497ff, unlockWave: 12, role: 'ranged' },
  boss: { id: 'boss', name: '区域霸主', hp: 1100, speed: 1.2, radius: 2.15, score: 2500, fireRate: .85, damage: 13, color: 0xff3f70, unlockWave: 5, role: 'boss' },
};

export function availableEnemyKinds(wave: number): EnemyKind[] {
  return (Object.keys(ENEMIES) as EnemyKind[]).filter((kind) => kind !== 'boss' && ENEMIES[kind].unlockWave <= wave);
}
