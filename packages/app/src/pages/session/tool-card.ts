/**
 * 「一轮里的连续工具调用」合并成一张卡片的边界计算。
 *
 * 背景：Qoder / ZCode 的聊天流里，工具调用是**一个连续的块**（视觉上属于同一次执行），
 * 而我们现在是每个工具行各自独立漂浮在消息流里 —— 一行一个上下边距，
 * 一段跑二十个工具就散成二十截，读起来分不出"这些属于同一轮"。
 *
 * 这里只做**纯计算**：给出一串行类型，标出每行是不是卡片的首/尾。
 * 组件据此画外框，规则可单测。
 *
 * 判定规则：
 * - 只有 `AssistantPart` 行参与分组（用户消息、分隔线、错误行等都是天然边界）；
 * - 连续 ≥2 个工具行才算一张卡 —— 单行套外框只会变成多余的装饰；
 * - 卡片内部再按"是否换了一个 message"断开：不同 assistant 消息是两次独立执行。
 */

export type ToolCardRow = {
  /** 行是不是工具调用（助手内容行）。 */
  tool: boolean
  /** 同一张卡片只包同一条 assistant 消息。 */
  messageID?: string
}

export type ToolCardSlot = {
  /** 卡片的第一行：画上边框与上圆角。 */
  start: boolean
  /** 卡片的最后一行：画下圆角。 */
  end: boolean
  /** 处在卡片中间的行：不画外框，只在顶部画一条细分隔线。 */
  between: boolean
}

const NONE: ToolCardSlot = { start: false, end: false, between: false }

export function toolCardSlots(rows: readonly ToolCardRow[]): ToolCardSlot[] {
  const slots: ToolCardSlot[] = rows.map(() => ({ ...NONE }))
  let index = 0

  while (index < rows.length) {
    const row = rows[index]
    if (!row?.tool) {
      index += 1
      continue
    }

    // 往右找到连续同 message 的工具行（下一行不是工具行、或换了 message 就停）。
    let end = index
    while (
      end + 1 < rows.length &&
      rows[end + 1]?.tool &&
      rows[end + 1]?.messageID === row.messageID
    ) {
      end += 1
    }

    const size = end - index + 1
    if (size >= 2) {
      slots[index] = { start: true, end: size === 1, between: false }
      for (let middle = index + 1; middle <= end; middle += 1) {
        const last = middle === end
        slots[middle] = { start: false, end: last, between: !last }
      }
    }

    index = end + 1
  }

  return slots
}
