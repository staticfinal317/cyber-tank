/**
 * 经典复刻 · 流程界面覆盖层（M6）
 *
 * DOM 覆盖层，与渲染 canvas 共享同一容器；像素风格视觉（等宽字体/大号/高对比），
 * 文案面向儿童、简体中文，全部界面键盘可达、无鼠标依赖。
 * 纯 DOM 副作用层：只负责"显示什么"，不做任何流程判断——由 ClassicGame 按 FSM 状态调用。
 */
import type { EnemyKind } from '../core/types';

const FONT_FAMILY = '"Courier New", ui-monospace, monospace';

/** 敌方坦克中文命名，沿用 sim/ai.ts 注释与 docs/BATTLE_CITY_REMAKE_PLAN.md §1.4 既有命名 */
const ENEMY_KIND_LABELS: Readonly<Record<EnemyKind, string>> = {
  basic: '基础坦克',
  fast: '快速坦克',
  power: '加农坦克',
  armor: '重型坦克',
};

/** 本关战报单行：某种敌人的击杀数 × 单价 = 小计（由 ClassicGame 从 enemyDestroyed 事件累计而来） */
export interface KillTallyRow {
  kind: EnemyKind;
  count: number;
  unitPrice: number;
  subtotal: number;
}

/** 单个玩家的结算信息：总分、本关战报、是否已出局（结算屏「出局」标注用） */
export interface PlayerResultInfo {
  totalScore: number;
  breakdown: readonly KillTallyRow[];
  out: boolean;
}

export interface StageClearInfo {
  /** 各玩家结算数据，下标即 playerIndex；长度 1 时渲染单区块（与改造前样式一致），长度 2 时纵向堆叠双区块 */
  players: readonly (PlayerResultInfo & { stageScore: number })[];
}

export interface ResultInfo {
  totalScore: number;
}

export interface GameOverInfo {
  /** 语义同 StageClearInfo.players（无 stageScore：GAME OVER 只展示总分） */
  players: readonly PlayerResultInfo[];
}

export class ScreensOverlay {
  private readonly root: HTMLDivElement;

  constructor(container: HTMLElement) {
    if (!(container instanceof HTMLElement)) {
      throw new Error('ScreensOverlay 需要合法的 container: HTMLElement');
    }
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    this.root = document.createElement('div');
    this.root.style.position = 'absolute';
    this.root.style.inset = '0';
    this.root.style.zIndex = '10';
    this.root.style.display = 'none';
    this.root.style.flexDirection = 'column';
    this.root.style.alignItems = 'center';
    this.root.style.justifyContent = 'center';
    this.root.style.gap = '12px';
    this.root.style.fontFamily = FONT_FAMILY;
    this.root.style.textAlign = 'center';
    this.root.style.userSelect = 'none';
    container.appendChild(this.root);
  }

  /** selection：菜单光标当前指向的人数（D1，纯表现态，默认 1P） */
  showMenu(hiScore: number, gamepadConnected: boolean, selection: 1 | 2 = 1): void {
    const lines = [
      this.line('坦克大作战', '32px', '#ffe400'),
      this.line(`HI-SCORE ${hiScore}`, '14px', '#a0a0a0'),
      this.menuOptionLine('1 PLAYER', selection === 1),
      this.menuOptionLine('2 PLAYERS', selection === 2),
      this.line('按 Enter 开始', '18px', '#ffffff'),
      this.line('方向键/WASD 移动 · 空格/J 开火 · Esc 暂停', '13px', '#a0a0a0'),
      this.line('双人：P1 键盘 · P2 手柄', '13px', '#a0a0a0'),
    ];
    if (gamepadConnected) {
      lines.push(this.line('手柄已连接：摇杆/十字键移动 · A 开火 · + 暂停', '13px', '#a0a0a0'));
    }
    this.render('#000000', lines);
  }

  showStageIntro(stageNumber: number): void {
    this.render('#808080', [this.line(`第 ${stageNumber} 关`, '32px', '#000000')]);
  }

  showPaused(): void {
    this.render('rgba(0,0,0,0.6)', [this.line('暂停中', '28px', '#ffffff')]);
  }

  showStageClear(info: StageClearInfo): void {
    const [solo] = info.players;
    if (info.players.length === 1 && solo) {
      // 1P 模式：单区块渲染，样式与改造前完全一致（像素级不回归）
      this.render('#000000', [
        this.line('本关通过', '28px', '#00ff66'),
        ...this.breakdownLines(solo.breakdown),
        this.line(`本关得分 ${solo.stageScore}`, '18px', '#ffffff'),
        this.line(`总分 ${solo.totalScore}`, '18px', '#ffffff'),
        this.line('按 Enter 进入下一关', '14px', '#a0a0a0'),
      ]);
      return;
    }
    this.render('#000000', [
      this.line('本关通过', '28px', '#00ff66'),
      ...info.players.flatMap((player, playerIndex) => this.playerResultBlock(playerIndex, player, player.stageScore)),
      this.line('按 Enter 进入下一关', '14px', '#a0a0a0'),
    ]);
  }

  showAllClear(info: ResultInfo): void {
    this.render('#000000', [
      this.line('恭喜通关！', '32px', '#ffe400'),
      this.line(`总分 ${info.totalScore}`, '18px', '#ffffff'),
      this.line('按 Enter 回到标题', '14px', '#a0a0a0'),
    ]);
  }

  showGameOver(info: GameOverInfo): void {
    const [solo] = info.players;
    if (info.players.length === 1 && solo) {
      // 1P 模式：单区块渲染，样式与改造前完全一致（像素级不回归）
      this.render('#000000', [
        this.line('GAME OVER', '32px', '#ff3030'),
        ...this.breakdownLines(solo.breakdown),
        this.line(`总分 ${solo.totalScore}`, '18px', '#ffffff'),
        this.line('按 Enter 回到标题', '14px', '#a0a0a0'),
      ]);
      return;
    }
    this.render('#000000', [
      this.line('GAME OVER', '32px', '#ff3030'),
      ...info.players.flatMap((player, playerIndex) => this.playerResultBlock(playerIndex, player)),
      this.line('按 Enter 回到标题', '14px', '#a0a0a0'),
    ]);
  }

  /** 隐藏覆盖层，露出下方的战斗画面 */
  hide(): void {
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }

  dispose(): void {
    this.root.remove();
  }

  private render(background: string, lines: readonly HTMLElement[]): void {
    this.root.style.background = background;
    this.root.replaceChildren(...lines);
    this.root.style.display = 'flex';
  }

  private line(text: string, fontSize: string, color: string): HTMLDivElement {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.fontSize = fontSize;
    el.style.color = color;
    el.style.fontWeight = 'bold';
    el.style.letterSpacing = '1px';
    return el;
  }

  /** 菜单选项行（D1）：当前选中项以 ▶ 光标 + 高亮色标记，未选中项留白对齐、暗色 */
  private menuOptionLine(label: string, active: boolean): HTMLDivElement {
    return this.line(`${active ? '▶ ' : '  '}${label}`, '18px', active ? '#ffffff' : '#606060');
  }

  /**
   * 单个玩家的结算区块（D3，2P 专用，纵向堆叠，不做双列布局）：
   * 「nP 本关得分 xxx」（仅 stageClear 传 stageScore 时展示）→ 战报明细 → 「nP 总分 xxx（出局）」。
   */
  private playerResultBlock(playerIndex: number, player: PlayerResultInfo, stageScore?: number): HTMLDivElement[] {
    const label = playerIndex === 0 ? '1P' : '2P';
    const lines: HTMLDivElement[] = [];
    if (stageScore !== undefined) {
      lines.push(this.line(`${label} 本关得分 ${stageScore}`, '16px', '#ffe400'));
    }
    lines.push(...this.breakdownLines(player.breakdown));
    const outSuffix = player.out ? '（出局）' : '';
    lines.push(this.line(`${label} 总分 ${player.totalScore}${outSuffix}`, '18px', '#ffffff'));
    return lines;
  }

  /**
   * 本关战报：每种敌人一行「名称 击杀数 × 单价 = 小计」，末尾追加一行击毁合计与得分合计。
   * 合计得分为四行小计之和（只计入击杀），可能小于同屏展示的「本关得分/总分」——
   * 后者还包含本关拾取道具的加分，两者语义不同，属预期行为。
   */
  private breakdownLines(breakdown: readonly KillTallyRow[]): HTMLDivElement[] {
    const rows = breakdown.map((row) =>
      this.line(
        `${ENEMY_KIND_LABELS[row.kind]} ${row.count} × ${row.unitPrice} = ${row.subtotal}`,
        '14px',
        '#ffffff',
      ),
    );
    const totalCount = breakdown.reduce((sum, row) => sum + row.count, 0);
    const totalSubtotal = breakdown.reduce((sum, row) => sum + row.subtotal, 0);
    const total = this.line(`击毁合计 ${totalCount} 台 · 得分合计 ${totalSubtotal}`, '16px', '#ffe400');
    return [...rows, total];
  }
}
