/**
 * 带 Python 脚本的技能扩展的运行环境。
 *
 * 市场里装下来的扩展有可能自带 `requirements.txt`（例如 ppt-master：SVG → PPTX
 * 的转换脚本依赖 python-pptx / skia-pathops / uharfbuzz）。技能自带的说明通常写
 * 「pip install -r requirements.txt」，照着做会污染系统 Python，而且模型还经常
 * 调错解释器（Windows 上 `python3` 往往是应用商店占位符）。
 *
 * 这里统一处理两件事：
 * - 每个技能一个独立 venv，放在 NovaWay 数据目录的 `skill-python/<技能名>/venv`；
 * - 装好后把**解释器的绝对路径**写进技能提示，让模型一直用同一个解释器。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"
import { ensureVenv, venvPythonAt, type VenvPhase, type VenvProgress, type Runner } from "@/python/venv"

export const STATUS_FILE = "environment.json"

export type SkillPythonState = "idle" | "running" | "ready" | "error"
export type State = SkillPythonState

export type SkillPythonStatus = {
  state: SkillPythonState
  name: string
  /** 可执行解释器；ready 时一定存在。 */
  python?: string
  /** 依赖来源（requirements.txt 的绝对路径）。 */
  requirements?: string
  installedAt?: number
  error?: string
  hint?: string
  log?: string
}

/** 状态对象的别名，供 `import * as` 的地方写类型。 */
export type Status = SkillPythonStatus

/** 目录名只保留安全字符：技能名来自第三方 manifest，不能直接拼路径。 */
function safeSegment(value: string) {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_")
  return cleaned.slice(0, 120) || "skill"
}

export function skillEnvRoot(name: string) {
  // `NOVAWAY_SKILL_PYTHON_HOME` 是测试和「把环境放到别的盘」的出口。
  const base = process.env.NOVAWAY_SKILL_PYTHON_HOME?.trim() || path.join(Global.Path.data, "skill-python")
  return path.join(base, safeSegment(name))
}

/** venv 里的解释器路径（不一定存在，配合 status() 使用）。 */
export function skillPythonPath(name: string) {
  return venvPythonAt(skillEnvRoot(name))
}

async function isFile(target: string) {
  try {
    const stat = await fs.stat(target)
    return stat.isFile()
  } catch {
    return false
  }
}

async function isDir(target: string) {
  try {
    const stat = await fs.stat(target)
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function children(root: string) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name))
}

export type RequirementSource = { file: string; name: string }

/**
 * 技能名以 SKILL.md 的 frontmatter 为准（它才是 `skill` 工具里的名字），
 * 目录名只作兜底。两者不一致时，按目录名记录的环境会被当成「没装过」。
 */
async function skillNameAt(dir: string, fallback: string) {
  const text = await fs.readFile(path.join(dir, "SKILL.md"), "utf8").catch(() => "")
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const name = frontmatter?.[1].match(/^name:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1]?.trim()
  return name || fallback
}

/**
 * 找扩展里的 requirements.txt。
 *
 * 优先认「技能目录」：`<root>/skills/<name>/requirements.txt` —— 这个目录名就是
 * 技能名，和 `skill` 工具拿到的名字对得上。其次才是扩展根下的 requirements.txt。
 */
export async function findRequirements(root: string): Promise<RequirementSource | undefined> {
  const nested = await children(path.join(root, "skills"))
  for (const dir of nested) {
    const file = path.join(dir, "requirements.txt")
    if (await isFile(file)) return { file, name: await skillNameAt(dir, path.basename(dir)) }
  }
  const direct = path.join(root, "requirements.txt")
  if (await isFile(direct)) return { file: direct, name: await skillNameAt(root, path.basename(root)) }
  for (const dir of await children(root)) {
    if (["node_modules", ".git", "templates", "assets"].includes(path.basename(dir))) continue
    const file = path.join(dir, "requirements.txt")
    if (await isFile(file)) return { file, name: await skillNameAt(dir, path.basename(dir)) }
  }
  return undefined
}

const statusPath = (name: string) => path.join(skillEnvRoot(name), STATUS_FILE)

const STATES: readonly SkillPythonState[] = ["idle", "running", "ready", "error"]

async function readStatusFile(name: string): Promise<SkillPythonStatus | undefined> {
  try {
    const raw = await fs.readFile(statusPath(name), "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return undefined
    const record = parsed as Record<string, unknown>
    const state = record.state
    // 记录文件是普通 JSON，可能被手改或写坏：状态不认识就当作没有记录。
    if (typeof state !== "string" || !STATES.includes(state as SkillPythonState)) return undefined
    const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : undefined)
    return {
      state: state as SkillPythonState,
      name,
      ...(text("python") ? { python: text("python") } : {}),
      ...(text("requirements") ? { requirements: text("requirements") } : {}),
      ...(typeof record.installedAt === "number" ? { installedAt: record.installedAt } : {}),
      ...(text("error") ? { error: text("error") } : {}),
      ...(text("hint") ? { hint: text("hint") } : {}),
      ...(text("log") ? { log: text("log") } : {}),
    }
  } catch {
    return undefined
  }
}

async function writeStatusFile(status: SkillPythonStatus) {
  const root = skillEnvRoot(status.name)
  await fs.mkdir(root, { recursive: true }).catch(() => undefined)
  await fs.writeFile(statusPath(status.name), JSON.stringify(status, null, 2), "utf8").catch(() => undefined)
}

/**
 * 当前状态。
 *
 * 记录说 ready 但解释器已经被删掉（用户清理了数据目录、或换了机器）时，
 * 如实返回 idle，而不是让模型拿到一个不存在的路径。
 */
export async function status(name: string): Promise<SkillPythonStatus> {
  const record = await readStatusFile(name)
  if (!record) return { state: "idle", name }
  const python = skillPythonPath(name)
  if (record.state === "ready" && !(await isFile(python))) {
    return { state: "idle", name, requirements: record.requirements }
  }
  if (record.state === "running") {
    // 进程被杀 / 应用崩溃留下的 running 记录不会自己变成 ready。
    return { state: "error", name, requirements: record.requirements, error: "上一次安装没有完成", log: record.log }
  }
  return {
    state: record.state,
    name,
    python: record.state === "ready" ? python : undefined,
    requirements: record.requirements,
    installedAt: record.installedAt,
    error: record.error,
    hint: record.hint,
    log: record.log,
  }
}

/** 常见包名 → import 名；只用于装完后的冒烟验证，认不出来就跳过。 */
const MODULE_NAMES: Record<string, string> = {
  "python-pptx": "pptx",
  pyyaml: "yaml",
  "skia-pathops": "pathops",
  uharfbuzz: "uharfbuzz",
  xlsxwriter: "xlsxwriter",
  pillow: "PIL",
  numpy: "numpy",
  pymupdf: "fitz",
}

/** 从 requirements.txt 里挑几个必须能 import 的模块（最多 5 个）。 */
export function verifyModules(requirements: string) {
  const seen = new Set<string>()
  for (const line of requirements.split(/\r?\n/)) {
    const name = line
      .split(/[<>=!~\[; ]/)[0]
      ?.trim()
      .toLowerCase()
    if (!name || name.startsWith("#") || name.startsWith("-")) continue
    const module = MODULE_NAMES[name]
    if (module) seen.add(module)
  }
  return [...seen].slice(0, 5)
}

export type PrepareInput = {
  /** 技能名（也是目录名）。 */
  name: string
  /** requirements.txt 路径。 */
  requirements: string
  signal?: AbortSignal
  onProgress?: (progress: VenvProgress) => void
  /** 测试注入 */
  runner?: Runner
  allowDownload?: boolean
  uv?: string
  reinstall?: boolean
}

const running = new Map<string, Promise<SkillPythonStatus>>()

/** 候选解释器：显式指定 → 该技能的 venv → 系统 python。 */
export function candidatesFor(name: string, extras: Array<{ command: string; args: string[]; label: string }> = []) {
  const list = [...extras]
  const explicit = process.env.NOVAWAY_SKILL_PYTHON?.trim()
  if (explicit) list.push({ command: explicit, args: [], label: explicit })
  list.push({ command: skillPythonPath(name), args: [], label: "novaway skill venv" })
  list.push({ command: "python", args: [], label: "python" })
  list.push({ command: "python3", args: [], label: "python3" })
  if (process.platform === "win32") list.push({ command: "py", args: ["-3"], label: "py -3" })
  return list
}

function indexes() {
  const override = process.env.NOVAWAY_SKILL_PIP_INDEX?.trim() || process.env.NOVAWAY_PIP_INDEX?.trim()
  if (override) return [override]
  return ["", "https://pypi.tuna.tsinghua.edu.cn/simple"]
}

/**
 * 准备（或重装）这个技能的 Python 环境。
 *
 * 同一个技能同时只跑一个安装，重复调用直接复用进行中的那个 —— 安装按钮点两下
 * 不应该同时开两个 pip。
 */
export function prepare(input: PrepareInput): Promise<SkillPythonStatus> {
  const existing = running.get(input.name)
  if (existing) return existing
  const task = run(input).finally(() => running.delete(input.name))
  running.set(input.name, task)
  return task
}

async function run(input: PrepareInput): Promise<SkillPythonStatus> {
  const root = skillEnvRoot(input.name)
  const requirements = input.requirements
  const text = await fs.readFile(requirements, "utf8").catch(() => "")
  const modules = verifyModules(text)

  const started: SkillPythonStatus = {
    state: "running",
    name: input.name,
    requirements,
    ...(modules.length > 0 ? { log: "verify: " + modules.join(", ") } : {}),
  }
  await writeStatusFile(started)

  const result = await ensureVenv({
    root,
    candidates: candidatesFor(input.name),
    requirements,
    modules,
    label: input.name,
    indexes: indexes(),
    hints: {
      noPython: "联网后重试会自动准备运行环境；也可以手动安装 Python 3.9+（勾选 Add to PATH）。",
      venv: "创建虚拟环境失败。确认 Python 自带 venv 模块（Debian/Ubuntu 需 apt install python3-venv）。",
      pip: "安装依赖失败。可检查网络/代理，或设置 NOVAWAY_SKILL_PIP_INDEX 指向可用镜像。",
      verify: "依赖装完了但导入失败，可能是 Python 版本不匹配（需要 3.9+），可查看日志后重试。",
    },
    signal: input.signal,
    onProgress: input.onProgress,
    runner: input.runner,
    allowDownload: input.allowDownload,
    uv: input.uv,
    reinstall: input.reinstall,
  })

  const final: SkillPythonStatus = result.ok
    ? {
        state: "ready",
        name: input.name,
        python: result.python,
        requirements,
        installedAt: Date.now(),
      }
    : {
        state: "error",
        name: input.name,
        requirements,
        ...(result.error ? { error: result.error } : {}),
        ...(result.hint ? { hint: result.hint } : {}),
        ...(result.log ? { log: result.log } : {}),
      }
  await writeStatusFile(final)
  return final
}

/**
 * 扩展被卸载时清掉它留下的环境。
 *
 * venv 动辄几百 MB，卸载后留着就是永远没人认领的垃圾。只删「requirements 路径
 * 位于被删目录下」的那些，其它技能的环境不受影响。
 */
export async function forgetUnder(removedRoot: string) {
  const base = process.env.NOVAWAY_SKILL_PYTHON_HOME?.trim() || path.join(Global.Path.data, "skill-python")
  const root = path.resolve(removedRoot)
  const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(base, entry.name)
    const record = await readStatusFile(entry.name)
    if (!record?.requirements) continue
    const requirements = path.resolve(record.requirements)
    if (requirements !== root && !requirements.startsWith(root + path.sep)) continue
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined)
  }
}

/**
 * 写进技能提示的那段话。
 *
 * 第三方技能说明里通常写的是 `python3 scripts/xxx.py`，在 Windows 上会踩到
 * 应用商店占位符；这里把正确解释器显式交给模型，避免它自由发挥。
 */
export function pythonEnvNote(status: SkillPythonStatus): string | undefined {
  if (status.state === "ready" && status.python) {
    return [
      "本机已为这个技能准备好独立 Python 环境（依赖已安装），运行任何 .py 脚本都用这个解释器：",
      "  " + status.python,
      '例如："' + status.python + '" "<技能目录>/scripts/xxx.py" --help',
      "不要使用 python3 / python / py：系统解释器没有这些依赖，Windows 上的 python3 常常是应用商店占位符。",
      "需要补装依赖时用这个解释器的 -m pip，不要动系统环境。",
    ].join(String.fromCharCode(10))
  }
  if (status.state === "error") {
    return [
      "这个技能的 Python 环境还没有准备好：" + (status.error ?? "未知原因"),
      '运行脚本前先调用 skill_python 工具（action=prepare, name="' + status.name + '"）准备依赖；',
      "不要直接改系统 Python，也不要把安装失败说成已完成。",
    ].join(String.fromCharCode(10))
  }
  if (status.state === "running") {
    return "这个技能的 Python 环境正在安装依赖，稍后重试；不要同时再跑一遍 pip。"
  }
  return undefined
}

/** 有 requirements.txt 但没装过环境时给模型的一句提醒。 */
export function missingEnvNote(name: string, requirements?: string): string {
  return [
    "这个技能需要 Python 依赖（" + (requirements ?? "requirements.txt") + "），本机还没有准备好。",
    '需要运行它的 .py 脚本时，先调用 skill_python 工具（action=prepare, name="' + name + '"）。',
  ].join(String.fromCharCode(10))
}
