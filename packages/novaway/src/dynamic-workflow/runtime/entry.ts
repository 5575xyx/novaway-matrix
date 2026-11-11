/**
 * 生成沙箱入口文件：一份自包含的 ESM，写到磁盘后由 `process.execPath` 启动。
 *
 * 为什么要有磁盘上的一份文件：Windows 的命令行上限是 32,767 字符，而编译后的脚本可能几十 KB。
 * `--eval "<整份脚本>"` 会在脚本一过约 18 KB 时 `spawn ENAMETOOLONG`。文件没有这个限制。
 *
 * 由谁来跑它：`process.execPath`。在 Node 下是 node，在 Bun 下是 bun——同一份入口两边都能跑，
 * 因为它只 import node 内建（node:vm、node:readline）。
 *
 * 为什么 payload 用 JSON 字面量而不是 argv：同上。JSON.stringify 的输出本身就是合法的 JS
 * 表达式，直接拼进去即可。
 */

import { CHILD_BOOTSTRAP } from "./child-bootstrap"
import type { ChildPayload } from "./protocol"

/** 入口文件里除 payload 之外还要知道的东西。 */
export interface EntryMeta {
  /** run id。只用于文件名注释与文件名，防止误删别的 run 的文件。 */
  readonly runId: string
}

/** run id 里除安全字符外一律换成下划线（文件名与注释共用同一份净化）。 */
function safeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/g, "_")
}

/**
 * 渲染入口文件。
 *
 * 结构：
 *   1. 建 vm context，注入 `__send` 与 `__argsJson`；
 *   2. 跑 CHILD_BOOTSTRAP（建立 `__host` / `__deliver` / `__execute` / `__checkStalled`）；
 *   3. 编译降级后的脚本为 context-native async 函数；
 *   4. 读 stdin，逐行喂 `__deliver`，每条之后在 setImmediate 上问一次停滞检测；
 *   5. 跑脚本，收尾时关 stdin，进程随空闲的事件循环自然退出。
 *
 * ⚠ 生成的代码里**一个反斜杠都不出现**：换行一律用入口自己定义的 `NL` 常量拼。
 * 原因很实际——这份生成器本身也是被工具链写来写去的文本，`\n` 这种转义一旦在哪一层被
 * 折叠成真换行，产物就会是一个 `Unterminated string literal`，而错误只出现在子进程的
 * stderr 里，看上去像「子进程莫名退出」。用常量拼接，这条路根本不存在。
 */
export function renderChildEntry(payload: ChildPayload, meta: EntryMeta): string {
  const runId = safeRunId(meta.runId)
  return [
    `// novaway dynamic workflow run ${runId}`,
    "// 由 @/dynamic-workflow/runtime 在每次启动前生成；run 结算之后可以安全删除。",
    'import vm from "node:vm"',
    'import { createInterface } from "node:readline"',
    'import { writeSync } from "node:fs"',
    "",
    "const NL = String.fromCharCode(10)",
    `const payload = ${JSON.stringify(payload)}`,
    `const bootstrap = ${JSON.stringify(CHILD_BOOTSTRAP)}`,
    "",
    "// **同步**写 stdout。子进程的最后一条消息就是 complete，而异步写的管道缓冲在",
    "// 「脚本跑完 → 事件循环变空 → 进程退出」这条路上会把尾巴丢掉——丢的正是结果本身。",
    "// Bun 下实测过这个丢法（子进程 code=0 却少了 complete）；writeSync 顺带给出天然背压。",
    "const send = (line) => writeSync(1, line + NL)",
    "",
    "const sandbox = {",
    "  __send: send,",
    "  __argsJson: JSON.stringify(payload.args || {}),",
    "}",
    'vm.createContext(sandbox, { name: "novaway-workflow-sandbox" })',
    'vm.runInContext(bootstrap, sandbox, { filename: "workflow-bootstrap.js" })',
    "",
    "let runFn",
    "try {",
    '  runFn = vm.runInContext("(async (__host) => {" + NL + payload.lowered + NL + "})", sandbox, {',
    '    filename: "workflow-script.js",',
    "  })",
    "} catch (error) {",
    "  // 降级体编译失败：发一条 error-complete 后直接收尾。不调 process.exit：",
    "  // 先让它写完，再让事件循环自然退出。",
    "  send(",
    "    JSON.stringify({",
    '      kind: "complete",',
    "      ok: false,",
    "      error: {",
    '        name: (error && error.name) || "SyntaxError",',
    "        message: (error && error.message) || String(error),",
    "        stack: error && error.stack,",
    "      },",
    "    }),",
    "  )",
    "}",
    "",
    "// 编译失败时 runFn 仍未定义：此时没有 reader，进程冲刷完 stderr/stdout 自然退出。",
    "if (runFn) {",
    "  const reader = createInterface({ input: process.stdin })",
    '  reader.on("line", (line) => {',
    "    if (!line.trim()) return",
    "    sandbox.__deliver(line)",
    "    // setImmediate 排在本轮全部微任务之后：response 能触发的每个 continuation 都已跑完。",
    "    // 而 cell 内没有定时器与 I/O，所以「无在飞请求且未完成」在这一刻成立就永远成立。",
    "    setImmediate(() => {",
    "      if (sandbox.__checkStalled()) reader.close()",
    "    })",
    "  })",
    "  sandbox.__execute(runFn).then(",
    "    () => reader.close(),",
    "    () => reader.close(),",
    "  )",
    "  setImmediate(() => {",
    "    if (sandbox.__checkStalled()) reader.close()",
    "  })",
    "}",
    "",
  ].join("\n")
}
