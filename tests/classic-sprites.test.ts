import { describe, expect, it } from 'vitest';
import {
  spriteFrameCount,
  spriteKeys,
  spritePalette,
  spritePixels,
  type SpriteKey,
} from '../src/classic/render/sprites';

interface Expected {
  w: number;
  h: number;
  frames: number;
}

// M4 精灵清单（尺寸/帧数）：与任务书"精灵清单"逐项对应
const EXPECTED: Record<SpriteKey, Expected> = {
  'tank.player.l0': { w: 16, h: 16, frames: 2 },
  'tank.player.l1': { w: 16, h: 16, frames: 2 },
  'tank.player.l2': { w: 16, h: 16, frames: 2 },
  'tank.player.l3': { w: 16, h: 16, frames: 2 },
  'tank.enemy.basic': { w: 16, h: 16, frames: 2 },
  'tank.enemy.fast': { w: 16, h: 16, frames: 2 },
  'tank.enemy.power': { w: 16, h: 16, frames: 2 },
  'tank.enemy.armor': { w: 16, h: 16, frames: 2 },
  'tank.enemy.armor.hp3': { w: 16, h: 16, frames: 2 },
  'tank.enemy.armor.hp2': { w: 16, h: 16, frames: 2 },
  'tank.enemy.armor.hp1': { w: 16, h: 16, frames: 2 },
  'tank.enemy.basic.flash': { w: 16, h: 16, frames: 2 },
  'tank.enemy.fast.flash': { w: 16, h: 16, frames: 2 },
  'tank.enemy.power.flash': { w: 16, h: 16, frames: 2 },
  'tank.enemy.armor.flash': { w: 16, h: 16, frames: 2 },
  bullet: { w: 4, h: 4, frames: 1 },
  'terrain.brick': { w: 8, h: 8, frames: 1 },
  'terrain.steel': { w: 8, h: 8, frames: 1 },
  'terrain.water': { w: 8, h: 8, frames: 2 },
  'terrain.trees': { w: 8, h: 8, frames: 1 },
  'terrain.ice': { w: 8, h: 8, frames: 1 },
  'base.alive': { w: 16, h: 16, frames: 1 },
  'base.dead': { w: 16, h: 16, frames: 1 },
  'fx.spawn': { w: 16, h: 16, frames: 4 },
  'fx.explosion.small': { w: 16, h: 16, frames: 3 },
  'fx.explosion.big': { w: 32, h: 32, frames: 2 },
  'fx.shield': { w: 16, h: 16, frames: 2 },
  'powerup.star': { w: 16, h: 16, frames: 1 },
  'powerup.grenade': { w: 16, h: 16, frames: 1 },
  'powerup.helmet': { w: 16, h: 16, frames: 1 },
  'powerup.clock': { w: 16, h: 16, frames: 1 },
  'powerup.shovel': { w: 16, h: 16, frames: 1 },
  'powerup.tank': { w: 16, h: 16, frames: 1 },
  'hud.enemyIcon': { w: 8, h: 8, frames: 1 },
  'hud.lifeIcon': { w: 8, h: 8, frames: 1 },
};

const EXPECTED_KEYS = Object.keys(EXPECTED);

describe('classic sprites · spriteKeys()', () => {
  it('覆盖任务清单全部 key，且不多不少', () => {
    const keys = new Set(spriteKeys());
    for (const key of EXPECTED_KEYS) expect(keys.has(key)).toBe(true);
    expect(keys.size).toBe(EXPECTED_KEYS.length);
  });
});

describe('classic sprites · spritePixels() 纯数据完整性', () => {
  for (const key of EXPECTED_KEYS) {
    const { w, h, frames } = EXPECTED[key]!;

    it(`${key}: 帧数 = ${frames}`, () => {
      expect(spriteFrameCount(key)).toBe(frames);
    });

    it(`${key}: 每帧行数=${h}、行宽=${w}、字符 ⊆ 调色板∪{'.'}`, () => {
      const palette = spritePalette(key);
      for (let f = 0; f < frames; f += 1) {
        const rows = spritePixels(key, f);
        expect(rows).toHaveLength(h);
        for (const row of rows) {
          expect(row).toHaveLength(w);
          for (const ch of row) {
            expect(ch === '.' || ch in palette).toBe(true);
          }
        }
      }
    });

    it(`${key}: 帧索引越界时 throw`, () => {
      expect(() => spritePixels(key, frames)).toThrow();
    });
  }

  it('未知 key 访问 spritePixels/spriteFrameCount/spritePalette 均 throw', () => {
    expect(() => spritePixels('not.a.real.key')).toThrow();
    expect(() => spriteFrameCount('not.a.real.key')).toThrow();
    expect(() => spritePalette('not.a.real.key')).toThrow();
  });
});

describe('classic sprites · 调色板换色变体', () => {
  it('装甲坦克受击变色 hp3/hp2/hp1 与本体（满血）像素形状完全一致，仅调色板不同', () => {
    const base = ['tank.enemy.armor.hp3', 'tank.enemy.armor.hp2', 'tank.enemy.armor.hp1'];
    for (const variant of base) {
      expect(spritePixels(variant, 0)).toEqual(spritePixels('tank.enemy.armor', 0));
      expect(spritePixels(variant, 1)).toEqual(spritePixels('tank.enemy.armor', 1));
      expect(spritePalette(variant)).not.toEqual(spritePalette('tank.enemy.armor'));
    }
    // hp3/hp2/hp1 两两调色板也应互不相同（绿→黄→浅绿→灰四段式变色）
    expect(spritePalette('tank.enemy.armor.hp3')).not.toEqual(spritePalette('tank.enemy.armor.hp2'));
    expect(spritePalette('tank.enemy.armor.hp2')).not.toEqual(spritePalette('tank.enemy.armor.hp1'));
  });

  it('闪烁坦克 flash 变体与对应本体 kind 像素形状完全一致，仅调色板不同（统一红色闪烁）', () => {
    const kinds = ['basic', 'fast', 'power', 'armor'] as const;
    let flashPaletteRef: Record<string, string> | null = null;
    for (const kind of kinds) {
      const baseKey = `tank.enemy.${kind}`;
      const flashKey = `tank.enemy.${kind}.flash`;
      expect(spritePixels(flashKey, 0)).toEqual(spritePixels(baseKey, 0));
      expect(spritePixels(flashKey, 1)).toEqual(spritePixels(baseKey, 1));
      expect(spritePalette(flashKey)).not.toEqual(spritePalette(baseKey));
      const flashPalette = spritePalette(flashKey);
      if (flashPaletteRef) expect(flashPalette).toEqual(flashPaletteRef);
      flashPaletteRef = flashPalette as Record<string, string>;
    }
  });

  it('玩家坦克 4 个星级形状随等级递进（炮管/侧裙甲不完全相同），但均为合法 16×16 两帧', () => {
    const shapes = [0, 1, 2, 3].map((lv) => spritePixels(`tank.player.l${lv}`, 0));
    // 至少存在一处像素随星级变化（侧裙甲/炮管递增），四份形状不能完全相同
    const allIdentical = shapes.every((s) => JSON.stringify(s) === JSON.stringify(shapes[0]));
    expect(allIdentical).toBe(false);
  });
});

describe('classic sprites · 履带动画 2 帧确实不同', () => {
  it('坦克类精灵的两帧履带图案存在差异（否则动画无意义）', () => {
    const tankKeys = EXPECTED_KEYS.filter((k) => k.startsWith('tank.'));
    for (const key of tankKeys) {
      const f0 = spritePixels(key, 0);
      const f1 = spritePixels(key, 1);
      expect(f0).not.toEqual(f1);
    }
  });
});
