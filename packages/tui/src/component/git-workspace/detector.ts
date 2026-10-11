// 工作区的鼠标双击判定器(规格「双击 = 默认操作」)。
//
// @opentui/core 的 Renderable props **没有** onDoubleClick(只有 onMouseDown/Up/Move/
// Drag/DragEnd/Drop/Over/Out/Scroll),所以双击必须自己判定:记「上一次 down 的目标 id
// + 时间戳」,同一目标 DOUBLE_CLICK_WINDOW_MS 内的第二次 down 判为双击,否则是单击。
//
// 时钟通过参数注入(参照 confirm.ts 的 createConfirm(now)),不直接读 Date.now:阈值
// 400ms 绑死真实时间,测试就只能 sleep 才敢断言,既慢又抖。生产用 Date.now,
// 测试传假时钟 —— 同一份代码,两种时间。
export const DOUBLE_CLICK_WINDOW_MS = 400

export type ClickResult = "single" | "double"

export interface ClickDetector {
  /**
   * 报一次点击,拿到本次是单击还是双击。id 编码面板与行号(如 "files:0"),
   * 同一目标窗口内再次 down 才算双击;换目标 / 超出窗口都判为单击。
   */
  detect(id: string, single: () => void, double: () => void): ClickResult
}

/**
 * 状态存在闭包里而不是模块级 —— 一个工作区实例一个 detector,多个 harness 同时挂载时
 * 各自的点击序列不会串(文件面板点一次、贮藏面板再点一次不算双击)。
 */
export function createClickDetector(now: () => number): ClickDetector {
  let lastId: string | undefined
  let lastAt = 0

  return {
    detect(id, single, double) {
      const t = now()
      // 先算结果再记最新:双击之后紧接着的第三次(超阈值)不能算双击。
      const isDouble = lastId === id && t - lastAt < DOUBLE_CLICK_WINDOW_MS
      lastId = id
      lastAt = t
      return isDouble ? (double(), "double") : (single(), "single")
    },
  }
}
