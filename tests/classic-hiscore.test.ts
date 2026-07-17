import { describe, expect, it } from 'vitest';
import {
  HI_SCORE_STORAGE_KEY,
  createMemoryStorage,
  readHiScore,
  recordHiScoreIfHigher,
  writeHiScore,
  type StorageLike,
} from '../src/classic/game/hiscore';

/** 内存版 StorageLike：模拟 localStorage 的最小行为，不依赖 DOM */
class MemoryStorage implements StorageLike {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

/** setItem 恒抛异常的 StorageLike：模拟隐私模式/存储配额超限 */
class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    return null;
  }

  setItem(): never {
    throw new Error('QuotaExceededError（模拟）');
  }
}

/** 包一层调用计数的 MemoryStorage：用于断言"是否真的发生了写入"，而非只看最终值 */
class SpyStorage extends MemoryStorage {
  setItemCallCount = 0;

  override setItem(key: string, value: string): void {
    this.setItemCallCount += 1;
    super.setItem(key, value);
  }
}

describe('hiscore · HI-SCORE 本地持久化（纯逻辑，可脱离 DOM 单测）', () => {
  describe('readHiScore', () => {
    it('首次无记录（getItem 返回 null）：按 0 处理', () => {
      const storage = new MemoryStorage();
      expect(readHiScore(storage)).toBe(0);
    });

    it('正常读取：写入过的合法十进制字符串按数值返回', () => {
      const storage = new MemoryStorage();
      storage.setItem(HI_SCORE_STORAGE_KEY, '12345');
      expect(readHiScore(storage)).toBe(12345);
    });

    it('值为 "0"：按 0 处理（合法值而非损坏值）', () => {
      const storage = new MemoryStorage();
      storage.setItem(HI_SCORE_STORAGE_KEY, '0');
      expect(readHiScore(storage)).toBe(0);
    });

    it('前导零：按纯数字解析（"007" → 7）', () => {
      const storage = new MemoryStorage();
      storage.setItem(HI_SCORE_STORAGE_KEY, '007');
      expect(readHiScore(storage)).toBe(7);
    });

    it.each([
      ['空字符串', ''],
      ['负数', '-5'],
      ['小数', '12.5'],
      ['非数字字符', 'abc'],
      ['带符号的正数', '+5'],
      ['前后空白', ' 12 '],
      ['科学计数法字符串', '1e3'],
      ['十六进制前缀', '0x10'],
    ])('损坏值（%s：%j）：一律按 0 处理，不抛错', (_label, raw) => {
      const storage = new MemoryStorage();
      storage.setItem(HI_SCORE_STORAGE_KEY, raw);
      expect(readHiScore(storage)).toBe(0);
    });
  });

  describe('writeHiScore', () => {
    it('正常写入：setItem 收到键与十进制字符串值', () => {
      const storage = new MemoryStorage();
      writeHiScore(storage, 999);
      expect(storage.getItem(HI_SCORE_STORAGE_KEY)).toBe('999');
    });

    it('setItem 抛异常（隐私模式/配额超限）：静默忽略，不向上抛错', () => {
      const storage = new ThrowingStorage();
      expect(() => writeHiScore(storage, 100)).not.toThrow();
    });
  });

  describe('recordHiScoreIfHigher', () => {
    it('首次无记录，candidate > 0：写入并返回 candidate', () => {
      const storage = new MemoryStorage();
      const result = recordHiScoreIfHigher(storage, 500);
      expect(result).toBe(500);
      expect(readHiScore(storage)).toBe(500);
    });

    it('candidate 高于当前记录：调用一次 setItem 写入并返回新记录', () => {
      const storage = new SpyStorage();
      storage.setItem(HI_SCORE_STORAGE_KEY, '100');
      const result = recordHiScoreIfHigher(storage, 200);
      expect(result).toBe(200);
      expect(readHiScore(storage)).toBe(200);
      expect(storage.setItemCallCount).toBe(2); // 初始 setItem 一次 + 打破记录写入一次
    });

    it('candidate 等于当前记录：不调用 setItem，原样返回当前记录', () => {
      const storage = new SpyStorage();
      storage.setItem(HI_SCORE_STORAGE_KEY, '300');
      storage.setItemCallCount = 0; // 重置，只统计 recordHiScoreIfHigher 内部的写入
      const result = recordHiScoreIfHigher(storage, 300);
      expect(result).toBe(300);
      expect(storage.setItemCallCount).toBe(0); // 未打破记录，不应发生写入
      expect(readHiScore(storage)).toBe(300);
    });

    it('candidate 低于当前记录：不调用 setItem，返回当前记录（而非 candidate）', () => {
      const storage = new SpyStorage();
      storage.setItem(HI_SCORE_STORAGE_KEY, '999');
      storage.setItemCallCount = 0;
      const result = recordHiScoreIfHigher(storage, 1);
      expect(result).toBe(999);
      expect(storage.setItemCallCount).toBe(0);
      expect(readHiScore(storage)).toBe(999);
    });

    it('setItem 抛异常但 candidate 打破记录：仍返回 candidate（尝试持久化即视为完成），不抛错', () => {
      const storage = new ThrowingStorage();
      expect(() => {
        const result = recordHiScoreIfHigher(storage, 100);
        expect(result).toBe(100);
      }).not.toThrow();
    });
  });

  describe('getItem 抛异常（站点数据被禁止等）', () => {
    const brokenStorage: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError（模拟）');
      },
      setItem: () => undefined,
    };

    it('readHiScore 按 0 处理，不抛错', () => {
      expect(readHiScore(brokenStorage)).toBe(0);
    });

    it('recordHiScoreIfHigher 视当前记录为 0，正常比较写入，不抛错', () => {
      expect(recordHiScoreIfHigher(brokenStorage, 42)).toBe(42);
    });
  });

  describe('createMemoryStorage（localStorage 不可用时的降级实现）', () => {
    it('读写行为与 Storage 一致：未写返回 null，写后可读回', () => {
      const storage = createMemoryStorage();
      expect(storage.getItem(HI_SCORE_STORAGE_KEY)).toBeNull();
      storage.setItem(HI_SCORE_STORAGE_KEY, '777');
      expect(readHiScore(storage)).toBe(777);
    });

    it('实例之间互相隔离', () => {
      const a = createMemoryStorage();
      const b = createMemoryStorage();
      a.setItem(HI_SCORE_STORAGE_KEY, '1');
      expect(b.getItem(HI_SCORE_STORAGE_KEY)).toBeNull();
    });
  });
});
