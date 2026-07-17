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

export interface StageClearInfo {
  stageScore: number;
  totalScore: number;
  breakdown: readonly KillTallyRow[];
}

export interface ResultInfo {
  totalScore: number;
}

export interface GameOverInfo extends ResultInfo {
  breakdown: readonly KillTallyRow[];
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

  showMenu(hiScore: number, gamepadConnected: boolean): void {
    const lines = [
      this.line('坦克大作战', '32px', '#ffe400'),
      this.line(`HI-SCORE ${hiScore}`, '14px', '#a0a0a0'),
      this.line('按 Enter 开始', '18px', '#ffffff'),
      this.line('方向键/WASD 移动 · 空格/J 开火 · Esc 暂停', '13px', '#a0a0a0'),
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
    this.render('#000000', [
      this.line('本关通过', '28px', '#00ff66'),
      ...this.breakdownLines(info.breakdown),
      this.line(`本关得分 ${info.stageScore}`, '18px', '#ffffff'),
      this.line(`总分 ${info.totalScore}`, '18px', '#ffffff'),
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
    this.render('#000000', [
      this.line('GAME OVER', '32px', '#ff3030'),
      ...this.breakdownLines(info.breakdown),
      this.line(`总分 ${info.totalScore}`, '18px', '#ffffff'),
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
