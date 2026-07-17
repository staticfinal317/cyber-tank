/**
 * 经典复刻 · 内置 3×5 像素数字字体（禁止依赖外部字体资源）
 *
 * 字形数据为纯字符串数组（'#'=着色像素 '.'=透明），可在 node 下直接校验尺寸合法性；
 * drawDigit/drawNumber 依赖 CanvasRenderingContext2D，只在浏览器环境调用。
 */
export const DIGIT_WIDTH = 3;
export const DIGIT_HEIGHT = 5;

export const DIGIT_GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
};

/** 单个数字字符 → canvas 绘制（pixelSize 为每个字体像素的实际绘制边长） */
export function drawDigit(
  ctx: CanvasRenderingContext2D,
  digit: string,
  x: number,
  y: number,
  pixelSize: number,
  color: string,
): void {
  const glyph = DIGIT_GLYPHS[digit];
  if (!glyph) throw new Error(`未知数字字符: '${digit}'`);
  ctx.fillStyle = color;
  for (let row = 0; row < DIGIT_HEIGHT; row += 1) {
    const line = glyph[row] as string;
    for (let col = 0; col < DIGIT_WIDTH; col += 1) {
      if (line[col] === '#') ctx.fillRect(x + col * pixelSize, y + row * pixelSize, pixelSize, pixelSize);
    }
  }
}

/** 非负整数 → 逐位绘制；返回下一个可用的绘制光标 x（便于调用方接着排版） */
export function drawNumber(
  ctx: CanvasRenderingContext2D,
  value: number,
  x: number,
  y: number,
  pixelSize: number,
  color: string,
  spacing = 1,
): number {
  const text = Math.max(0, Math.floor(value)).toString();
  let cursor = x;
  for (const ch of text) {
    drawDigit(ctx, ch, cursor, y, pixelSize, color);
    cursor += (DIGIT_WIDTH + spacing) * pixelSize;
  }
  return cursor;
}
