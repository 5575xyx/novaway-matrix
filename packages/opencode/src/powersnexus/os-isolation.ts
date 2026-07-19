import { Effect, Schema } from "effect"
import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import type { IsolationStatus } from "./isolation"

export type ProcessIsolationMode = "logical" | "os"

export type IsolatedRunResult = {
  exitCode: number
  stdout: Buffer
  stderr: Buffer
  timedOut: boolean
  /** 是否以受限 Token / 降权策略启动 */
  restricted: boolean
}

export type RunJob = {
  readonly id: string
  readonly mode: ProcessIsolationMode
  readonly platform: string
  /** 将已启动进程纳入隔离组（Windows Job / 逻辑 PID 跟踪）。 */
  assign(pid: number): void
  /** 终止隔离组内全部进程。 */
  terminate(): void
  /** 在隔离组内启动并等待命令结束。 */
  run(
    argv: string[],
    options: {
      cwd: string
      timeoutMs: number
      env?: NodeJS.ProcessEnv
    },
  ): Effect.Effect<IsolatedRunResult, never>
  dispose(): void
}

export class OsIsolationError extends Schema.TaggedErrorClass<OsIsolationError>()("PowersNexusOsIsolationError", {
  code: Schema.String,
  message: Schema.String,
}) {}

const jobs = new Map<string, RunJob>()

/** 每个 delivery run 允许的最大活动进程数（Job Object ActiveProcessLimit）。 */
export const DEFAULT_ACTIVE_PROCESS_LIMIT = 48

/** Windows Job Object 是否可用（仅 win32 且 FFI 加载成功）。 */
export function isOsIsolationAvailable(): boolean {
  if (process.platform !== "win32") return false
  if (process.env.POWERSNEXUS_OS_ISOLATION === "0") return false
  try {
    return Boolean(getWin32Api())
  } catch {
    return false
  }
}

/** 受限 Token API 是否可用（CreateRestrictedToken 探测成功）。 */
export function isRestrictedTokenAvailable(): boolean {
  if (process.platform !== "win32") return false
  if (process.env.POWERSNEXUS_RESTRICTED_TOKEN === "0") return false
  try {
    return Boolean(getAdvapiApi() && probeRestrictedToken())
  } catch {
    return false
  }
}

export type SandboxCapabilities = {
  jobObject: boolean
  restrictedToken: boolean
  activeProcessLimit: number
  worktreeTempSandbox: boolean
  argvWriteGuard: boolean
}

export function sandboxCapabilities(): SandboxCapabilities {
  return {
    jobObject: isOsIsolationAvailable(),
    restrictedToken: isRestrictedTokenAvailable(),
    activeProcessLimit: DEFAULT_ACTIVE_PROCESS_LIMIT,
    worktreeTempSandbox: true,
    argvWriteGuard: true,
  }
}

/** 报告隔离状态：Windows 且 Job Object 可用时标记 mode=os。 */
export function processIsolationStatus(): IsolationStatus {
  if (isOsIsolationAvailable()) {
    const token = isRestrictedTokenAvailable()
    return {
      mode: "os",
      platform: process.platform,
      worktreeOnlyWrite: true,
      networkDefault: "ask",
      autoLocalDeliveryScope: "worktree_only",
      note: token
        ? "Windows Job Object + 写路径/TEMP 沙箱 + 受限 Token(Safer CONSTRAINED)"
        : "Windows Job Object + 写路径/TEMP 沙箱（Safer 受限 Token 不可用则降级）",
    }
  }
  return {
    mode: "logical",
    platform: process.platform,
    worktreeOnlyWrite: true,
    networkDefault: "ask",
    autoLocalDeliveryScope: "worktree_only",
    note:
      process.platform === "win32"
        ? "Windows Job Object 不可用，当前为逻辑权限模式"
        : "当前平台尚未启用 OS 级隔离，当前为逻辑权限模式",
  }
}

export function createRunJob(runID: string): RunJob {
  const existing = jobs.get(runID)
  if (existing) return existing
  const job = isOsIsolationAvailable() ? createWin32Job(runID) : createLogicalJob(runID)
  jobs.set(runID, job)
  return job
}

export function getRunJob(runID: string): RunJob | undefined {
  return jobs.get(runID)
}

export function disposeRunJob(runID: string) {
  const job = jobs.get(runID)
  if (!job) return
  try {
    job.terminate()
  } catch {
    // ignore
  }
  job.dispose()
  jobs.delete(runID)
}

function createLogicalJob(runID: string): RunJob {
  const pids = new Set<number>()
  let disposed = false
  return {
    id: runID,
    mode: "logical",
    platform: process.platform,
    assign(pid) {
      if (!disposed && Number.isFinite(pid) && pid > 0) pids.add(pid)
    },
    terminate() {
      for (const pid of pids) {
        try {
          if (process.platform === "win32") {
            spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
          } else {
            process.kill(-pid, "SIGKILL")
          }
        } catch {
          try {
            process.kill(pid, "SIGKILL")
          } catch {
            // ignore
          }
        }
      }
      pids.clear()
    },
    run(argv, options) {
      return Effect.promise(() => runTracked(argv, options, (pid) => this.assign(pid)))
    },
    dispose() {
      disposed = true
      pids.clear()
    },
  }
}

type Win32Api = {
  CreateJobObjectW: (a: null, b: null) => number
  AssignProcessToJobObject: (job: number, process: number) => number
  TerminateJobObject: (job: number, code: number) => number
  CloseHandle: (h: number) => number
  OpenProcess: (access: number, inherit: number, pid: number) => number
  SetInformationJobObject: (job: number, infoClass: number, info: any, length: number) => number
  GetLastError: () => number
}

let win32Api: Win32Api | null | undefined

function getWin32Api(): Win32Api | null {
  if (win32Api !== undefined) return win32Api
  if (process.platform !== "win32") {
    win32Api = null
    return null
  }
  try {
    // Bun.FFI.dlopen — 绑定 kernel32 Job Object API
    const { dlopen, ptr, toBuffer } = (Bun as any).FFI
    const lib = dlopen("kernel32.dll", {
      CreateJobObjectW: { args: ["ptr", "ptr"], returns: "ptr" },
      AssignProcessToJobObject: { args: ["ptr", "ptr"], returns: "bool" },
      TerminateJobObject: { args: ["ptr", "u32"], returns: "bool" },
      CloseHandle: { args: ["ptr"], returns: "bool" },
      OpenProcess: { args: ["u32", "bool", "u32"], returns: "ptr" },
      SetInformationJobObject: { args: ["ptr", "i32", "ptr", "u32"], returns: "bool" },
      GetLastError: { args: [], returns: "u32" },
    })
    const symbols = lib.symbols
    win32Api = {
      CreateJobObjectW: () => Number(symbols.CreateJobObjectW(null, null)),
      AssignProcessToJobObject: (job, process) => (symbols.AssignProcessToJobObject(job, process) ? 1 : 0),
      TerminateJobObject: (job, code) => (symbols.TerminateJobObject(job, code) ? 1 : 0),
      CloseHandle: (h) => (symbols.CloseHandle(h) ? 1 : 0),
      OpenProcess: (access, inherit, pid) => Number(symbols.OpenProcess(access, inherit, pid)),
      SetInformationJobObject: (job, infoClass, info, length) =>
        symbols.SetInformationJobObject(job, infoClass, info, length) ? 1 : 0,
      GetLastError: () => Number(symbols.GetLastError()),
    }
    // 探测：能否创建 Job
    const probe = win32Api.CreateJobObjectW(null, null)
    if (!probe) {
      win32Api = null
      return null
    }
    // 设置 KillOnJobClose
    enableJobLimits(win32Api, probe)
    win32Api.CloseHandle(probe)
    return win32Api
  } catch {
    win32Api = null
    return null
  }
}

// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
// JobObjectExtendedLimitInformation = 9
function enableJobLimits(api: Win32Api, job: number) {
  // JOBOBJECT_EXTENDED_LIMIT_INFORMATION (class 9) on x64 ~144 bytes
  // BasicLimitInformation.LimitFlags @ offset 16
  // BasicLimitInformation.ActiveProcessLimit @ offset 40
  // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
  // JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x0008
  const buf = new ArrayBuffer(144)
  const view = new DataView(buf)
  view.setUint32(16, 0x2000 | 0x0008, true)
  view.setUint32(40, DEFAULT_ACTIVE_PROCESS_LIMIT, true)
  try {
    const { ptr } = (Bun as any).FFI
    api.SetInformationJobObject(job, 9, ptr(buf), 144)
  } catch {
    // 若结构布局失败，仍保留 Job 用于 Assign/Terminate
  }
}

function createWin32Job(runID: string): RunJob {
  const api = getWin32Api()
  if (!api) return createLogicalJob(runID)
  const job = api.CreateJobObjectW(null, null)
  if (!job) return createLogicalJob(runID)
  enableJobLimits(api, job)
  const PROCESS_ALL_ACCESS = 0x1f0fff
  const PROCESS_SET_QUOTA = 0x0100
  const PROCESS_TERMINATE = 0x0001
  const PROCESS_SUSPEND_RESUME = 0x0800
  const assignAccess = PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_SUSPEND_RESUME | 0x0400 // SYNCHRONIZE-ish
  let disposed = false
  const assigned = new Set<number>()

  const assign = (pid: number) => {
    if (disposed || !Number.isFinite(pid) || pid <= 0 || assigned.has(pid)) return
    const handle = api.OpenProcess(PROCESS_ALL_ACCESS, 0, pid) || api.OpenProcess(assignAccess, 0, pid)
    if (!handle) return
    try {
      if (api.AssignProcessToJobObject(job, handle)) assigned.add(pid)
    } finally {
      api.CloseHandle(handle)
    }
  }

  return {
    id: runID,
    mode: "os",
    platform: "win32",
    assign,
    terminate() {
      if (disposed) return
      api.TerminateJobObject(job, 1)
      assigned.clear()
    },
    run(argv, options) {
      return Effect.promise(() =>
        runTracked(argv, options, (pid) => {
          assign(pid)
        }),
      )
    },
    dispose() {
      if (disposed) return
      disposed = true
      try {
        api.TerminateJobObject(job, 1)
      } catch {
        // ignore
      }
      api.CloseHandle(job)
      assigned.clear()
    },
  }
}

function runTracked(
  argv: string[],
  options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
  onSpawn: (pid: number) => void,
): Promise<IsolatedRunResult> {
  return new Promise((resolve) => {
    if (argv.length === 0) {
      resolve({ exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("empty argv"), timedOut: false, restricted: false })
      return
    }
    const child: ChildProcess = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    if (child.pid) onSpawn(child.pid)

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
        } else {
          child.kill("SIGKILL")
        }
      } catch {
        // ignore
      }
    }, Math.max(1, options.timeoutMs))

    child.stdout?.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)))
    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.from(err.message),
        timedOut,
        restricted: false,
      })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({
        exitCode: code ?? (timedOut ? 1 : 0),
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        timedOut,
        restricted: false,
      })
    })
  })
}



type SaferApi = {
  SaferCreateLevel: (scope: number, level: number, openFlags: number, levelOut: any, reserved: any) => number
  SaferComputeTokenFromLevel: (
    level: number,
    inToken: any,
    outToken: any,
    flags: number,
    reserved: any,
  ) => number
  SaferCloseLevel: (level: number) => number
}

let saferApi: SaferApi | null | undefined
let restrictedProbe: boolean | undefined

function getSaferApi(): SaferApi | null {
  if (saferApi !== undefined) return saferApi
  if (process.platform !== "win32") {
    saferApi = null
    return null
  }
  try {
    const { dlopen } = (Bun as any).FFI
    const adv = dlopen("advapi32.dll", {
      SaferCreateLevel: { args: ["u32", "u32", "u32", "ptr", "ptr"], returns: "i32" },
      SaferComputeTokenFromLevel: { args: ["ptr", "ptr", "ptr", "u32", "ptr"], returns: "i32" },
      SaferCloseLevel: { args: ["ptr"], returns: "i32" },
    })
    saferApi = {
      SaferCreateLevel: (scope, level, openFlags, levelOut, reserved) =>
        adv.symbols.SaferCreateLevel(scope, level, openFlags, levelOut, reserved) ? 1 : 0,
      SaferComputeTokenFromLevel: (level, inToken, outToken, flags, reserved) =>
        adv.symbols.SaferComputeTokenFromLevel(level, inToken, outToken, flags, reserved) ? 1 : 0,
      SaferCloseLevel: (level) => (adv.symbols.SaferCloseLevel(level) ? 1 : 0),
    }
    return saferApi
  } catch {
    saferApi = null
    return null
  }
}

// SAFER_SCOPEID_USER=2, SAFER_LEVELID_CONSTRAINED=0x10000, SAFER_LEVEL_OPEN=1
const SAFER_SCOPEID_USER = 2
const SAFER_LEVELID_CONSTRAINED = 0x10000
const SAFER_LEVEL_OPEN = 1

function probeRestrictedToken(): boolean {
  if (restrictedProbe !== undefined) return restrictedProbe
  const handle = createRestrictedTokenHandle()
  if (!handle) {
    restrictedProbe = false
    return false
  }
  const k32 = getWin32Api()
  if (k32) k32.CloseHandle(handle)
  restrictedProbe = true
  return true
}

/** 通过 Windows Safer API 创建约束级 Token；失败返回 0。调用方负责 CloseHandle。 */
export function createRestrictedTokenHandle(): number {
  const api = getSaferApi()
  const k32 = getWin32Api()
  if (!api || !k32) return 0
  try {
    const { ptr } = (Bun as any).FFI
    const levelBuf = new BigUint64Array(1)
    if (!api.SaferCreateLevel(SAFER_SCOPEID_USER, SAFER_LEVELID_CONSTRAINED, SAFER_LEVEL_OPEN, ptr(levelBuf), null)) {
      return 0
    }
    const level = Number(levelBuf[0])
    if (!level) return 0
    const tokenBuf = new BigUint64Array(1)
    const ok = api.SaferComputeTokenFromLevel(level, null, ptr(tokenBuf), 0, null)
    api.SaferCloseLevel(level)
    if (!ok) return 0
    return Number(tokenBuf[0]) || 0
  } catch {
    return 0
  }
}

/** 兼容旧探测路径：advapi 入口改走 Safer。 */
function getAdvapiApi(): SaferApi | null {
  return getSaferApi()
}

export * as PowersNexusOsIsolation from "./os-isolation"
