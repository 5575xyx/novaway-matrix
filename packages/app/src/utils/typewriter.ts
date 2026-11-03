// 打字机的节奏参数（文件预览用）。
//
// AI 写盘是"整块替换"：每次 write/edit 完成后 watcher 报一次事件，文件内容从
// 旧全文跳到新全文。直接渲染就是"啪"一下整页替换，所以要按节奏逐段揭示。
// 「揭示什么」由 typing-additions.ts 决定（只打新增的行），这里只管「一次打多少」。
//
// 节奏对齐聊天流式的 PacedMarkdown（@novaway/ui message-part）：步长随剩余量
// 放大、优先停在标点/空白边界，但整体更快 —— 文件预览的正文比聊天长得多。

const SNAP = /[\s.,!?;:)\]}>）】、。！？；：“”‘’]/

/**
 * 单帧揭示多少字符（按剩余量放大）。
 *
 * 大文件先快点铺开，尾部再收回慢速，保留"正在打字"的观感：最后一屏仍然
 * 是逐帧几个字地长出来。约 90 帧追平 —— 太慢会耽误看内容，太快用户根本注意不到。
 */
export function revealChunk(remaining: number) {
  if (remaining <= 0) return 0
  return remaining <= 16
    ? 2
    : remaining <= 64
      ? 4
      : remaining <= 160
        ? 8
        : remaining <= 600
          ? 24
          : Math.min(1024, Math.max(48, Math.ceil(remaining / 90)))
}

/** 从 shownLength 再揭示一段，返回新的揭示长度。纯函数，便于单测。 */
export function revealStep(text: string, shownLength: number) {
  const remaining = text.length - shownLength
  if (remaining <= 0) return text.length
  const end = Math.min(text.length, shownLength + revealChunk(remaining))
  const max = Math.min(text.length, end + 8)
  for (let i = end; i < max; i++) {
    if (SNAP.test(text[i] ?? "")) return i + 1
  }
  return end
}
