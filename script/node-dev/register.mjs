/**
 * `node --import ./script/node-dev/register.mjs <entry>` 的入口。
 *
 * 顺序很重要：
 *   1. 先装 `globalThis.Bun` —— 很多模块在顶层就调 `Bun.file()`。
 *   2. 再装 Worker 兼容层 —— TUI 启动时会 `new Worker(...)`，要在那之前生效。
 *   3. 最后注册 loader —— `.ts` / `.tsx` 的转换靠它。
 *
 * 这个文件在 worker 线程里也会被执行（Node 的 worker 继承父进程的 `execArgv`），
 * 所以 Worker 兼容层要按 `isMainThread` 分别处理。
 */
import { register } from "node:module"
import { pathToFileURL } from "node:url"
import bun from "./shims/bun.mjs"
import { installWorkerCompat } from "./shims/worker.mjs"

if (typeof globalThis.Bun === "undefined") {
  globalThis.Bun = bun
}

installWorkerCompat()

// Node 26 起 `module.register()` 被标记为废弃（建议改用同步的 `registerHooks()`）。
// 这里不能换：我们的 load 钩子要用 esbuild/babel 的异步 API 转译 TSX，而 registerHooks
// 要求钩子同步返回。这只是一条开发期提示，会在 TUI 的 alternate-screen 里打出乱码，
// 所以单独咽掉 DEP0205；其它警告照 Node 默认格式打印。
// （Node 的默认打印本身就是一个 'warning' 监听器，必须换掉它而不是再挂一个。）
const defaultWarningHandler = process.listeners("warning")
if (defaultWarningHandler.length === 1) {
  process.removeAllListeners("warning")
  process.on("warning", (warning) => {
    if (warning?.code === "DEP0205") return
    // opentui 依赖的 `node:ffi` 在 Node 26 里默认开启，但每次启动都会提醒一次
    // "experimental"。我们是有意用它跑 TUI 的，这条提示在 alternate-screen 里只会
    // 把画面弄花，干脆也过滤掉（FFI 真不可用时会走另一条报错路径）。
    if (warning?.name === "ExperimentalWarning" && /FFI is an experimental feature/.test(warning.message)) return
    const code = warning?.code ? `[${warning.code}] ` : ""
    process.stderr.write(`(node:${process.pid}) ${code}${warning.name}: ${warning.message}\n`)
    if (process.execArgv.includes("--trace-warnings") && warning.stack) process.stderr.write(`${warning.stack}\n`)
  })
}

register("./loader.mjs", pathToFileURL(import.meta.filename))
