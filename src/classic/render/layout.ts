/**
 * 经典复刻 · 渲染层布局计算（纯函数，无 canvas/DOM 依赖，可在 node 下直接单测）
 *
 * 逻辑分辨率固定：208×208 战场 + 右侧 48px HUD 栏（向原版 256×240 屏幕的侧栏比例致敬），
 * 合成到一个逻辑分辨率为 LOGICAL_WIDTH×LOGICAL_HEIGHT 的显示 canvas，按容器尺寸整数倍缩放。
 */
import { FIELD_PX } from '../core/constants';

/** HUD 侧栏宽度（逻辑 px） */
export const HUD_WIDTH = 48;
export const LOGICAL_WIDTH = FIELD_PX + HUD_WIDTH;
export const LOGICAL_HEIGHT = FIELD_PX;

export interface Layout {
  /** 整数缩放倍数，钳制最小为 1 */
  scale: number;
  /** 显示 canvas 左上角相对容器的偏移（居中留黑边），容器小于逻辑分辨率时可为负 */
  offsetX: number;
  offsetY: number;
}

/** 容器尺寸（css px） → 整数缩放倍数与居中偏移；容器尺寸非正时钳制缩放为 1 */
export function computeLayout(
  containerW: number,
  containerH: number,
  logicalW: number = LOGICAL_WIDTH,
  logicalH: number = LOGICAL_HEIGHT,
): Layout {
  const rawScale = containerW > 0 && containerH > 0 ? Math.min(containerW / logicalW, containerH / logicalH) : 0;
  const scale = Math.max(1, Math.floor(rawScale));
  const offsetX = Math.floor((containerW - logicalW * scale) / 2);
  const offsetY = Math.floor((containerH - logicalH * scale) / 2);
  return { scale, offsetX, offsetY };
}
