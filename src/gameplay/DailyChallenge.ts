import type { DailyObjective } from '../core/types';

export interface DailyChallengeRule {
  id: string;
  name: string;
  detail: string;
  objective: DailyObjective;
  target: number;
  timeLimit: number;
  reward: number;
  scoreMultiplier: number;
  enemySpeedMultiplier: number;
  playerHpMultiplier: number;
}

const RULES: Omit<DailyChallengeRule, 'id'>[] = [
  { name: '极光快递', detail: '180 秒内取得 3,000 分', objective: 'score', target: 3000, timeLimit: 180, reward: 90, scoreMultiplier: 1.25, enemySpeedMultiplier: 1.12, playerHpMultiplier: 1 },
  { name: '云端守护', detail: '240 秒内守住 5 个完整波次', objective: 'waves', target: 5, timeLimit: 240, reward: 100, scoreMultiplier: 1.1, enemySpeedMultiplier: 1.08, playerHpMultiplier: 1.12 },
  { name: '霸主观察课', detail: '300 秒内修复 1 台区域霸主', objective: 'boss', target: 1, timeLimit: 300, reward: 120, scoreMultiplier: 1, enemySpeedMultiplier: 1.06, playerHpMultiplier: 1.08 },
  { name: '峡谷修复队', detail: '210 秒内修复 30 台机器人', objective: 'repair', target: 30, timeLimit: 210, reward: 105, scoreMultiplier: 1.15, enemySpeedMultiplier: 1.14, playerHpMultiplier: 1.05 },
];

export function dailyKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function dailyRuleForSeed(seed: number, key = dailyKey()): DailyChallengeRule {
  const template = RULES[(seed >>> 0) % RULES.length]!;
  return { ...template, id: key };
}
