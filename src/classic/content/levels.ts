/**
 * 经典复刻 · 第 1-3 关数据（FC 原版 1:1 转写）
 *
 * 地图来源：github.com/newagebegins/BattleCity（开源 JS 复刻）src/Stages.js
 *   https://raw.githubusercontent.com/newagebegins/BattleCity/master/src/Stages.js
 *   坐标换算：col = (x-32)/16，row = (y-16)/16（该复刻场地原点偏移 UNIT_SIZE/TILE_SIZE，
 *   换算后基地落于 (12,24)、围墙 8 格、三处出生区与玩家出生区均落在空地——
 *   与本项目 core/constants.ts 的 BASE/WAVE/PLAYER 常量逐格吻合，视为可信的布局转写来源）。
 *   仅参考其关卡布局与敌人类型数据，未复制其代码实现。
 * 敌人构成交叉验证：GameFAQs 《Battle City》攻略 by Brian Sulpher（NES FAQ v1.2）
 *   https://gamefaqs.gamespot.com/nes/562966-battle-city/faqs/29287
 *   第 1 关：Basic 18 / Strike(=fast) 2 / Medium(=power) 0 / Heavy(=armor) 0
 *   第 2 关：Basic 14 / Strike 4 / Medium 0 / Heavy 2
 *   第 3 关：Basic 14 / Strike 4 / Medium 0 / Heavy 2
 *   与 newagebegins 复刻的敌人类型数量逐一吻合（两独立来源交叉确认，仅计数一致）。
 * 敌人出场顺序权威确认：cyneprepou4uk/NES-Games-Disassembly（bank_FF.asm）
 *   tbl_E4EC_stage_enemies（每关 4 个类型字节，按 Basic/Fast/Power/Armor 槽位排列）
 *   与 tbl_E578_stage_enemies_type_counter（对应每类型出场只数），经 sub_E42B_
 *   prepare_enemy_tanks_for_stage 初始化、sub_E3B8 按槽位顺序依次消费——
 *   即原版出场序为「按类型分组、按表内槽位顺序」而非随机交错。
 *   第 1 关 = [Basic×18, Fast×2]；第 2 关 = [Armor×2, Fast×4, Basic×14]（Power 计数为 0，跳过）；
 *   第 3 关 = [Basic×14, Fast×4, Armor×2]（Power 计数为 0，跳过）——
 *   与下方 STAGE_N_ENEMIES 数组逐字节比对完全一致，故沿用 newagebegins 顺序无需改动。
 */
import type { LevelData } from '../core/types';
import { parseLevel } from './parseLevel';

const STAGE_1_GRID = `\
..........................
..........................
..BB..BB..BB..BB..BB..BB..
..BB..BB..BB..BB..BB..BB..
..BB..BB..BB..BB..BB..BB..
..BB..BB..BB..BB..BB..BB..
..BB..BB..BBSSBB..BB..BB..
..BB..BB..BBSSBB..BB..BB..
..BB..BB..BB..BB..BB..BB..
..BB..BB..........BB..BB..
..BB..BB..........BB..BB..
..........BB..BB..........
..........BB..BB..........
BB..BBBB..........BBBB..BB
SS..BBBB..........BBBB..SS
..........BB..BB..........
..........BBBBBB..........
..BB..BB..BBBBBB..BB..BB..
..BB..BB..BB..BB..BB..BB..
..BB..BB..BB..BB..BB..BB..
..BB..BB..BB..BB..BB..BB..
..BB..BB..........BB..BB..
..BB..BB..........BB..BB..
..BB..BB...BBBB...BB..BB..
...........B..B...........
...........B..B...........`;

// 第 1 关：18 basic + 2 fast（GameFAQs 计数确认 + 反汇编 tbl_E4EC/E578 顺序确认）
const STAGE_1_ENEMIES = [
  'basic', 'basic', 'basic', 'basic', 'basic', 'basic', 'basic', 'basic', 'basic',
  'basic', 'basic', 'basic', 'basic', 'basic', 'basic', 'basic', 'basic', 'basic',
  'fast', 'fast',
] as const;

const STAGE_2_GRID = `\
......SS......SS..........
......SS......SS..........
..BB..SS......BB..BB..BB..
..BB..SS......BB..BB..BB..
..BB........BBBB..BBSSBB..
..BB........BBBB..BBSSBB..
......BB..........SS......
......BB..........SS......
T.....BB....SS....BBT.BBSS
......BB....SS....BB..BBSS
T.T.......BB....SS..T.....
..........BB....SS........
..BBBBBBT.T.T.SS....T.BB..
..BBBBBB......SS......BB..
......SST.BB..BB..BB..BB..
......SS..BB..BB..BB..BB..
SSBB..SS..BB..BB......BB..
SSBB..SS..BB..BB......BB..
..BB..BB..BBBBBB..BBSSBB..
..BB..BB..BBBBBB..BBSSBB..
..BB..BB..BBBBBB..........
..BB..BB..BBBBBB..........
..BB..............BB..BB..
..BB.......BBBB...BB..BB..
..BB..BB...B..B...BBBBBB..
..BB..BB...B..B...BBBBBB..`;

// 第 2 关：2 armor + 4 fast + 14 basic（GameFAQs 计数确认 + 反汇编 tbl_E4EC/E578 顺序确认）
const STAGE_2_ENEMIES = [
  'armor', 'armor', 'fast', 'fast', 'fast', 'fast',
  'basic', 'basic', 'basic', 'basic', 'basic', 'basic', 'basic',
  'basic', 'basic', 'basic', 'basic', 'basic', 'basic', 'basic',
] as const;

const STAGE_3_GRID = `\
........BB......BB........
........BB......BB........
..T.T.T.BB................
........BB..........SSSSSS
BBT.T.T...................
BB........................
T.T.T.T.......BB..BBBBBBB.
..............BB..BBBBBBB.
T.T.T.T.BBBBBBBB..BB...B..
........BBBBBB....BB...B..
T.T.T.T.....BB.........B..
............BB.........B..
..T.........SSSSSS....T...
............SSSSSS........
..................T.T.T.T.
..BB..BB..................
BBB..BBBB..BBBBBBBT.T.T.T.
BBB..BBBB..B..............
..........BB......T.T.T.T.
..........BB..BBBB........
BB....S.......BBBBT.T.T...
BB....S...................
BBBB..S...........T.T.T...
BBBB..S....BBBB...........
SSBBBB.....B..B...BB......
SSBBBB.....B..B...BB......`;

// 第 3 关：14 basic + 4 fast + 2 armor（GameFAQs 计数确认 + 反汇编 tbl_E4EC/E578 顺序确认）
const STAGE_3_ENEMIES = [
  'basic', 'basic', 'basic', 'basic', 'basic', 'basic', 'basic',
  'basic', 'basic', 'basic', 'basic', 'basic', 'basic', 'basic',
  'fast', 'fast', 'fast', 'fast', 'armor', 'armor',
] as const;

export const CLASSIC_LEVELS: LevelData[] = [
  parseLevel(1, STAGE_1_GRID, [...STAGE_1_ENEMIES]),
  parseLevel(2, STAGE_2_GRID, [...STAGE_2_ENEMIES]),
  parseLevel(3, STAGE_3_GRID, [...STAGE_3_ENEMIES]),
];
