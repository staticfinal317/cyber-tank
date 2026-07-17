import { describe, expect, it } from 'vitest';
import { CLASSIC_LEVELS } from '../src/classic/content/levels';
import { parseLevel } from '../src/classic/content/parseLevel';
import { GRID, WAVE } from '../src/classic/core/constants';
import type { EnemyKind } from '../src/classic/core/types';

const VALID_ENEMY_QUEUE: EnemyKind[] = Array.from({ length: WAVE.totalEnemies }, () => 'basic');

// 一个已知合法的最小网格：26×26 全空地，四个 2×2 出生/基地区自然满足 '.' 要求。
const VALID_GRID = Array.from({ length: GRID }, () => '.'.repeat(GRID)).join('\n');

describe('CLASSIC_LEVELS', () => {
  it('恰有第 1、2、3 关，全部通过 parseLevel 构造', () => {
    expect(CLASSIC_LEVELS).toHaveLength(3);
    CLASSIC_LEVELS.forEach((level, i) => {
      expect(level.stage).toBe(i + 1);
      expect(level.grid).toHaveLength(GRID);
      level.grid.forEach((row) => expect(row).toHaveLength(GRID));
      expect(level.enemyQueue).toHaveLength(WAVE.totalEnemies);
    });
  });

  it('每关基地围墙 8 格均为砖墙 B', () => {
    const wallCells = [
      { col: 11, row: 23 }, { col: 12, row: 23 }, { col: 13, row: 23 }, { col: 14, row: 23 },
      { col: 11, row: 24 }, { col: 14, row: 24 },
      { col: 11, row: 25 }, { col: 14, row: 25 },
    ];
    CLASSIC_LEVELS.forEach((level) => {
      wallCells.forEach(({ col, row }) => {
        expect(level.grid[row]![col]).toBe('B');
      });
    });
  });

  it('第 1 关为 18 basic + 2 fast', () => {
    const q = CLASSIC_LEVELS[0]!.enemyQueue;
    expect(q.filter((k) => k === 'basic')).toHaveLength(18);
    expect(q.filter((k) => k === 'fast')).toHaveLength(2);
  });

  it('第 2、3 关均为 14 basic + 4 fast + 2 armor', () => {
    [CLASSIC_LEVELS[1]!, CLASSIC_LEVELS[2]!].forEach((level) => {
      const q = level.enemyQueue;
      expect(q.filter((k) => k === 'basic')).toHaveLength(14);
      expect(q.filter((k) => k === 'fast')).toHaveLength(4);
      expect(q.filter((k) => k === 'armor')).toHaveLength(2);
    });
  });
});

describe('parseLevel 校验', () => {
  it('接受合法的 26×26 网格与 20 长度敌人队列', () => {
    const level = parseLevel(99, VALID_GRID, VALID_ENEMY_QUEUE);
    expect(level.stage).toBe(99);
    expect(level.grid).toHaveLength(GRID);
    expect(level.enemyQueue).toHaveLength(20);
  });

  it('行数不对时 throw，且信息含行数', () => {
    const badGrid = Array.from({ length: GRID - 1 }, () => '.'.repeat(GRID)).join('\n');
    expect(() => parseLevel(1, badGrid, VALID_ENEMY_QUEUE)).toThrow(/行数/);
  });

  it('某行长度不对时 throw，且信息含行号', () => {
    const rows = Array.from({ length: GRID }, () => '.'.repeat(GRID));
    rows[5] = '.'.repeat(GRID - 1);
    const badGrid = rows.join('\n');
    expect(() => parseLevel(1, badGrid, VALID_ENEMY_QUEUE)).toThrow(/第 6 行/);
  });

  it('非法字符时 throw，且信息含行列号', () => {
    const rows = Array.from({ length: GRID }, () => '.'.repeat(GRID));
    rows[2] = '.'.repeat(3) + 'X' + '.'.repeat(GRID - 4);
    const badGrid = rows.join('\n');
    expect(() => parseLevel(1, badGrid, VALID_ENEMY_QUEUE)).toThrow(/第 3 行第 4 列.*'X'/);
  });

  it('基地区域被占用时 throw', () => {
    const rows = Array.from({ length: GRID }, () => '.'.repeat(GRID));
    // BASE.cell = (col:12, row:24)：把左上角格改成砖墙
    const r = rows[24]!;
    rows[24] = r.slice(0, 12) + 'B' + r.slice(13);
    const badGrid = rows.join('\n');
    expect(() => parseLevel(1, badGrid, VALID_ENEMY_QUEUE)).toThrow(/基地区域/);
  });

  it('敌人出生区被占用时 throw', () => {
    const rows = Array.from({ length: GRID }, () => '.'.repeat(GRID));
    // WAVE.spawnCells[0] = (col:0, row:0)
    rows[0] = 'S' + rows[0]!.slice(1);
    const badGrid = rows.join('\n');
    expect(() => parseLevel(1, badGrid, VALID_ENEMY_QUEUE)).toThrow(/出生区/);
  });

  it('玩家出生区被占用时 throw', () => {
    const rows = Array.from({ length: GRID }, () => '.'.repeat(GRID));
    // PLAYER.spawnCell = (col:8, row:24)
    const r = rows[24]!;
    rows[24] = r.slice(0, 8) + 'S' + r.slice(9);
    const badGrid = rows.join('\n');
    expect(() => parseLevel(1, badGrid, VALID_ENEMY_QUEUE)).toThrow(/玩家出生区/);
  });

  it('enemyQueue 长度不为 20 时 throw', () => {
    expect(() => parseLevel(1, VALID_GRID, VALID_ENEMY_QUEUE.slice(0, 19))).toThrow(/enemyQueue/);
  });
});
