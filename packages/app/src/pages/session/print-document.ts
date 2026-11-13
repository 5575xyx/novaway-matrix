/**
 * 打印 / 导出 PDF。
 *
 * 四个编辑器的「打印、导出 PDF」：不另写一套排版，
 * **直接把屏幕上已经渲染好的 DOM 拿去打印** —— 用户看到的分页、
 * 表格线、配色就是纸上的样子，不会出现「预览对了、导出错了」。
 *
 * 两种出口：
 *   - 打印：新开一个窗口，把 DOM 放进去交给浏览器打印对话框；
 *   - 导出 PDF：桌面端走主进程的离屏 Chromium（`printToPdf`），
 *     和屏幕上完全同一份 HTML，所以两者结果一致。
 */

const PRINT_CSS = [
  "@page { size: A4; margin: 12mm; }",
  // 打印介质明确使用纸张白底和黑色正文，避免 App 暗色主题渗入纸面输出。
  "html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }",
  "body { -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #111; }",
  "[data-print-hide] { display: none !important; }",
  "button { border: none !important; background: transparent !important; box-shadow: none !important; }",
].join("\n")

/** 收集当前页面的样式表：开发态是内联 <style>，打包后是 link。 */
function collectStyles(): string {
  if (typeof document === "undefined") return ""
  const parts: string[] = []
  for (const element of Array.from(document.querySelectorAll("style, link[rel='stylesheet']"))) {
    if (element.tagName === "STYLE") parts.push(element.outerHTML)
    else if (element instanceof HTMLLinkElement) parts.push('<link rel="stylesheet" href="' + element.href + '">')
  }
  return parts.join("\n")
}

/** 拼一份自包含的 HTML（样式 + 正文 + 打印规则）。 */
export function documentHtml(title: string, bodyHtml: string): string {
  const safe = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    "<title>" +
    safe +
    "</title>" +
    collectStyles() +
    "<style>" +
    PRINT_CSS +
    "</style>" +
    "</head><body>" +
    bodyHtml +
    "</body></html>"
  )
}

/**
 * 把一块已渲染的 DOM 变成可打印的 HTML。
 *
 * 克隆后去掉交互控件（按钮、编辑提示），否则纸上会印出一排按钮。
 */
export function printableHtml(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement
  for (const node of Array.from(clone.querySelectorAll("button, [data-print-hide]"))) node.remove()
  for (const node of Array.from(clone.querySelectorAll("[contenteditable]"))) node.removeAttribute("contenteditable")
  return clone.innerHTML
}

/** 在新窗口里打印；弹窗被拦截时返回 false（调用方可以退回 window.print）。 */
export function printHtml(html: string, title: string): boolean {
  const win = window.open("", "_blank", "width=900,height=1200")
  if (!win) return false
  win.document.open()
  win.document.write(documentHtml(title, html))
  win.document.close()
  const run = () => {
    try {
      win.focus()
      win.print()
    } catch {
      // 用户关掉了窗口：什么都不用做。
    }
  }
  // 等图片/字体排完再调打印对话框；没有 load 事件时（已经 complete）直接延时。
  if (win.document.readyState === "complete") setTimeout(run, 200)
  else win.addEventListener("load", () => setTimeout(run, 100), { once: true })
  return true
}

/** 纯文本 / 源码视图的打印版本：等宽、保留缩进和换行。 */
export function textToPrintHtml(text: string): string {
  const escape = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return (
    '<pre style="white-space: pre-wrap; word-break: break-word; font: 12px/1.6 ui-monospace, monospace;">' +
    escape +
    "</pre>"
  )
}
