/**
 * 启动时自动准备内置扩展。
 *
 * 目标：用户装好 NovaWay 之后，**只要网络正常**，不需要装 git / Node / Python，
 * 内置扩展（ppt-master 这类技能型扩展）就该能用。为此这里做三件事：
 *
 * 1. 没装的按清单装（`@novaway/core/builtin-extensions`）；
 * 2. 装完立即通知缓存失效（`./generation`），不然要等重启才看得到；
 * 3. 扩展自带 `requirements.txt` 的，顺手把它的独立 Python 环境准备好
 *    （没有 Python 时 uv 会下载托管运行时，见 `@/python/venv`）。
 *
 * 全是尽力而为：任何一步失败只记日志，下次启动重试。用户手动卸载过的条目
 * 记为 `dismissed`，不会被偷偷装回来。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"
import * as Log from "@novaway/core/util/log"
import { autoInstallExtensions, type BuiltinExtension } from "@novaway/core/builtin-extensions"
import * as Marketplace from "./marketplace"
import * as Generation from "./generation"
import * as SkillPython from "@/skill/python-env"
import { isRecord } from "@/util/record"

const log = Log.create({ service: "extension.provision" })

const STATE_FILE = "extension-provision.json"

export type EntryStatus = "installed" | "failed" | "skipped"

export type EntryState = {
  status: EntryStatus
  at: number
  attempts: number
  version?: string
  error?: string
  /** 用户手动卸载过：不再自动装回。 */
  dismissed?: boolean
}

export type State = Record<string, EntryState>

export type EntryReport = {
  name: string
  status: EntryStatus
  installedNow: boolean
  python?: "ready" | "prepared" | "failed" | "none"
  error?: string
}

export type Report = {
  entries: EntryReport[]
}

const statePath = () => path.join(Global.Path.data, STATE_FILE)

function entryStatus(value: unknown): EntryStatus | undefined {
  if (value === "installed" || value === "failed" || value === "skipped") return value
  return undefined
}

/** 状态文件是普通 JSON，可能被手改或写坏：逐字段校验，不认的记录直接丢掉。 */
function parseState(parsed: unknown): State {
  if (!isRecord(parsed)) return {}
  const result: State = {}
  for (const [name, value] of Object.entries(parsed)) {
    if (!name || !isRecord(value)) continue
    const status = entryStatus(value.status)
    if (!status) continue
    result[name] = {
      status,
      at: typeof value.at === "number" ? value.at : 0,
      attempts: typeof value.attempts === "number" ? value.attempts : 0,
      ...(typeof value.version === "string" ? { version: value.version } : {}),
      ...(typeof value.error === "string" ? { error: value.error } : {}),
      ...(value.dismissed === true ? { dismissed: true } : {}),
    }
  }
  return result
}

export async function readState(): Promise<State> {
  try {
    return parseState(JSON.parse(await fs.readFile(statePath(), "utf8")))
  } catch {
    return {}
  }
}

async function writeState(state: State) {
  await fs.mkdir(Global.Path.data, { recursive: true }).catch(() => undefined)
  await fs.writeFile(statePath(), JSON.stringify(state, null, 2), "utf8").catch((error) => {
    log.warn("failed to persist provisioning state", { error: String(error) })
  })
}

/** 用户手动卸载：记下来，下次启动不再自动装。 */
export async function dismiss(name: string) {
  const state = await readState()
  state[name] = { ...(state[name] ?? { attempts: 0 }), status: "skipped", at: Date.now(), dismissed: true }
  await writeState(state)
}

/** 用户手动装回来：清除 dismiss，恢复后续自动准备。 */
export async function undismiss(name: string) {
  const state = await readState()
  const entry = state[name]
  if (!entry?.dismissed) return
  const { dismissed: _dismissed, ...rest } = entry
  state[name] = rest
  await writeState(state)
}

export function disabled() {
  const flag = process.env.NOVAWAY_DISABLE_AUTOPROVISION?.trim().toLowerCase()
  return flag === "1" || flag === "true" || flag === "yes"
}

async function install(entry: BuiltinExtension) {
  if (entry.kind === "zip") {
    return Marketplace.installZip({
      name: entry.name,
      url: entry.url,
      ...(entry.version ? { version: entry.version } : {}),
    })
  }
  return Marketplace.installGit({
    name: entry.name,
    url: entry.url,
    ...(entry.ref ? { ref: entry.ref } : {}),
    ...(entry.subdir ? { subdir: entry.subdir } : {}),
    ...(entry.version ? { version: entry.version } : {}),
  })
}

/**
 * 扩展自带 requirements.txt 时，把它的独立 Python 环境准备好。
 *
 * 每次都检查（不只是刚装完）：老版本装的扩展、或上次装到一半被中断的，
 * 也应该在下次启动补齐。
 */
async function preparePython(root: string): Promise<EntryReport["python"]> {
  const found = await SkillPython.findRequirements(root)
  if (!found) return "none"
  const current = await SkillPython.status(found.name)
  if (current.state === "ready") return "ready"
  // 已经有安装在进行：等它跑完就行，别开第二个 pip。
  if (current.state === "running") return "prepared"
  const result = await SkillPython.prepare({ name: found.name, requirements: found.file })
  return result.state === "ready" ? "prepared" : "failed"
}

/**
 * 依赖注入点：测试里换成假实现，生产走真实安装 / Python 准备。
 */
export type ProvisionDeps = {
  entries: readonly BuiltinExtension[]
  list: () => Promise<Marketplace.Installed[]>
  install: (entry: BuiltinExtension) => Promise<{ root: string }>
  preparePython: (root: string) => Promise<EntryReport["python"]>
  bump: () => void
}

const realDeps: ProvisionDeps = {
  entries: autoInstallExtensions(),
  list: () => Marketplace.list(),
  install,
  preparePython,
  bump: Generation.bump,
}

/** 装（或补齐）一个条目。单个条目失败不影响其它条目。 */
async function provisionOne(
  entry: BuiltinExtension,
  installed: Marketplace.Installed[],
  deps: ProvisionDeps,
): Promise<{ report: EntryReport; state: EntryState }> {
  const record = installed.find((item) => item.name === entry.name)
  let root = record?.root
  let installedNow = false

  if (!root) {
    log.info("installing builtin extension", { name: entry.name, url: entry.url })
    const result = await deps.install(entry)
    root = result.root
    installedNow = true
  }

  let python: EntryReport["python"] = "none"
  try {
    python = await deps.preparePython(root)
  } catch (error) {
    log.warn("preparing python environment failed", { name: entry.name, error: String(error) })
    python = "failed"
  }
  if (installedNow) deps.bump()

  return {
    report: { name: entry.name, status: "installed", installedNow, python },
    state: {
      status: "installed",
      at: Date.now(),
      attempts: 0,
      ...(entry.version ? { version: entry.version } : {}),
    },
  }
}

let inFlight: Promise<Report> | undefined
let started = false

/**
 * 执行一轮自动准备。
 *
 * 幂等：已装的条目只做 Python 补齐；`dismissed` 的条目跳过。
 * 绝不抛异常 —— 它通常在服务启动后后台跑。
 */
export async function provisionBuiltins(options: { names?: string[]; deps?: ProvisionDeps } = {}): Promise<Report> {
  const deps = options.deps ?? realDeps
  const state = await readState()
  const entries = deps.entries.filter((entry) => !options.names || options.names.includes(entry.name))
  const installed = await deps.list().catch((error) => {
    log.warn("listing installed extensions failed", { error: String(error) })
    return [] as Marketplace.Installed[]
  })

  const reports: EntryReport[] = []
  for (const entry of entries) {
    const previous = state[entry.name]
    if (previous?.dismissed) {
      reports.push({ name: entry.name, status: "skipped", installedNow: false })
      continue
    }
    try {
      const { report, state: next } = await provisionOne(entry, installed, deps)
      state[entry.name] = next
      reports.push(report)
      log.info("builtin extension ready", { name: entry.name, python: report.python })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state[entry.name] = {
        status: "failed",
        at: Date.now(),
        attempts: (previous?.attempts ?? 0) + 1,
        error: message.slice(0, 500),
      }
      reports.push({ name: entry.name, status: "failed", installedNow: false, error: message })
      log.warn("builtin extension provisioning failed", { name: entry.name, error: message })
    }
  }
  await writeState(state)
  return { entries: reports }
}

/**
 * 服务启动后调用：后台跑一轮，不阻塞监听。
 *
 * 同一进程只跑一次；被 `NOVAWAY_DISABLE_AUTOPROVISION=1` 关掉（测试与
 * 「离线机器」部署用）。
 */
export function startProvisioning() {
  if (disabled()) {
    log.info("automatic extension provisioning disabled")
    return Promise.resolve<Report>({ entries: [] })
  }
  if (inFlight) return inFlight
  if (started) return Promise.resolve<Report>({ entries: [] })
  started = true
  inFlight = provisionBuiltins()
    .catch((error) => {
      log.warn("automatic extension provisioning failed", { error: String(error) })
      return { entries: [] } satisfies Report
    })
    .finally(() => {
      inFlight = undefined
    })
  return inFlight
}
