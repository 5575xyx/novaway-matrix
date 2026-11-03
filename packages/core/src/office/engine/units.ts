/**
 * 办公文档的坐标单位。
 *
 * 这里踩过一次真实的坑：PPTX 的 `a:off/@x`、`a:ext/@cx` 是 **EMU**
 * （English Metric Unit，914400/英寸），而渲染器和画布用的是 **pt**
 * （1 pt = 1/72 英寸，16:9 页面正好 960×540 pt）。两者相差 12700 倍。
 *
 * 把 EMU 当 pt 用，选中框会跑到几十万像素外，肉眼看起来就是「根本没法编辑」。
 * 所以引擎层的规矩是：
 *   - 对外（UI / Agent / 路径参数）一律用 pt；
 *   - 只在读写 XML 的那一层做 EMU 转换。
 */

/** 1 pt = 12700 EMU（914400 / 72）。 */
export const EMU_PER_POINT = 12700

export function emuToPt(value: number): number {
  return value / EMU_PER_POINT
}

export function ptToEmu(value: number): number {
  return Math.round(value * EMU_PER_POINT)
}

export type BoxPt = { x: number; y: number; w: number; h: number }

export function boxEmuToPt(box: BoxPt): BoxPt {
  return {
    x: emuToPt(box.x),
    y: emuToPt(box.y),
    w: emuToPt(box.w),
    h: emuToPt(box.h),
  }
}

export function boxPtToEmu(box: BoxPt): BoxPt {
  return {
    x: ptToEmu(box.x),
    y: ptToEmu(box.y),
    w: ptToEmu(box.w),
    h: ptToEmu(box.h),
  }
}
