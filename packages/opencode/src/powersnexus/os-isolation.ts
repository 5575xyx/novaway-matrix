import { Effect, Schema } from "effect"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
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
  createProcessAsUser: boolean
  activeProcessLimit: number
  worktreeTempSandbox: boolean
  argvWriteGuard: boolean
}

export function sandboxCapabilities(): SandboxCapabilities {
  return {
    jobObject: isOsIsolationAvailable(),
    restrictedToken: isRestrictedTokenAvailable(),
    createProcessAsUser: isRestrictedTokenAvailable() && process.platform === "win32",
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

function killProcessTree(pid: number) {
  try {
    process.kill(pid, "SIGKILL")
  } catch {
    // 进程可能已经结束
  }
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL")
    } catch {
      // 进程组可能不存在
    }
    return
  }
  try {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
  } catch {
    // direct kill 已执行，taskkill 仅用于清理后代
  }
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
      for (const pid of pids) killProcessTree(pid)
      pids.clear()
    },
    run(argv, options) {
      return Effect.promise(() => runTrackedSmart(argv, options, (pid) => this.assign(pid)))
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
  const tracked = new Set<number>()

  const assign = (pid: number) => {
    if (disposed || !Number.isFinite(pid) || pid <= 0 || tracked.has(pid)) return
    tracked.add(pid)
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
      for (const pid of tracked) killProcessTree(pid)
      assigned.clear()
      tracked.clear()
    },
    run(argv, options) {
      return Effect.promise(() =>
        runTrackedSmart(
          argv,
          options,
          (pid) => {
            assign(pid)
          },
          () => {
            api.TerminateJobObject(job, 1)
            for (const pid of tracked) killProcessTree(pid)
            assigned.clear()
            tracked.clear()
          },
        ),
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
      for (const pid of tracked) killProcessTree(pid)
      api.CloseHandle(job)
      assigned.clear()
      tracked.clear()
    },
  }
}


function isCrashExitCode(code: number) {
  // NTSTATUS severity error bit (e.g. 0xC0000005 ACCESS_VIOLATION)
  return code < 0 || code >= 0xc0000000
}

function toWide(s: string) {
  const u = new Uint16Array(s.length + 1)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i)
  return u
}

function quoteWinArg(arg: string) {
  if (!/[ \t"]/g.test(arg)) return arg
  return `"${arg.replace(/"/g, '\\"')}"`
}

function buildCommandLine(argv: string[]) {
  return argv.map(quoteWinArg).join(" ")
}

function buildUnicodeEnvBlock(env: NodeJS.ProcessEnv): Uint16Array {
  const lines: string[] = []
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    lines.push(`${key}=${value}`)
  }
  // Windows requires SystemRoot etc; keep all provided keys
  lines.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  const joined = lines.join("\0") + "\0\0"
  return toWide(joined.slice(0, -1) + "\0") // toWide already null-terminates one; ensure double null
}

/** CreateProcessAsUser + Safer Token；stdout/stderr 落到 TEMP 文件。失败返回 null。 */
async function runWithRestrictedToken(
  argv: string[],
  options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
  onSpawn: (pid: number) => void,
  onTimeout?: () => void,
): Promise<IsolatedRunResult | null> {
  if (process.platform !== "win32") return null
  // 默认关闭：受限 Token 下复杂 node -e/文件写入脚本在 Windows 上不可靠；仅显式 opt-in
  if (process.env.POWERSNEXUS_RESTRICTED_SPAWN !== "1") return null
  const token = createRestrictedTokenHandle()
  if (!token) return null
  const k32 = getWin32Api()
  const create = getCreateProcessApi()
  if (!k32 || !create) {
    k32?.CloseHandle(token)
    return null
  }
  const tempRoot = options.env?.TEMP || options.env?.TMP || process.env.TEMP || process.cwd()
  try {
    mkdirSync(tempRoot, { recursive: true })
  } catch {
    // ignore
  }
  const id = randomUUID()
  const stdoutPath = path.join(tempRoot, `pn-out-${id}.log`)
  const stderrPath = path.join(tempRoot, `pn-err-${id}.log`)
  try {
    const { ptr } = (Bun as any).FFI
    // SECURITY_ATTRIBUTES { nLength=24, lpSecurityDescriptor=null, bInheritHandle=1 }
    const sa = new ArrayBuffer(24)
    const sav = new DataView(sa)
    sav.setUint32(0, 24, true)
    sav.setUint32(16, 1, true) // bInheritHandle = TRUE (offset 16 on x64 after 8-byte pointer)

    const GENERIC_WRITE = 0x40000000
    const FILE_SHARE_READ = 0x00000001
    const CREATE_ALWAYS = 2
    const FILE_ATTRIBUTE_NORMAL = 0x80
    const OPEN_EXISTING = 3
    const GENERIC_READ = 0x80000000

    const outName = toWide(stdoutPath)
    const errName = toWide(stderrPath)
    const hOut = create.CreateFileW(ptr(outName), GENERIC_WRITE, FILE_SHARE_READ, ptr(sa), CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, null)
    const hErr = create.CreateFileW(ptr(errName), GENERIC_WRITE, FILE_SHARE_READ, ptr(sa), CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, null)
    if (!hOut || !hErr || hOut === -1 || hErr === -1) {
      if (hOut && hOut !== -1) k32.CloseHandle(hOut)
      if (hErr && hErr !== -1) k32.CloseHandle(hErr)
      k32.CloseHandle(token)
      return null
    }

    // STARTUPINFOW
    const si = new ArrayBuffer(104)
    const siv = new DataView(si)
    siv.setUint32(0, 104, true) // cb
    const STARTF_USESTDHANDLES = 0x00000100
    const STARTF_USESHOWWINDOW = 0x00000001
    siv.setUint32(60, STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW, true) // dwFlags
    siv.setUint16(64, 0, true) // wShowWindow = SW_HIDE
    // hStdInput INVALID
    siv.setBigUint64(80, 0xffffffffffffffffn, true)
    siv.setBigUint64(88, BigInt(hOut >>> 0) >= 0 ? BigInt(hOut) : BigInt(hOut), true)
    siv.setBigUint64(96, BigInt(hErr >>> 0) >= 0 ? BigInt(hErr) : BigInt(hErr), true)
    // Use unsigned conversion carefully
    const setHandle = (offset: number, handle: number) => {
      const big = BigInt(handle < 0 ? handle + 2 ** 32 : handle)
      // for 64-bit handles from bun, Number may already be full
      siv.setBigUint64(offset, BigInt.asUintN(64, BigInt(handle)), true)
    }
    setHandle(88, hOut)
    setHandle(96, hErr)

    const pi = new ArrayBuffer(24)
    const app = toWide(argv[0])
    const cmd = toWide(buildCommandLine(argv))
    const cwd = toWide(options.cwd)
    const env = options.env ?? process.env
    // simplified env: null inherit parent may miss TEMP sandbox - build block
    const envBlock = buildEnvBlock(env)

    const CREATE_UNICODE_ENVIRONMENT = 0x00000400
    const CREATE_NO_WINDOW = 0x08000000
    const CREATE_SUSPENDED = 0x00000004
    const flags = CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW | CREATE_SUSPENDED

    const ok = create.CreateProcessAsUserW(
      token,
      ptr(app),
      ptr(cmd),
      null,
      null,
      true, // inherit handles for stdio files
      flags,
      ptr(envBlock),
      ptr(cwd),
      ptr(si),
      ptr(pi),
    )
    // close thread/process std handles in parent
    k32.CloseHandle(hOut)
    k32.CloseHandle(hErr)

    if (!ok) {
      k32.CloseHandle(token)
      cleanupFiles(stdoutPath, stderrPath)
      return null
    }

    const piv = new DataView(pi)
    const hProcess = Number(piv.getBigUint64(0, true))
    const hThread = Number(piv.getBigUint64(8, true))
    const pid = piv.getUint32(16, true)
    if (pid) onSpawn(pid)

    // resume after job assignment via onSpawn
    create.ResumeThread(hThread)

    // 短轮询等待，避免长时间阻塞事件循环导致 cancel/terminate 无法介入
    return await new Promise((resolve) => {
      const WAIT_OBJECT_0 = 0
      const WAIT_TIMEOUT = 258
      const deadline = Date.now() + Math.max(1, options.timeoutMs)
      let settled = false
      const finish = (timedOut: boolean) => {
        if (settled) return
        settled = true
        try {
          if (timedOut) {
            try {
              create.TerminateProcess(hProcess, 1)
              onTimeout?.()
              killProcessTree(pid)
            } catch {
              // ignore
            }
            create.WaitForSingleObject(hProcess, 5000)
          }
          const codeBuf = new Uint32Array(1)
          create.GetExitCodeProcess(hProcess, ptr(codeBuf))
          const exitCode = codeBuf[0] >>> 0
          k32.CloseHandle(hProcess)
          if (hThread) k32.CloseHandle(hThread)
          k32.CloseHandle(token)
          const stdout = existsSync(stdoutPath) ? readFileSync(stdoutPath) : Buffer.alloc(0)
          const stderr = existsSync(stderrPath) ? readFileSync(stderrPath) : Buffer.alloc(0)
          cleanupFiles(stdoutPath, stderrPath)
          // 进程已启动后不再回退到普通 spawn，避免副作用步骤被重放
          resolve({
            exitCode: isCrashExitCode(exitCode) ? exitCode || 1 : exitCode,
            stdout,
            stderr,
            timedOut,
            restricted: true,
          })
        } catch {
          try {
            k32.CloseHandle(hProcess)
            if (hThread) k32.CloseHandle(hThread)
            k32.CloseHandle(token)
          } catch {
            // ignore
          }
          cleanupFiles(stdoutPath, stderrPath)
          resolve(null)
        }
      }
      const poll = () => {
        if (settled) return
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
          finish(true)
          return
        }
        const slice = Math.max(1, Math.min(50, remaining))
        const wait = create.WaitForSingleObject(hProcess, slice)
        if (wait === WAIT_OBJECT_0) {
          finish(false)
          return
        }
        if (wait === WAIT_TIMEOUT) {
          setImmediate(poll)
          return
        }
        // 其它等待结果按失败结束
        finish(false)
      }
      setImmediate(poll)
    })
  } catch {
    k32.CloseHandle(token)
    cleanupFiles(stdoutPath, stderrPath)
    return null
  }
}

function cleanupFiles(...files: string[]) {
  for (const file of files) {
    try {
      if (existsSync(file)) unlinkSync(file)
    } catch {
      // ignore
    }
  }
}

function buildEnvBlock(env: NodeJS.ProcessEnv): Uint16Array {
  const lines: string[] = []
  for (const key of Object.keys(env)) {
    const value = env[key]
    if (value === undefined) continue
    lines.push(`${key}=${value}`)
  }
  lines.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  // double null terminated UTF-16LE
  const parts: number[] = []
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) parts.push(line.charCodeAt(i))
    parts.push(0)
  }
  parts.push(0)
  return new Uint16Array(parts)
}

type CreateProcessApi = {
  CreateProcessAsUserW: (...args: any[]) => number
  CreateFileW: (...args: any[]) => number
  ResumeThread: (thread: number) => number
  WaitForSingleObject: (handle: number, ms: number) => number
  GetExitCodeProcess: (handle: number, codeOut: any) => number
  TerminateProcess: (handle: number, exitCode: number) => number
}

let createProcessApi: CreateProcessApi | null | undefined

function getCreateProcessApi(): CreateProcessApi | null {
  if (createProcessApi !== undefined) return createProcessApi
  if (process.platform !== "win32") {
    createProcessApi = null
    return null
  }
  try {
    const { dlopen } = (Bun as any).FFI
    const kernel = dlopen("kernel32.dll", {
      CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "ptr" },
      ResumeThread: { args: ["ptr"], returns: "u32" },
      WaitForSingleObject: { args: ["ptr", "u32"], returns: "u32" },
      GetExitCodeProcess: { args: ["ptr", "ptr"], returns: "bool" },
      TerminateProcess: { args: ["ptr", "u32"], returns: "bool" },
    })
    const adv = dlopen("advapi32.dll", {
      CreateProcessAsUserW: {
        args: ["ptr", "ptr", "ptr", "ptr", "ptr", "bool", "u32", "ptr", "ptr", "ptr", "ptr"],
        returns: "i32",
      },
    })
    createProcessApi = {
      CreateProcessAsUserW: (...args: any[]) => (adv.symbols.CreateProcessAsUserW(...args) ? 1 : 0),
      CreateFileW: (...args: any[]) => Number(kernel.symbols.CreateFileW(...args)),
      ResumeThread: (thread) => Number(kernel.symbols.ResumeThread(thread)),
      WaitForSingleObject: (handle, ms) => Number(kernel.symbols.WaitForSingleObject(handle, ms)),
      GetExitCodeProcess: (handle, codeOut) => (kernel.symbols.GetExitCodeProcess(handle, codeOut) ? 1 : 0),
      TerminateProcess: (handle, exitCode) => (kernel.symbols.TerminateProcess(handle, exitCode) ? 1 : 0),
    }
    return createProcessApi
  } catch {
    createProcessApi = null
    return null
  }
}

async function runTrackedSmart(
  argv: string[],
  options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
  onSpawn: (pid: number) => void,
  onTimeout?: () => void,
): Promise<IsolatedRunResult> {
  if (isRestrictedTokenAvailable() && process.env.POWERSNEXUS_RESTRICTED_SPAWN === "1") {
    try {
      const restricted = await runWithRestrictedToken(argv, options, onSpawn, onTimeout)
      if (restricted) return restricted
    } catch {
      // fall through to unrestricted spawn only when restricted start failed
    }
  }
  return runTracked(argv, options, onSpawn, onTimeout)
}

function runTracked(
  argv: string[],
  options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
  onSpawn: (pid: number) => void,
  onTimeout?: () => void,
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
        child.kill("SIGKILL")
        onTimeout?.()
        if (child.pid) killProcessTree(child.pid)
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
