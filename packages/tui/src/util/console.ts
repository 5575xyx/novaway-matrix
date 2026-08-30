import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { format } from "node:util"

// TUI 运行期间把 console 全量重定向到日志文件。
//
// 为什么必须这么做:opentui 在 alternate-screen 模式下对外部输出只有 "passthrough"
// 一种实现(@opentui/core chunk-bun-tkm837n2.js:6664 —— "capture-stdout" 只支持
// split-footer),也就是任何 console.log/warn/error 都会**绕过渲染器直写真实终端**。
// 终端遇到一个 "\n" 就把整个屏幕向上滚一行,而 renderer 还按老坐标做增量重绘:
// 画面从这一刻起和物理屏幕错位,顶部标签栏被挤出屏幕、面板整体上移,
// 这正是"用着用着顶部标签没了、ctrl+l 能救回来"的病根。病根在写入,不在渲染。
//
// 所以防线是:启动时把 console 的常用方法全部接到 <data>/log/tui.log,
// 真实终端从此只由渲染器一个人写。逃生口:NOVAWAY_TUI_STDOUT=1 恢复直写
// (排日志系统自身的问题时用)。

let installed = false

export function redirectConsoleToLog(logDir: string, filename = "tui.log") {
  if (installed) return
  installed = true

  const file = path.join(logDir, filename)
  const write = (level: string, args: unknown[]) => {
    let text: string
    try {
      text = format(...args)
    } catch {
      text = args.map((arg) => String(arg)).join(" ")
    }
    // appendFile 每次开一次 fd。日志量本来就低(重定向前这些输出还会拖垮画面),
    // 换常驻 fd 或流式写入都更复杂,不值得。写日志失败永远静默:它自己不能再制造噪音。
    void appendFile(file, `[${new Date().toISOString()}] [${level}] ${text}\n`).catch(() => {})
  }

  const redirect = (level: string) => (...args: unknown[]) => write(level, args)
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    trace: console.trace,
  }
  console.log = redirect("log")
  console.info = redirect("info")
  console.warn = redirect("warn")
  console.error = redirect("error")
  console.debug = redirect("debug")
  console.trace = (...args) => write("trace", [...args, new Error("trace").stack ?? ""])
  return () => {
    Object.assign(console, originals)
    installed = false
  }
}
