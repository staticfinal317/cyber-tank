/**
 * 经典复刻 · 流程界面覆盖层（M6）
 *
 * DOM 覆盖层，与渲染 canvas 共享同一容器；像素风格视觉（等宽字体/大号/高对比），
 * 文案面向儿童、简体中文，全部界面键盘可达、无鼠标依赖。
 * 纯 DOM 副作用层：只负责"显示什么"，不做任何流程判断——由 ClassicGame 按 FSM 状态调用。
 */

const FONT_FAMILY = '"Courier New", ui-monospace, monospace';

export interface StageClearInfo {
  stageScore: number;
  totalScore: number;
}

export interface ResultInfo {
  totalScore: number;
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

  showMenu(): void {
    this.render('#000000', [
      this.line('坦克大作战', '32px', '#ffe400'),
      this.line('按 Enter 开始', '18px', '#ffffff'),
      this.line('方向键/WASD 移动 · 空格/J 开火 · Esc 暂停', '13px', '#a0a0a0'),
    ]);
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

  showGameOver(info: ResultInfo): void {
    this.render('#000000', [
      this.line('GAME OVER', '32px', '#ff3030'),
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
}
