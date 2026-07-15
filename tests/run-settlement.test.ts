import { describe, expect, it } from 'vitest';
import { createDefaultSave } from '../src/persistence/SaveRepository';
import { settleRun } from '../src/gameplay/RunSettlement';
import type { ReplayData, RunSummary } from '../src/core/types';

describe('atomic run settlement', () => {
  it('builds every reward and a zero-based replay before persistence', () => {
    const current = createDefaultSave(); current.totalRepaired = 49;
    const summary: RunSummary = { id: 'run', date: '2026-07-15T00:00:00.000Z', score: 1200, wave: 5, mode: 'adventure', theme: 'neon-city', duration: 500, repaired: 4, stars: 12, title: '测试', season: 'spring', missionId: 'spring-bridge', missionComplete: true };
    const replay: ReplayData = { id: 'replay', createdAt: summary.date, options: { mode: 'adventure', theme: 'neon-city', assist: 'standard', coop: false, weapon: 'pulse', chassis: 'spark' }, summary, frames: [{ t: 140, p1x: 1, p1z: 2, p1r: 0 }, { t: 141, p1x: 2, p1z: 3, p1r: 0 }] };
    const result = settleRun(current, { summary, replay, route: 'ridge-route', encounteredEnemies: ['scout'], coop: false });
    expect(result.save.replays[0]?.frames.map((frame) => frame.t)).toEqual([0, 1]);
    expect(result.save.completedMissions).toContain('spring-bridge');
    expect(result.save.discoveredRoutes).toContain('ridge-route');
    expect(result.save.world.encyclopedia).toContain('scout');
    expect(result.save.totalRepaired).toBe(53);
    expect(result.unlockedAchievements).toEqual(expect.arrayContaining(['first-repair', 'helper-50', 'wave-5']));
    expect(current.totalRepaired).toBe(49);
  });

  it('awards a daily challenge exactly once and records the best score atomically', () => {
    const current = createDefaultSave();
    const summary: RunSummary = { id: 'daily', date: '2026-07-15T00:00:00.000Z', score: 3200, wave: 4, mode: 'daily', theme: 'neon-city', duration: 180, repaired: 20, stars: 10, title: '今日挑战', dailyKey: '2026-07-15', dailyComplete: true, dailyReward: 90 };
    const replay: ReplayData = { id: 'replay-daily', createdAt: summary.date, options: { mode: 'daily', theme: 'neon-city', assist: 'standard', coop: false, weapon: 'pulse', chassis: 'spark', seed: 7, dailyKey: '2026-07-15' }, summary, frames: [{ t: 4, p1x: 0, p1z: 0, p1r: 0 }] };
    const first = settleRun(current, { summary, replay, encounteredEnemies: [], coop: false });
    expect(first.save.dailyChallenges['2026-07-15']).toMatchObject({ bestScore: 3200, rewardClaimed: true });
    const rewardAfterFirst = first.save.starShards;
    const second = settleRun(first.save, { summary: { ...summary, score: 3600 }, replay, encounteredEnemies: [], coop: false });
    expect(second.save.starShards - rewardAfterFirst).toBe(summary.stars);
    expect(second.save.dailyChallenges['2026-07-15']?.bestScore).toBe(3600);
  });
});
