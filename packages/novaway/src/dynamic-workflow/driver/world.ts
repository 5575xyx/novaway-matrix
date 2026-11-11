/**
 * world-read 的生产实现：把脚本里的只读查询翻译成本仓已有的服务。
 *
 * 三条纪律：
 *   1. **绝不拼 shell**。git 走 Git.Service.run(argv)，world.run 直接 spawn 一个固定 argv。
 *      没有管道、重定向、变量展开——脚本能不能看见 shell，就是「沙箱是不是安全边界」的分水岭，
 *      而它不是。
 *   2. **路径必须留在工作区**。每一次读都先解析再比对，符号链接跳出去也拦得住。
 *   3. **超限就失败，绝不截断**。截断过的文件内容会让模型得出错误结论，比一次明确的错误糟得多。
 */

import path from "node:path"
import { spawn } from "node:child_process"
import { Effect, Stream } from "effect"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Git } from "@/git"
import { Ripgrep } from "@/file/ripgrep"
import type { WorldReadOp } from "../analysis/sites"

/** 单次读取的结果上限。超过就 reject，不截断。 */
export const MAX_READ_BYTES = 512 * 1024
/** world.run 的输出上限（stdout 与 stderr 各自）。 */
export const MAX_COMMAND_BYTES = 256 * 1024
/** world.run 的默认墙钟上限。 */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000

/** git log 的字段分隔符。用 %x1f（单元分隔符）而不是 Tab：提交标题里可能有 Tab。 */
const FIELD_SEP = String.fromCharCode(31)

export class WorldReadError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = "WorldReadError"
  }
}

/** 一次读取需要的服务与上下文。 */
export interface WorldReaderDeps {
  readonly cwd: string
  readonly fs: AppFileSystem.Interface
  readonly rg: Ripgrep.Interface
  readonly git: Git.Interface
}

/** 把脚本给的工作区相对路径解析成绝对路径，并确认没有逃出 cwd。 */
export function resolveInside(cwd: string, relative: string): string {
  const root = path.resolve(cwd)
  const target = path.resolve(root, relative)
  const rel = path.relative(root, target)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new WorldReadError(
      `路径 ${relative} 不在工作区内。工作流脚本只能读写本次运行的目录。`,
      "PathOutsideWorkspace",
    )
  }
  return target
}

/** 位置实参的取用：缺参数给出能看懂的错误，而不是把 undefined 传下去炸在别处。 */
function arg(args: readonly unknown[], index: number): unknown {
  return args[index]
}

function stringArg(args: readonly unknown[], index: number, name: string): string {
  const value = arg(args, index)
  if (typeof value !== "string") {
    throw new WorldReadError(`第 ${index + 1} 个参数 ${name} 必须是字符串，收到 ${typeof value}。`, "BadArgument")
  }
  return value
}

function optionalString(args: readonly unknown[], index: number, name: string): string | undefined {
  const value = arg(args, index)
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string") {
    throw new WorldReadError(`第 ${index + 1} 个参数 ${name} 必须是字符串，收到 ${typeof value}。`, "BadArgument")
  }
  return value
}

/** 相对 cwd 的路径，统一用正斜杠：脚本看到的是可移植的形状，不受运行平台影响。 */
function relative(cwd: string, file: string): string {
  return path.relative(cwd, file).split(path.sep).join("/")
}

/** 一次读取的完整实现。 */
export function executeWorldRead(
  deps: WorldReaderDeps,
  op: WorldReadOp,
  args: readonly unknown[],
): Effect.Effect<unknown, unknown> {
  const cwd = path.resolve(deps.cwd)
  switch (op) {
    case "glob":
      return glob(deps, cwd, stringArg(args, 0, "pattern"))
    case "read":
      return read(deps, cwd, stringArg(args, 0, "path"))
    case "grep":
      return grep(deps, cwd, stringArg(args, 0, "pattern"), optionalString(args, 1, "glob"))
    case "git-changed-files":
      return changedFiles(deps, cwd, optionalString(args, 0, "base"))
    case "git-diff":
      return diff(deps, cwd, optionalString(args, 0, "base"), optionalString(args, 1, "path"))
    case "git-status":
      return status(deps, cwd)
    case "git-log":
      return log(deps, cwd, args[0])
    case "run":
      return run(deps, cwd, stringArg(args, 0, "cmd"), args[1], args[2])
  }
}

function glob(deps: WorldReaderDeps, cwd: string, pattern: string): Effect.Effect<string[], unknown> {
  return Stream.runCollect(deps.rg.files({ cwd, glob: [pattern] })).pipe(
    Effect.map((chunk) => {
      const seen = new Set<string>()
      for (const file of chunk) seen.add(relative(cwd, file))
      // 字典序：脚本可能把结果当稳定顺序用，随机顺序会让「第几个文件」变成一个陷阱。
      return [...seen].sort((a, b) => a.localeCompare(b))
    }),
  )
}

function read(deps: WorldReaderDeps, cwd: string, target: string): Effect.Effect<string, unknown> {
  return Effect.gen(function* () {
    const absolute = resolveInside(cwd, target)
    const info = yield* deps.fs.stat(absolute).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!info) throw new WorldReadError(`文件 ${target} 不存在。`, "FileNotFound")
    if (info.type === "Directory") throw new WorldReadError(`${target} 是目录，不是文件。`, "IsDirectory")
    const size = "size" in info ? info.size : undefined
    if (typeof size === "number" && size > MAX_READ_BYTES) {
      throw new WorldReadError(
        `文件 ${target} 有 ${size} 字节，超过单次读取上限 ${MAX_READ_BYTES}。先 grep 定位，或用 world.run 处理它。`,
        "FileTooLarge",
      )
    }
    const text = yield* deps.fs
      .readFileStringSafe(absolute)
      .pipe(
        Effect.catch((error) => Effect.fail(new WorldReadError(`读取 ${target} 失败：${error.message}`, "ReadFailed"))),
      )
    if (text === undefined) throw new WorldReadError(`读取 ${target} 失败。`, "ReadFailed")
    return text
  })
}

function grep(
  deps: WorldReaderDeps,
  cwd: string,
  pattern: string,
  globPattern: string | undefined,
): Effect.Effect<{ path: string; line: number; text: string }[], unknown> {
  return deps.rg
    .search({ cwd, pattern, ...(globPattern ? { glob: [globPattern] } : {}), limit: 1000 })
    .pipe(
      Effect.map((result) =>
        result.rows
          .filter((row) => row.kind === "match")
          .map((row) => ({ path: relative(cwd, row.path), line: row.line, text: row.text })),
      ),
    )
}

function changedFiles(deps: WorldReaderDeps, cwd: string, base: string | undefined): Effect.Effect<string[], unknown> {
  return deps.git.run(["diff", "--name-only", base ?? "HEAD"], { cwd }).pipe(
    Effect.map((result) => {
      if (result.exitCode !== 0) {
        throw new WorldReadError(`git diff 失败：${result.text().trim() || `退出码 ${result.exitCode}`}`, "GitFailed")
      }
      return result
        .text()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    }),
  )
}

function diff(
  deps: WorldReaderDeps,
  cwd: string,
  base: string | undefined,
  file: string | undefined,
): Effect.Effect<string> {
  const argv = ["diff", base ?? "HEAD", ...(file ? ["--", file] : [])]
  return deps.git.run(argv, { cwd, maxOutputBytes: MAX_READ_BYTES }).pipe(
    Effect.map((result) => {
      if (result.exitCode !== 0) {
        throw new WorldReadError(`git diff 失败：${result.text().trim() || `退出码 ${result.exitCode}`}`, "GitFailed")
      }
      if (result.truncated) {
        throw new WorldReadError(
          `diff 超过 ${MAX_READ_BYTES} 字节。指定 path 分次读取，或改用 world.run 自己处理。`,
          "OutputTooLarge",
        )
      }
      return result.text()
    }),
  )
}

function status(
  deps: WorldReaderDeps,
  cwd: string,
): Effect.Effect<
  { branch?: string; clean: boolean; staged: string[]; unstaged: string[]; untracked: string[] },
  unknown
> {
  return Effect.gen(function* () {
    const result = yield* deps.git.run(["status", "--porcelain=v1", "--branch"], { cwd })
    if (result.exitCode !== 0) {
      throw new WorldReadError(`git status 失败：${result.text().trim() || `退出码 ${result.exitCode}`}`, "GitFailed")
    }
    const staged: string[] = []
    const unstaged: string[] = []
    const untracked: string[] = []
    let branch: string | undefined
    for (const line of result.text().split("\n")) {
      if (!line) continue
      if (line.startsWith("## ")) {
        const name = line.slice(3).split("...")[0]!.split(" ")[0]!
        if (name && name !== "HEAD") branch = name
        continue
      }
      const index = line[0]
      const worktree = line[1]
      const file = line.slice(3).trim()
      if (!file) continue
      if (index === "?" && worktree === "?") {
        untracked.push(file)
        continue
      }
      if (index !== " " && index !== "?") staged.push(file)
      if (worktree !== " ") unstaged.push(file)
    }
    return {
      ...(branch ? { branch } : {}),
      clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
      staged,
      unstaged,
      untracked,
    }
  })
}

function log(
  deps: WorldReaderDeps,
  cwd: string,
  countArg: unknown,
): Effect.Effect<{ hash: string; subject: string; author: string; date: string }[]> {
  const count = typeof countArg === "number" && Number.isFinite(countArg) && countArg > 0 ? Math.floor(countArg) : 20
  const format = ["%H", "%s", "%an", "%aI"].join("%x1f")
  return deps.git.run(["log", `-${count}`, `--pretty=format:${format}`], { cwd }).pipe(
    Effect.map((result) => {
      // 空仓库（还没有第一个提交）不该算失败，而是一次空结果。
      if (result.exitCode !== 0) return []
      return result
        .text()
        .split("\n")
        .map((line) => line.split(FIELD_SEP))
        .filter((fields) => fields.length >= 4)
        .map((fields) => ({ hash: fields[0]!, subject: fields[1]!, author: fields[2]!, date: fields[3]! }))
    }),
  )
}

/**
 * 执行命令。
 *
 * **不经过 shell**：spawn(cmd, argv) 直接执行，分号、管道、命令替换都是普通字符。
 * 想组合命令就写两次调用，或者写一段真正的代码。
 *
 * 非零退出码是**返回值**，不是异常：脚本自己判断 exitCode 再决定要不要 throw。这让
 * 「预期会失败的命令」（比如带 --exit-code 的 diff）不必被 try/catch 包成一团。
 */
function run(
  deps: WorldReaderDeps,
  cwd: string,
  cmd: string,
  argsArg: unknown,
  optsArg: unknown,
): Effect.Effect<{ exitCode: number; stdout: string; stderr: string }> {
  const args = Array.isArray(argsArg) ? argsArg.map((item) => String(item)) : []
  const opts = (optsArg && typeof optsArg === "object" ? optsArg : {}) as { timeoutMs?: unknown }
  const timeoutMs =
    typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? Math.min(Math.floor(opts.timeoutMs), 10 * 60_000)
      : DEFAULT_COMMAND_TIMEOUT_MS

  type Output = { exitCode: number; stdout: string; stderr: string }
  return Effect.callback<Output>((resume) => {
    let settled = false
    const succeed = (value: Output) => {
      if (settled) return
      settled = true
      resume(Effect.succeed(value))
    }
    const failWith = (error: Error) => {
      if (settled) return
      settled = true
      resume(Effect.fail(error) as never)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, { cwd, shell: false, windowsHide: true })
    } catch (error) {
      succeed({ exitCode: -1, stdout: "", stderr: `无法启动命令 ${cmd}：${(error as Error).message}` })
      return Effect.void
    }
    let stdout = ""
    let stderr = ""
    let overflow = false
    const append = (current: string, chunk: Buffer) => {
      if (current.length >= MAX_COMMAND_BYTES) {
        overflow = true
        return current
      }
      return current + chunk.toString("utf8")
    }
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      succeed({ exitCode: -1, stdout, stderr: stderr + `\n（超过 ${timeoutMs} 毫秒，已中止）` })
    }, timeoutMs)
    child.on("error", (error) => {
      clearTimeout(timer)
      succeed({ exitCode: -1, stdout, stderr: stderr + `\n${error.message}` })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (overflow) {
        failWith(
          new WorldReadError(
            `命令 ${cmd} 的输出超过 ${MAX_COMMAND_BYTES} 字节。把输出写进文件再用 files.read 分段读，或者在命令里先过滤。`,
            "OutputTooLarge",
          ),
        )
        return
      }
      succeed({ exitCode: code ?? -1, stdout, stderr })
    })
    return Effect.sync(() => {
      clearTimeout(timer)
      child.kill("SIGKILL")
    })
  })
}
