/**
 * 本地 MCP 的命令解析：让「机器上什么都没装」也能启动 stdio server。
 *
 * 配置里常见的写法是 `npx -y <package>`、`node <script>`、`uvx <package>`。
 * 在干净的 Windows 机器上这三样都可能不存在，MCP 就会报 `spawn ENOENT`，
 * 而用户完全不知道缺的是什么。ZCode 的做法是给 MCP 子进程准备 node/npm 回退
 * （见其 `mcp-node-fallback.md`）：用户自己的 node/npm 优先，缺失时才用内置的。
 *
 * 这里做同样的事，但按我们的运行时组织：
 * - 桌面端随包带一份 Node（`NOVAWAY_NODE_PATH`），npm/npx 用它跑 `bin/*-cli.js`；
 * - uv 走 NovaWay 自己下载的那份（`Global.Path.bin/uv`），`uvx` 等价于 `uv tool run`；
 * - 用户 PATH 上已有的命令永远优先，回退只在缺失时生效。
 *
 * 解析是纯函数（`planLocalCommand`），宿主相关的路径探测单独做，方便测试。
 */
import fs from "node:fs"
import path from "node:path"
import { Global } from "@novaway/core/global"
import { which } from "@/util/which"
import { downloadUv, uvBinary, uvDownloadUrls } from "@/python/venv"

export type RuntimePaths = {
  /** 内置 / 显式指定的 Node 可执行文件。 */
  node?: string
  /** 内置 npm 包根目录（含 bin/npm-cli.js 与 bin/npx-cli.js）。 */
  npmRoot?: string
  /** uv 可执行文件（`uvx` 的回退入口）。 */
  uv?: string
}

export type PlannedCommand = {
  command: string[]
  /** 需要合并进子进程的环境变量（PATH 前置、npm 提示关闭等）。 */
  env: Record<string, string>
  /** 用了回退时的说明，写日志和诊断用。 */
  fallback?: string
}

export type PlanFailure = { error: string }

const WINDOWS = process.platform === "win32"
const EXEC_SUFFIXES = [".exe", ".cmd", ".bat", ".ps1"]
const SHELLS = new Set(["cmd", "cmd.exe", "sh", "bash", "zsh", "dash", "pwsh", "powershell"])

function stubName(value: string) {
  const base = path.basename(value).toLowerCase()
  const suffix = EXEC_SUFFIXES.find((item) => base.endsWith(item))
  return suffix ? base.slice(0, -suffix.length) : base
}

/**
 * 展开 `cmd /c npx ...`、`sh -c "node x.js"` 这类包装。
 *
 * 只展开「第一段就是 shell + 执行开关」的形态；展开失败就原样返回，
 * 让调用方按外部命令处理（不做更聪明的猜测）。
 */
export function unwrapShell(command: string[]): string[] {
  if (command.length === 0) return command
  const base = stubName(command[0])
  if (!SHELLS.has(base)) return command

  const rest = command.slice(1)
  const flagIndex = rest.findIndex((item) => /^\/[cCkK]$/.test(item) || item === "-c" || item === "-Command")
  if (flagIndex === -1) return command
  const script = rest.slice(flagIndex + 1)
  if (script.length === 0) return command

  // `cmd /c "npx -y pkg"` 只有一个字符串参数，按空白拆开即可（MCP 命令里很少带引号）。
  if (script.length === 1 && /\s/.test(script[0])) {
    const tokens = script[0]
      .trim()
      .split(/\s+/)
      .map((item) => item.replace(/^["']|["']$/g, ""))
      .filter(Boolean)
    return tokens.length > 0 ? tokens : command
  }
  return script
}

/** npm 包根目录的候选位置（不同平台的 Node 分发包布局不同）。 */
function npmCandidates(nodePath: string) {
  const dir = path.dirname(nodePath)
  const parent = path.dirname(dir)
  return [
    // Windows / 便携布局：<node>/node_modules/npm
    path.join(dir, "node_modules", "npm"),
    // 官方 unix 分发包：<node>/bin/node + <node>/lib/node_modules/npm
    path.join(parent, "lib", "node_modules", "npm"),
    path.join(dir, "lib", "node_modules", "npm"),
    path.join(parent, "node_modules", "npm"),
  ]
}

function npmRootFor(nodePath: string) {
  for (const candidate of npmCandidates(nodePath)) {
    if (fs.existsSync(path.join(candidate, "bin", "npx-cli.js"))) return candidate
  }
  return undefined
}

/**
 * 探测宿主上的可用运行时。
 *
 * `NOVAWAY_NODE_PATH` / `NOVAWAY_NPM_ROOT` 由桌面端设置；开发环境里它们是相对值
 * （`node`），此时不当作回退 —— 开发机上本来就有 Node。
 */
export function runtimePaths(env: NodeJS.ProcessEnv = process.env): RuntimePaths {
  const result: RuntimePaths = {}
  const node = env.NOVAWAY_NODE_PATH?.trim()
  if (node && path.isAbsolute(node) && fs.existsSync(node)) {
    result.node = node
    const npmRoot = env.NOVAWAY_NPM_ROOT?.trim()
    const resolvedRoot = npmRoot && fs.existsSync(path.join(npmRoot, "bin", "npx-cli.js")) ? npmRoot : npmRootFor(node)
    if (resolvedRoot) result.npmRoot = resolvedRoot
  }
  const uv = env.NOVAWAY_UV_PATH?.trim() || path.join(Global.Path.bin, WINDOWS ? "uv.exe" : "uv")
  if (fs.existsSync(uv)) result.uv = uv
  return result
}

/** 把目录放到 PATH 最前面（嵌套的 `#!/usr/bin/env node` 也就能找到了）。 */
export function prependPath(dir: string, current: string | undefined, platform: NodeJS.Platform = process.platform) {
  const delimiter = platform === "win32" ? ";" : ":"
  const parts = (current ?? "").split(delimiter).filter(Boolean)
  if (parts.includes(dir)) return parts.join(delimiter)
  return [dir, ...parts].join(delimiter)
}

export type PlanInput = {
  command: string[]
  /** PATH 探测（测试注入）。 */
  has: (bin: string) => boolean
  runtime: RuntimePaths
  /** 当前 PATH，用于拼子进程 PATH。 */
  path?: string
  platform?: NodeJS.Platform
}

/**
 * 把配置里的命令解析成真正能 spawn 的命令。
 *
 * 规则（与 ZCode 的 node fallback 一致）：
 * 1. 用户机器上有的东西永远优先；
 * 2. `node` 缺失 → 内置 Node；
 * 3. `npx` / `npm` 缺失 → 内置 Node + 内置 npm 的 CLI 脚本；
 * 4. `uvx` 缺失 → `uv tool run`（uv 在 PATH 或由 NovaWay 下载）。
 * 仍然找不到就给出能直接写给用户看的原因，而不是 `spawn ENOENT`。
 */
export function planLocalCommand(input: PlanInput): PlannedCommand | PlanFailure {
  const platform = input.platform ?? process.platform
  if (input.command.length === 0) return { error: "配置里没有 command" }

  const tokens = unwrapShell(input.command)
  if (tokens.length === 0) return { error: "配置里的 command 是空的" }

  const base = stubName(tokens[0])
  const rest = tokens.slice(1)

  if (base === "node") {
    if (input.has("node")) return { command: tokens, env: {} }
    if (input.runtime.node) {
      return {
        command: [input.runtime.node, ...rest],
        env: { PATH: prependPath(path.dirname(input.runtime.node), input.path, platform) },
        fallback: "node",
      }
    }
    return { error: "本机没有 Node.js，也没有可用的内置 Node 运行时" }
  }

  if (base === "npx" || base === "npm") {
    if (input.has(base)) return { command: input.command, env: {} }
    const npmRoot = input.runtime.npmRoot
    const node = input.runtime.node
    if (!npmRoot || !node) {
      return {
        error:
          "本机没有 " +
          base +
          "，也没有可用的内置 npm（桌面端随包提供）。请安装 Node.js，或改用不依赖 npm 的 MCP 服务器。",
      }
    }
    return {
      command: [node, path.join(npmRoot, "bin", base + "-cli.js"), ...rest],
      // npm 会 spawn `#!/usr/bin/env node` 的 bin，PATH 里必须有内置 Node。
      env: {
        PATH: prependPath(path.dirname(node), input.path, platform),
        npm_config_update_notifier: "false",
      },
      fallback: base,
    }
  }

  if (base === "uvx") {
    if (input.has("uvx")) return { command: input.command, env: {} }
    const uv = input.runtime.uv ?? (input.has("uv") ? "uv" : undefined)
    if (uv) {
      return {
        command: [uv, "tool", "run", ...rest],
        env: {},
        fallback: "uvx",
      }
    }
    return {
      error: "本机没有 uv/uvx，这个 MCP 服务器需要 Python 运行时。请安装 uv（或改用在线的 MCP 服务器）。",
    }
  }

  return { command: input.command, env: {} }
}

/** 宿主上的实际解析：PATH 探测用 which，运行时用环境变量推出来。 */
export function planLocalCommandForHost(
  command: string[],
  env: NodeJS.ProcessEnv = process.env,
): PlannedCommand | PlanFailure {
  const has = (bin: string) => Boolean(which(bin, env))
  return planLocalCommand({
    command,
    has,
    runtime: runtimePaths(env),
    path: env.PATH ?? env.Path,
  })
}

/** 这个命令是不是要靠 uvx 起（决定要不要临时准备 uv）。 */
export function needsUv(command: string[]): boolean {
  const tokens = unwrapShell(command)
  return tokens.length > 0 && stubName(tokens[0]) === "uvx"
}

let uvDownload: Promise<string | undefined> | undefined

/**
 * uvx 的最终兜底：本机没有 uv/uvx 时，自己下载一份到 `Global.Path.bin`。
 *
 * 桌面端随包不带 uv（只有一个二进制，联网下载更省体积）。同一个进程只尝试一次，
 * 失败就返回 undefined，让配置里的 MCP 显示可读的失败原因，而不是反复重试。
 */
export function ensureUv(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const existing = runtimePaths(env).uv
  if (existing) return Promise.resolve(existing)
  if (uvDownload) return uvDownload
  uvDownload = (async () => {
    const target = uvBinary()
    try {
      for (const url of uvDownloadUrls()) {
        try {
          await downloadUv({
            url,
            target,
            onMessage: () => undefined,
            onLog: () => undefined,
          })
          return target
        } catch {
          // 直连失败就换镜像，全都失败才放弃。
        }
      }
      return undefined
    } finally {
      // 失败也允许下次再试：用户可能刚好换了网络。
      setTimeout(() => {
        uvDownload = undefined
      }, 60_000).unref?.()
    }
  })()
  return uvDownload
}

/** 给诊断工具用的一句说明；没有回退时返回 undefined。 */
export function describeFallback(plan: PlannedCommand) {
  if (!plan.fallback) return undefined
  return plan.fallback + " 由 NovaWay 内置运行时提供：" + plan.command.slice(0, 2).join(" ")
}
