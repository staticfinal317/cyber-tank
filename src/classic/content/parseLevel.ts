/**
 * 经典复刻 · 关卡文本解析与校验（内容层，不改动 core/ 契约）
 *
 * 网格文本约定：26 行 × 26 字符，字符集见 core/types.ts 的 TERRAIN_CHARS；
 * 基地与三处出生点位置固定（core/constants.ts），网格文本中对应区域必须为空地。
 */
import { TERRAIN_CHARS, type EnemyKind, type LevelData } from '../core/types';
import { BASE, GRID, PLAYER, WAVE } from '../core/constants';

function assertEmptyZone(
  rows: readonly string[],
  stage: number,
  colStart: number,
  rowStart: number,
  label: string
): void {
  for (let dr = 0; dr < 2; dr++) {
    for (let dc = 0; dc < 2; dc++) {
      const row = rowStart + dr;
      const col = colStart + dc;
      const ch = rows[row]![col];
      if (ch !== '.') {
        throw new Error(
          `parseLevel: 关卡 ${stage} 的${label}（第 ${row + 1} 行第 ${col + 1} 列）必须为空地 '.'，实际为 '${ch}'`
        );
      }
    }
  }
}

/**
 * 校验并构造关卡数据。任何违规直接 throw，错误信息含 1-based 行列号。
 * 校验规则：
 * 1. 恰 26 行，每行恰 26 字符；
 * 2. 字符须 ∈ TERRAIN_CHARS；
 * 3. 基地 2×2、三个敌人出生区 2×2、玩家出生区 2×2 必须全为 '.'；
 * 4. enemyQueue 长度恰为 WAVE.totalEnemies（20）。
 */
export function parseLevel(stage: number, gridText: string, enemyQueue: EnemyKind[]): LevelData {
  const rows = gridText.split('\n');
  if (rows.length !== GRID) {
    throw new Error(`parseLevel: 关卡 ${stage} 网格行数须为 ${GRID}，实际 ${rows.length} 行`);
  }

  for (let row = 0; row < rows.length; row++) {
    const line = rows[row]!;
    if (line.length !== GRID) {
      throw new Error(`parseLevel: 关卡 ${stage} 第 ${row + 1} 行长度须为 ${GRID} 字符，实际 ${line.length} 字符`);
    }
    for (let col = 0; col < line.length; col++) {
      const ch = line[col]!;
      if (!Object.prototype.hasOwnProperty.call(TERRAIN_CHARS, ch)) {
        throw new Error(`parseLevel: 关卡 ${stage} 第 ${row + 1} 行第 ${col + 1} 列出现非法字符 '${ch}'`);
      }
    }
  }

  assertEmptyZone(rows, stage, BASE.cell.col, BASE.cell.row, '基地区域');
  WAVE.spawnCells.forEach((cell, i) => {
    assertEmptyZone(rows, stage, cell.col, cell.row, `第 ${i + 1} 个敌人出生区`);
  });
  PLAYER.spawnCells.forEach((cell, i) => {
    assertEmptyZone(rows, stage, cell.col, cell.row, `P${i + 1} 玩家出生区`);
  });

  if (enemyQueue.length !== WAVE.totalEnemies) {
    throw new Error(`parseLevel: 关卡 ${stage} enemyQueue 长度须为 ${WAVE.totalEnemies}，实际 ${enemyQueue.length}`);
  }

  return {
    stage,
    grid: rows,
    enemyQueue: [...enemyQueue],
  };
}
