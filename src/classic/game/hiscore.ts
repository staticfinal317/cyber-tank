/**
 * 经典复刻 · HI-SCORE 本地持久化（纯逻辑，可脱离 DOM 单测）
 *
 * 只依赖注入的 Storage 风格接口（getItem/setItem），不直接引用 window.localStorage——
 * 生产环境由调用方（ClassicGame）注入 window.localStorage，测试注入假对象，
 * 因此本模块可在 node 环境直接单测，无需 jsdom。
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const HI_SCORE_STORAGE_KEY = 'tank-battle.hi-score';

/** 十进制非负整数字符串的严格匹配：不接受符号、小数点、空白或其他字符 */
const DECIMAL_INTEGER = /^\d+$/;

/**
 * 读取 HI-SCORE。以下情况一律按 0 处理：键不存在、值不是纯十进制数字串（含负号/小数/空白/
 * 非数字字符）、或解析结果不是非负整数——绝不抛错，调用方无需 try/catch。
 */
export function readHiScore(storage: StorageLike): number {
  let raw: string | null;
  try {
    raw = storage.getItem(HI_SCORE_STORAGE_KEY);
  } catch {
    return 0;
  }
  if (raw === null || !DECIMAL_INTEGER.test(raw)) return 0;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** 写入 HI-SCORE；storage.setItem 抛异常（隐私模式/存储配额超限等）时静默忽略，不影响游戏流程 */
export function writeHiScore(storage: StorageLike, score: number): void {
  try {
    storage.setItem(HI_SCORE_STORAGE_KEY, String(score));
  } catch {
    // 静默忽略：HI-SCORE 是锦上添花的记录，持久化失败不应中断游戏
  }
}

/**
 * 若 candidateScore 打破当前记录则写入并返回新记录；否则不写入，原样返回当前记录。
 * ClassicGame 在 gameOver/allClear 时调用，用总分作为 candidateScore。
 */
export function recordHiScoreIfHigher(storage: StorageLike, candidateScore: number): number {
  const current = readHiScore(storage);
  if (candidateScore > current) {
    writeHiScore(storage, candidateScore);
    return candidateScore;
  }
  return current;
}

/** 会话内存实现：window.localStorage 不可用（隐私模式禁止站点数据）时的降级方案 */
export function createMemoryStorage(): StorageLike {
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
  };
}
