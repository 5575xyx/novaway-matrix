import { Effect, Stream } from "effect"
import os from "os"
import { createWriteStream } from "node:fs"
import * as Tool from "./tool"
import path from "path"
import * as Log from "@novaway/core/util/log"
import { BackgroundJob } from "@/background/job"
import { Identifier } from "@/id/id"
import { containsPath, type InstanceContext } from "../project/instance-context"
import { InstanceState } from "@/effect/instance-state"
import { lazy } from "@/util/lazy"
import { Language, type Node } from "web-tree-sitter"

import { AppFileSystem } from "@novaway/core/filesystem"
import { fileURLToPath } from "url"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Shell } from "@/shell/shell"
import { ShellID } from "./shell/id"
import { interpretCommandResult } from "./command-semantics"

import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { ShellPrompt, type Parameters } from "./shell/prompt"
import { BashArity } from "@/permission/arity"

export { Parameters } from "./shell/prompt"

const MAX_METADATA_LENGTH = 30_000
// 默认 2 分钟,够跑大多数检查、测试和构建。
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000
// 硬上限 30 分钟。模型传一个离谱的 timeout 不该把会话无限挂在工具调用上。
const MAX_TIMEOUT_MS = 30 * 60 * 1000

/**
 * 明显是"常驻服务"的命令。
 *
 * 模型常常忘了传 `background: true`，直接前台启动 `python -m http.server` /
 * `npx serve` 之类的静态服务。前台调用会被 2 分钟超时杀掉 —— 于是产物卡片
 * 里的"打开原型"链接指向一个已经死掉的服务。这里自动把它们提升为后台任务：
 * 调用立刻返回 job_id，服务留在后台，用户点开卡片时还能访问。
 *
 * 只匹配"一定会长期驻留、不会自己退出"的写法；构建类命令（`vite build`）
 * 与一次性的 run 命令都不在其中。
 */
const LONG_LIVED_SERVER = new RegExp(
  [
    "\\bpython3?\\s+-m\\s+http\\.server\\b",
    "\\bhttp-server\\b",
    "\\b(?:npx|pnpm|bunx?)\\s+(?:dlx\\s+)?(?:serve|http-server)\\b",
    // `vite` 起 dev server；`vite build` 是一次性构建，不能算常驻。
    "\\bvite\\b(?!\\s+build)",
    "\\b(?:next|nuxt|astro)\\s+dev\\b",
    "\\bng\\s+serve\\b",
    "\\bphp\\s+-S\\b",
    "\\b(?:uvicorn|gunicorn)\\b",
    "\\bflask\\s+run\\b",
    "\\brails\\s+(?:s|server)\\b",
    "\\b(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:dev|start|serve)\\b",
  ].join("|"),
  "i",
)

export function looksLikeServer(command: string) {
  return LONG_LIVED_SERVER.test(command)
}

const CWD = new Set(["cd", "chdir", "popd", "pushd", "push-location", "set-location"])
const FILES = new Set([
  ...CWD,
  "rm",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "cat",
  // Leave PowerShell aliases out for now. Common ones like cat/cp/mv/rm/mkdir
  // already hit the entries above, and alias normalization should happen in one
  // place later so we do not risk double-prompting.
  "get-content",
  "set-content",
  "add-content",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
  // 写入类 cmdlet：不加上会让 out-file/export-csv 这类命令绕过目录检查。
  "out-file",
  "clear-content",
  "export-csv",
  "set-item",
  "set-itemproperty",
  "new-itemproperty",
  "remove-itemproperty",
  "expand-archive",
  "compress-archive",
])
const CMD_FILES = new Set([
  "copy",
  "del",
  "dir",
  "erase",
  "md",
  "mkdir",
  "move",
  "rd",
  "ren",
  "rename",
  "rmdir",
  "type",
])
const FLAGS = new Set(["-destination", "-literalpath", "-path", "-filepath", "-source", "-outfile"])
const SWITCHES = new Set(["-confirm", "-debug", "-force", "-nonewline", "-recurse", "-verbose", "-whatif"])

type Part = {
  type: string
  text: string
}

type Scan = {
  dirs: Set<string>
  patterns: Set<string>
  always: Set<string>
}

type Chunk = {
  text: string
  size: number
}

export const log = Log.create({ service: "shell-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

function parts(node: Node) {
  const out: Part[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "command_elements") {
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
        out.push({ type: item.type, text: item.text })
      }
      continue
    }
    if (
      child.type !== "command_name" &&
      child.type !== "command_name_expr" &&
      child.type !== "word" &&
      child.type !== "string" &&
      child.type !== "raw_string" &&
      child.type !== "concatenation"
    ) {
      continue
    }
    out.push({ type: child.type, text: child.text })
  }
  return out
}

function source(node: Node) {
  return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
}

function commands(node: Node) {
  return node.descendantsOfType("command").filter((child): child is Node => Boolean(child))
}

function unquote(text: string) {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' || first === "'") && first === last) return text.slice(1, -1)
  return text
}

function home(text: string) {
  if (text === "~") return os.homedir()
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2))
  return text
}

function envValue(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function auto(key: string, cwd: string, shell: string) {
  const name = key.toUpperCase()
  if (name === "HOME") return os.homedir()
  if (name === "PWD") return cwd
  if (name === "PSHOME") return path.dirname(shell)
}

function expand(text: string, cwd: string, shell: string) {
  const out = unquote(text)
    .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => auto(key, cwd, shell) || "")
  return home(out)
}

function provider(text: string) {
  const match = text.match(/^([A-Za-z]+)::(.*)$/)
  if (match) {
    if (match[1].toLowerCase() !== "filesystem") return
    return match[2]
  }
  const prefix = text.match(/^([A-Za-z]+):(.*)$/)
  if (!prefix) return text
  if (prefix[1].length === 1) return text
  return
}

function dynamic(text: string, ps: boolean) {
  if (text.startsWith("(") || text.startsWith("@(")) return true
  if (text.includes("$(") || text.includes("${") || text.includes("`")) return true
  if (ps) return /\$(?!env:)/i.test(text)
  return text.includes("$")
}

function prefix(text: string) {
  const match = /[?*[]/.exec(text)
  if (!match) return text
  if (match.index === 0) return
  return text.slice(0, match.index)
}

function pathArgs(list: Part[], ps: boolean, cmd = false) {
  if (!ps) {
    return list
      .slice(1)
      .filter(
        (item) =>
          !item.text.startsWith("-") &&
          !(cmd && item.text.startsWith("/")) &&
          !(list[0]?.text === "chmod" && item.text.startsWith("+")),
      )
      .map((item) => item.text)
  }

  const out: string[] = []
  let want = false
  for (const item of list.slice(1)) {
    if (want) {
      out.push(item.text)
      want = false
      continue
    }
    if (item.type === "command_parameter") {
      const flag = item.text.toLowerCase()
      if (SWITCHES.has(flag)) continue
      want = FLAGS.has(flag)
      continue
    }
    out.push(item.text)
  }
  return out
}

function preview(text: string) {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

function tail(text: string, maxLines: number, maxBytes: number) {
  const lines = text.split("\n")
  if (lines.length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes) {
    return {
      text,
      cut: false,
    }
  }

  const out: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) {
      if (out.length === 0) {
        const buf = Buffer.from(lines[i], "utf-8")
        let start = buf.length - maxBytes
        if (start < 0) start = 0
        while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
        out.unshift(buf.subarray(start).toString("utf-8"))
      }
      break
    }
    out.unshift(lines[i])
    bytes += size
  }
  return {
    text: out.join("\n"),
    cut: true,
  }
}

const parse = Effect.fn("ShellTool.parse")(function* (command: string, ps: boolean) {
  const tree = yield* Effect.promise(() => parser().then((p) => (ps ? p.ps : p.bash).parse(command)))
  if (!tree) throw new Error("Failed to parse command")
  return tree
})

const ask = Effect.fn("ShellTool.ask")(function* (ctx: Tool.Context, scan: Scan, permission: string = ShellID.ToolID) {
  if (scan.dirs.size > 0) {
    const globs = Array.from(scan.dirs).map((dir) => {
      if (process.platform === "win32") return AppFileSystem.normalizePathPattern(path.join(dir, "*"))
      return path.join(dir, "*")
    })
    yield* ctx.ask({
      permission: "external_directory",
      patterns: globs,
      always: globs,
      metadata: {},
    })
  }

  if (scan.patterns.size === 0) return
  yield* ctx.ask({
    permission,
    patterns: Array.from(scan.patterns),
    always: Array.from(scan.always),
    metadata: {},
  })
})

function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  if (process.platform === "win32" && Shell.ps(shell)) {
    return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      cwd,
      env,
      stdin: "ignore",
      detached: false,
    })
  }

  return ChildProcess.make(command, [], {
    shell,
    cwd,
    env,
    stdin: "ignore",
    detached: process.platform !== "win32",
  })
}

/** 后台 shell 的退出码换成 job 终态：非 0 不是"完成"，卡片不该显示成绿色。 */
function shellOutcome(command: string, result: { output: string; metadata?: { exit?: unknown } }) {
  if (result.metadata?.exit === null) {
    return { output: result.output, failed: "command did not exit normally (timeout or signal)" }
  }
  if (typeof result.metadata?.exit === "number" && result.metadata.exit !== 0) {
    const exit = result.metadata.exit
    const interpretation = interpretCommandResult(command, exit)
    // grep/rg 的 1 表示"没有匹配"，不是失败，不该把任务卡片标红。
    if (interpretation.isError) {
      return { output: result.output, failed: interpretation.message ?? `command exited with code ${exit}` }
    }
  }
  return { output: result.output }
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const psPath = resolveWasm(psWasm)
  const [bashLanguage, psLanguage] = await Promise.all([Language.load(bashPath), Language.load(psPath)])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, ps }
})

type ShellKind = "auto" | "powershell"

/**
 * Shared implementation for the `bash` tool (whatever shell the session is
 * configured with) and the dedicated `powershell` tool.
 *
 * The PowerShell tool is CC's `PowerShell` tool: it always runs a PowerShell
 * binary regardless of the configured shell, so Windows sessions keep git-bash
 * as the default while still giving the model a place to send cmdlets,
 * `$env:` assignments, and Windows-native executables.
 */
const definition = (kind: ShellKind) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const background = yield* BackgroundJob.Service
    const spawner = yield* ChildProcessSpawner
    const fs = yield* AppFileSystem.Service
    const trunc = yield* Truncate.Service
    const plugin = yield* Plugin.Service
    const flags = yield* RuntimeFlags.Service

    const cygpath = Effect.fn("ShellTool.cygpath")(function* (shell: string, text: string) {
      const lines = yield* spawner
        .lines(ChildProcess.make(shell, ["-lc", 'cygpath -w -- "$1"', "_", text]))
        .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      const file = lines[0]?.trim()
      if (!file) return
      return AppFileSystem.normalizePath(file)
    })

    const resolvePath = Effect.fn("ShellTool.resolvePath")(function* (text: string, root: string, shell: string) {
      if (process.platform === "win32") {
        // `/c/...` 这类带盘符的 POSIX 路径由 windowsPath 直接映射；
        // 无盘符的 `/tmp`、`/Users/...` 交给 cygpath（它遵循 msys 挂载表）。
        const mapped = AppFileSystem.windowsPath(text)
        const native = AppFileSystem.normalizePath(path.resolve(root, mapped))
        if (Shell.posix(shell) && text.startsWith("/")) {
          const file = yield* cygpath(shell, text)
          if (file) {
            if (mapped !== text) return file
            // cygpath 会把不认识的绝对路径挂到 Git 安装目录下
            // （`/Users/x` → `C:\Program Files\Git\Users\x`）。cygpath 结果存在
            // 时以它为准（`/tmp` 的挂载语义）；不存在而盘根解释存在的，才用盘根
            // （`/Users/x` → `C:\Users\x`）。
            if (yield* fs.existsSafe(file)) return file
            if (native !== file && (yield* fs.existsSafe(native))) return native
            return file
          }
        }
        return native
      }
      return path.resolve(root, text)
    })

    const argPath = Effect.fn("ShellTool.argPath")(function* (arg: string, cwd: string, ps: boolean, shell: string) {
      const text = ps ? expand(arg, cwd, shell) : home(unquote(arg))
      const file = text && prefix(text)
      if (!file || dynamic(file, ps)) return
      const next = ps ? provider(file) : file
      if (!next) return
      return yield* resolvePath(next, cwd, shell)
    })

    const collect = Effect.fn("ShellTool.collect")(function* (
      root: Node,
      cwd: string,
      ps: boolean,
      shell: string,
      instance: InstanceContext,
    ) {
      const scan: Scan = {
        dirs: new Set<string>(),
        patterns: new Set<string>(),
        always: new Set<string>(),
      }
      const shellKind = ShellID.toKind(Shell.name(shell))

      for (const node of commands(root)) {
        const command = parts(node)
        const tokens = command.map((item) => item.text)
        const cmd = ps || shellKind === "cmd" ? tokens[0]?.toLowerCase() : tokens[0]

        if (cmd && (FILES.has(cmd) || (shellKind === "cmd" && CMD_FILES.has(cmd)))) {
          for (const arg of pathArgs(command, ps, shellKind === "cmd")) {
            const resolved = yield* argPath(arg, cwd, ps, shell)
            log.info("resolved path", { arg, resolved })
            if (!resolved || containsPath(resolved, instance)) continue
            const dir = (yield* fs.isDir(resolved)) ? resolved : path.dirname(resolved)
            scan.dirs.add(dir)
          }
        }

        if (tokens.length && (!cmd || !CWD.has(cmd))) {
          scan.patterns.add(source(node))
          scan.always.add(BashArity.prefix(tokens).join(" ") + " *")
        }
      }

      return scan
    })

    const shellEnv = Effect.fn("ShellTool.shellEnv")(function* (ctx: Tool.Context, cwd: string) {
      const extra = yield* plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      return {
        ...process.env,
        ...extra.env,
      }
    })

    const run = Effect.fn("ShellTool.run")(function* (
      input: {
        shell: string
        command: string
        cwd: string
        env: NodeJS.ProcessEnv
        timeout: number
        description: string
        signal?: AbortSignal
        onOutput?: (text: string) => Effect.Effect<void>
      },
      ctx: Tool.Context,
    ) {
      const limits = yield* trunc.limits()
      const keep = limits.maxBytes * 2
      let full = ""
      let last = ""
      const list: Chunk[] = []
      let used = 0
      let file = ""
      let sink: ReturnType<typeof createWriteStream> | undefined
      let cut = false
      let expired = false
      let aborted = false

      const closeSink = Effect.fnUntraced(function* () {
        const stream = sink
        if (!stream) return
        sink = undefined
        if (stream.destroyed || stream.closed) return
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              let settled = false
              const done = () => {
                if (settled) return
                settled = true
                stream.off("close", done)
                stream.off("error", done)
                stream.off("finish", done)
                resolve()
              }
              stream.once("close", done)
              stream.once("error", done)
              stream.once("finish", done)
              stream.end(done)
            }),
        ).pipe(Effect.catch(() => Effect.void))
      })

      yield* ctx.metadata({
        metadata: {
          output: "",
          description: input.description,
        },
      })

      const code: number | null = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(closeSink)
          const handle = yield* spawner.spawn(cmd(input.shell, input.command, input.cwd, input.env))

          const publish = () => {
            const base = ctx.metadata({
              metadata: {
                output: last,
                description: input.description,
              },
            })
            return input.onOutput ? Effect.andThen(base, input.onOutput(last)) : base
          }

          yield* Effect.forkScoped(
            Stream.runForEach(Stream.decodeText(handle.all), (chunk) => {
              const size = Buffer.byteLength(chunk, "utf-8")
              list.push({ text: chunk, size })
              used += size
              while (used > keep && list.length > 1) {
                const item = list.shift()
                if (!item) break
                used -= item.size
                cut = true
              }

              last = preview(last + chunk)

              if (file) {
                sink?.write(chunk)
              } else {
                full += chunk
                if (Buffer.byteLength(full, "utf-8") > limits.maxBytes) {
                  return trunc.write(full).pipe(
                    Effect.andThen((next) =>
                      Effect.sync(() => {
                        file = next
                        cut = true
                        sink = createWriteStream(next, { flags: "a" })
                        full = ""
                      }),
                    ),
                    Effect.andThen(publish()),
                  )
                }
              }

              return publish()
            }),
          )

          const abort = Effect.callback<void>((resume) => {
            if (ctx.abort.aborted || input.signal?.aborted) return resume(Effect.void)
            const handler = () => resume(Effect.void)
            ctx.abort.addEventListener("abort", handler, { once: true })
            input.signal?.addEventListener("abort", handler, { once: true })
            return Effect.sync(() => {
              ctx.abort.removeEventListener("abort", handler)
              input.signal?.removeEventListener("abort", handler)
            })
          })

          const timeout = Effect.sleep(`${input.timeout + 100} millis`)

          const exit = yield* Effect.raceAll([
            handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
            abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
            timeout.pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
          ])

          if (exit.kind === "abort") {
            aborted = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }
          if (exit.kind === "timeout") {
            expired = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }

          return exit.kind === "exit" ? exit.code : null
        }),
      ).pipe(Effect.orDie)

      const meta: string[] = []
      if (expired) {
        meta.push(
          `shell tool terminated command after exceeding timeout ${input.timeout} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
        )
      }
      if (aborted) meta.push("User aborted the command")
      const raw = list.map((item) => item.text).join("")
      const end = tail(raw, limits.maxLines, limits.maxBytes)
      if (end.cut) cut = true
      if (!file && end.cut) {
        file = yield* trunc.write(raw)
      }

      let output = end.text
      if (!output) output = "(no output)"

      if (cut && file) {
        output = `...output truncated...\n\nFull output saved to: ${file}\n\n` + output
      }

      if (meta.length > 0) {
        output += "\n\n<shell_metadata>\n" + meta.join("\n") + "\n</shell_metadata>"
      }
      // 与 Claude Code 一致：非 0 退出码是失败信号，但不是所有非 0 都算失败
      // （grep/rg 的 1 = 没有匹配、diff 的 1 = 有差异、test 的 1 = 条件为假）。
      // 真正的失败在输出尾部写明退出码，模型不用再猜 metadata。
      const interpretation = typeof code === "number" ? interpretCommandResult(input.command, code) : undefined
      if (interpretation?.isError && code !== 0) {
        output += `\nExit code ${code}`
      }
      return {
        title: input.description,
        metadata: {
          output: last || preview(output),
          exit: code,
          description: input.description,
          truncated: cut,
          ...(interpretation?.message ? { returnCodeInterpretation: interpretation.message } : {}),
          ...(cut && file ? { outputPath: file } : {}),
        },
        output,
      }
    })

    return () =>
      Effect.gen(function* () {
        const cfg = yield* config.get()
        const shell = kind === "powershell" ? Shell.powershell() : Shell.acceptable(cfg.shell)
        if (!shell) throw new Error("PowerShell is not installed")
        const name = Shell.name(shell)
        const limits = yield* trunc.limits()
        // 配置文件 > 环境变量 > 内置默认值;单次调用仍可用 timeout 参数覆盖。
        const defaultTimeout = cfg.experimental?.bash_timeout ?? flags.bashDefaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
        const prompt = ShellPrompt.render(
          name,
          process.platform,
          {
            ...limits,
            timeoutMs: defaultTimeout,
            maxTimeoutMs: MAX_TIMEOUT_MS,
          },
          { dedicated: kind === "powershell" },
        )
        log.info("shell tool using shell", { shell, tool: kind })

        return {
          description: prompt.description,
          parameters: prompt.parameters,
          execute: (params: Parameters, ctx: Tool.Context) =>
            Effect.gen(function* () {
              const instanceCtx = yield* InstanceState.context
              const cwd = params.workdir
                ? yield* resolvePath(params.workdir, ctx.directory ?? instanceCtx.directory, shell)
                : (ctx.directory ?? instanceCtx.directory)
              if (params.timeout !== undefined && params.timeout < 0) {
                throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
              }

              // 常驻服务（dev server / 静态服务器）即使模型没写 background 也自动转后台：
              // 前台跑满超时会被杀掉，产物卡片里的链接就变成死链。
              const requestedBackground = params.background ?? false
              const autoBackground = !requestedBackground && looksLikeServer(params.command)
              const isBackground = requestedBackground || autoBackground

              // 后台命令默认给满 30 分钟（用户随时能在面板里停），前台仍用 2 分钟默认值。
              const timeout = isBackground
                ? Math.min(params.timeout ?? MAX_TIMEOUT_MS, MAX_TIMEOUT_MS)
                : Math.min(params.timeout ?? defaultTimeout, MAX_TIMEOUT_MS)
              const ps = Shell.ps(shell)
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const tree = yield* Effect.acquireRelease(parse(params.command, ps), (tree) =>
                    Effect.sync(() => tree.delete()),
                  )
                  const scan = yield* collect(tree.rootNode, cwd, ps, shell, instanceCtx)
                  if (!containsPath(cwd, instanceCtx)) scan.dirs.add(cwd)
                  yield* ask(ctx, scan, kind === "powershell" ? "powershell" : ShellID.ToolID)
                }),
              )

              const env = yield* shellEnv(ctx, cwd)
              const input = {
                shell,
                command: params.command,
                cwd,
                env,
                timeout,
                description: params.description,
              }

              // 所有命令都创建 BackgroundJob：状态面板能看到实时输出并停止。
              // 单独生成 id 是为了在 run 的第一帧输出时就能 update，而不必等 start 返回。
              const jobID = Identifier.ascending("job")
              const controller = new AbortController()
              const info = yield* background.start({
                id: jobID,
                type: "shell",
                title: params.description,
                metadata: {
                  parentSessionId: ctx.sessionID,
                  sessionId: ctx.sessionID,
                  tool: "shell",
                  command: params.command,
                  cwd,
                  background: isBackground,
                },
                cancel: Effect.sync(() => controller.abort()),
                run: run(
                  {
                    ...input,
                    signal: controller.signal,
                    onOutput: (text) => background.update(jobID, { output: text }).pipe(Effect.asVoid),
                  },
                  ctx,
                ).pipe(
                  // 完成时更新 BackgroundJob 的 metadata，存储完整结果（exit code, truncated 等）
                  Effect.flatMap((result) =>
                    background
                      .update(jobID, {
                        metadata: {
                          exit: result.metadata?.exit,
                          truncated: result.metadata?.truncated,
                          outputPath: result.metadata?.outputPath,
                        },
                      })
                      .pipe(Effect.as(shellOutcome(params.command, result))),
                  ),
                ),
              })

              if (isBackground) {
                return {
                  title: params.description,
                  metadata: {
                    output: `Background command started: ${info.id}`,
                    exit: null as number | null,
                    truncated: false,
                    description: params.description,
                    background: true,
                    jobID: info.id,
                    command: params.command,
                    ...(autoBackground ? { autoBackground: true } : {}),
                  },
                  output: [
                    `background: true`,
                    `job_id: ${info.id}`,
                    `command: ${params.command}`,
                    "",
                    autoBackground
                      ? "This looks like a long-lived server, so it was started in the background automatically. It keeps running (see the status panel to stop it); open the URL from the preview card when you are done checking."
                      : "The command is running in the background. Watch or stop it from the status panel.",
                  ].join("\n"),
                }
              }

              // 前台命令：等待 BackgroundJob 完成，返回完整结果。
              // 内层 run 已按 `timeout + 100ms` 杀进程并整理 `<shell_metadata>`；
              // 外层只是兜底，必须留出杀进程和收尾的余量，否则超时永远先在这里抛错。
              const waitResult = yield* background.wait({ id: jobID, timeout: timeout + 5_000 })
              if (waitResult.timedOut) {
                yield* background.cancel(jobID)
                throw new Error(`Command timed out after ${timeout}ms`)
              }
              const jobInfo = waitResult.info
              if (!jobInfo) {
                throw new Error("Command failed to complete")
              }

              // 从 BackgroundJob 的 metadata 中提取完整结果
              const metadata = jobInfo.metadata as
                | { exit?: number | null; truncated?: boolean; outputPath?: string }
                | undefined

              return {
                title: params.description,
                metadata: {
                  output: jobInfo.output ?? "(no output)",
                  // 超时/中断时 exit 为 null，不能伪装成 0（那是"成功"）。
                  exit: metadata?.exit ?? null,
                  truncated: metadata?.truncated ?? false,
                  description: params.description,
                  background: false,
                  jobID: info.id,
                  command: params.command,
                  ...(metadata?.outputPath ? { outputPath: metadata.outputPath } : {}),
                },
                output: jobInfo.output ?? "(no output)",
              }
            }),
        }
      })
  })

export const ShellTool = Tool.define(ShellID.ToolID, definition("auto"))

/** Dedicated PowerShell tool (CC `PowerShell`); registered only when installed. */
export const PowerShellTool = Tool.define("powershell", definition("powershell"))
