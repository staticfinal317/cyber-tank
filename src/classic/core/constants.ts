/**
 * 经典复刻 · 全局常量（架构契约，改动需主线评审）
 *
 * 标注 [provisional] 的数值无权威公开来源（见 docs/BATTLE_CITY_REMAKE_PLAN.md 附录 A.9），
 * Alpha 阶段以 FC 逐帧实测校正；数值只允许在本文件调整，禁止在逻辑代码中散落魔法数。
 */

/** 棋盘：13×13 大格 = 26×26 半格，逻辑分辨率 208×208 px */
export const GRID = 26;
export const HALF_PX = 8;
export const FIELD_PX = GRID * HALF_PX; // 208

/** 定点数：1 逻辑 px = 16 subpx。模拟内所有坐标/速度均为整数 subpx，保证确定性 */
export const SUBPX = 16;
export const FIELD_SUB = FIELD_PX * SUBPX;
export const HALF_SUB = HALF_PX * SUBPX;

/** 模拟固定步长 60Hz */
export const TICK_RATE = 60;

/** 坦克体积：16×16 px（2×2 半格） */
export const TANK_PX = 16;
export const TANK_SUB = TANK_PX * SUBPX;

/** 子弹体积：4×4 px */
export const BULLET_PX = 4;
export const BULLET_SUB = BULLET_PX * SUBPX;

/**
 * 速度（subpx/tick）—— 校准自 FC 原版反汇编（cyneprepou4uk/NES-Games-Disassembly，bank_FF.asm）
 * 换算基准：1 tick = 1 NES 帧（NMI 每帧 INC ram_frm_cnt_lo 确认），1 px = 16 subpx。
 *
 * player: sub_DBF1_tank_movement 玩家分支按 (frm_cnt_lo&1)||!(frm_cnt_lo&3) 门控，
 *   每 4 帧调用 3 次移动分发 → 0.75 px/帧 → 12 subpx/tick。
 * enemyBasic/enemyArmor: 同一分支对非 Fast 敌方坦克按 (tank_index XOR frm_cnt_lo)&1 门控，
 *   每 2 帧调用 1 次 → 0.5 px/帧 → 8 subpx/tick。
 * enemyFast: tank_type&0xF0==0xA0 时跳过门控，每帧必调用 → 1.0 px/帧 → 16 subpx/tick。
 * enemyPower: 反汇编中与 Basic/Armor 共用同一门控分支（未被识别为独立档位），
 *   与 newagebegins/BattleCity 的 EnemyFactory.js 交叉验证一致
 *   （Basic/Armor 显式 setMoveFrequency(2)，Power 未覆盖任何速度/频率，与默认档一致）。
 * bulletSlow/bulletFast: sub_E063（tbl_E46C/E470 方向表，值 ±1，ASL 后 ±2）每帧写入
 *   ram_bullet_pos_X/Y；ofs_002_E051_40 对 property==0 的子弹每帧调用 1 次（2px/帧），
 *   property!=0（1★+/加农坦克）每帧调用 2 次（4px/帧，恰为 2 倍而非 1.5 倍）。
 */
export const SPEED = {
  player: 12,
  enemyBasic: 8,
  enemyFast: 16,
  enemyPower: 8,
  enemyArmor: 8,
  bulletSlow: 32, // 玩家 0 星 / 敌方基础、Fast、Armor
  bulletFast: 64, // 玩家 1 星+ / 加农（Power）坦克
} as const;

/** 敌方配置（分值/耐久为考据确认值，速度引用 SPEED） */
export const ENEMY = {
  basic: { hp: 1, score: 100, speed: SPEED.enemyBasic, bulletSpeed: SPEED.bulletSlow },
  fast: { hp: 1, score: 200, speed: SPEED.enemyFast, bulletSpeed: SPEED.bulletSlow },
  power: { hp: 1, score: 300, speed: SPEED.enemyPower, bulletSpeed: SPEED.bulletFast },
  armor: { hp: 4, score: 400, speed: SPEED.enemyArmor, bulletSpeed: SPEED.bulletSlow },
} as const;

/** 波次规则（考据确认：每关 20 敌、场上 4、闪烁坦克为第 4/11/18 辆） */
export const WAVE = {
  totalEnemies: 20,
  maxAlive: 4,
  /** 0-based 序号：第 4、11、18 辆 */
  flashIndices: [3, 10, 17] as readonly number[],
  /** 出生点半格坐标（col,row）：左上/中上/右上 */
  spawnCells: [
    { col: 0, row: 0 },
    { col: 12, row: 0 },
    { col: 24, row: 0 },
  ] as readonly { col: number; row: number }[],
  /**
   * 敌人出生动画（星星）时长，期间不可交互。
   * 反汇编：ram_tank_flags 0xF0→0xE0 两阶段状态机，每阶段计数到 0x0E(14) 才转换
   * （sub_DC3D_tank_status_handler 经 ofs_000_DE55_F0_respawn / ofs_000_DE64_E0 分发）。
   * 该分发本身仍受 SPEED 注释所述的敌方节流门控：多数敌人（Basic/Power/Armor）
   * 每 2 帧 1 次 → 单阶段 28 帧 × 2 阶段 = 56 帧；Fast 敌人每帧 1 次 → 共 28 帧。
   * 本项目 spawningTicks 不区分坦克类型，取占比更高的 Basic/Power/Armor 档位校准。
   */
  spawnStarTicks: 56,
  /**
   * 相邻两次敌人投放的最小间隔。
   * 反汇编：ram_enemy_spawn_interval = 190 - stage*4（1P 模式，sub_C2E6 关卡初始化段，
   * 0x0003A2-0x0003B2），第 1 关取值 186；ram_enemy_timer_before_spawn 每帧递减 1
   * （sub_DB48_enemy_spawn_handler 主循环内无门控地每帧调用）。原版随关卡推进逐关变快
   * （35 关时降至 50），本项目仅实现前 3 关，按第 1 关取值校准为定值。
   */
  spawnIntervalTicks: 186,
} as const;

/** 玩家规则 */
export const PLAYER = {
  /** 备用命数；合计 3 辆与 FC 原版一致（原版 ram_lives 初值为 3，含当前场上这辆） */
  initialLives: 2,
  /** 出生点半格坐标（col,row）：基地左侧（原版 P1 位置） */
  spawnCell: { col: 8, row: 24 },
  /**
   * 出生/复活无敌时长。反汇编：sub_E3B8（出生状态机 F0→E0 结束后调用）对玩家写入
   * ram_helmet_timer=3，与 POWERUP.helmetTicks 共用同一计时器、同一 64 帧/单位递减速率
   * （sub_E27C_players_invincibility_handler，AND #$3F 门控）→ 3*64=192。
   * 首次出生与关内复活均经同一状态机路径，数值一致，无需区分。
   */
  spawnShieldTicks: 192,
  /** 0-1 星同屏 1 发，2 星起 2 发（考据确认） */
  maxBullets: [1, 1, 2, 2] as readonly number[],
  /** 每 20000 分奖 1 命（FC 版，考据确认） */
  extraLifeScore: 20000,
} as const;

/**
 * 道具规则（拾取 +500 分为考据确认）。
 * 时长校准自反汇编 tbl_E9E2_bonus_pickup_handler：
 *   helmet(ofs_bonus_E9F0) 初值 0x0A(10)、clock(ofs_bonus_E9F5) 初值 0x0A(10) 均写入
 *   与 ram_helmet_timer/ram_clock_timer 相同的计时器，按 64 帧/单位递减
 *   （helmet: sub_E27C AND #$3F；clock: sub_DBF1_tank_movement 顶部 AND #$3F）→ 10*64=640。
 *   shovel(ofs_bonus_E9FB) 初值 0x14(20)，ram_shovel_timer 同样按 64 帧/单位递减
 *   （sub_E2A9_HQ_handler 内层 AND #$3F 门控）→ 20*64=1280。
 */
export const POWERUP = {
  score: 500,
  helmetTicks: 640,
  clockTicks: 640,
  shovelTicks: 1280,
  /**
   * 铁锹失效前钢/砖闪烁提示时长。反汇编：sub_E2A9_HQ_handler 中 shovel_timer<4
   * （CMP #$04, BCS 跳过闪烁）时才进入闪烁分支，即最后 3 个单位 × 64 帧 = 192。
   */
  shovelBlinkTicks: 192,
} as const;

/** 基地（老鹰）：占 2×2 半格，底边居中（原版位置），左上角为 cell */
export const BASE = {
  cell: { col: 12, row: 24 },
  /** 基地围墙半格坐标（左/上/右三面，底边贴场地边界；铁锹改写此范围） */
  wallCells: [
    { col: 11, row: 23 }, { col: 12, row: 23 }, { col: 13, row: 23 }, { col: 14, row: 23 },
    { col: 11, row: 24 }, { col: 14, row: 24 },
    { col: 11, row: 25 }, { col: 14, row: 25 },
  ] as readonly { col: number; row: number }[],
} as const;

/**
 * 冰面打滑：松开方向后惯性滑行时长 [provisional]，未找到权威来源。
 * 反汇编中 sub_E181_ice_detection/sub_DB75_ice_movement 确认冰面机制存在，但其"锁定转向"
 * 状态打包在 ram_0103_plr_flags 的多个 bit（0x80/0x10/0x1F）中，并非单一递减计数器；
 * 唯一发现的类似计时器 ram_plr_stun_timer=0xC8(200) 实为子弹贴近判定触发的"受击僵直"
 * （sub_E8xx，与冰面无关），为避免张冠李戴未采用。未能提炼出可信的单一 tick 数值。
 */
export const ICE_SLIDE_TICKS = 24;

/**
 * 爆炸动画帧数（渲染层节奏参考）[provisional]，未找到权威来源。
 * 反汇编中坦克爆炸+得分显示为 ram_tank_flags 0x70→0x00 的 7 阶段状态机
 * （ofs_000_DDEA_*_explosion），每阶段计数 16 次才推进，且该分发仍受玩家/敌方
 * 类型相关的节流门控影响（同 SPEED 注释），实际时长因坦克类型而异，
 * 无法归约为本项目 small/big 两档单一数值；子弹爆炸对应的 bullet_status 子状态机
 * 亦未完整追踪，故两项均维持 provisional。
 */
export const FX = {
  smallExplosionTicks: 12,
  bigExplosionTicks: 24,
} as const;
