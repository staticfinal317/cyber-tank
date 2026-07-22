/**
 * 经典复刻 · 联机种子派生（纯函数，无浏览器 API）
 *
 * 联机开局只需同步一个 masterSeed；每关的 stageSeed 由 masterSeed 与
 * stageIndex 确定性派生，两端各自计算即可得到相同值，无需逐关同步。
 */
import { FNV_INIT, fnvInt32 } from '../sim/hash';

/** 由 masterSeed 与 stageIndex 派生该关的 RNG 种子（无符号 32 位） */
export function deriveStageSeed(masterSeed: number, stageIndex: number): number {
  const h = fnvInt32(FNV_INIT, masterSeed >>> 0);
  return fnvInt32(h, stageIndex >>> 0) >>> 0;
}
