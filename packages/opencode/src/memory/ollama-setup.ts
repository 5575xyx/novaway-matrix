/**
 * Local Ollama setup for memory embeddings.
 *
 * Product rules:
 * - Never install silently on app start.
 * - Always run as an explicit user action (button / API call).
 * - Prefer detect -> start -> pull model; install only when missing.
 * - If install cannot be completed unattended, return a clear next action.
 */
import { spawn } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"
import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import path from "node:path"

export const DEFAULT_EMBED_MODEL = "nomic-embed-text"
export const DEFAULT_OLLAMA_URL = "http://localhost:11434"

export type OllamaPhase =
  | "idle"
  | "checking"
  | "installing"
  | "starting"
  | "pulling"
  | "ready"
  | "needs_manual"
  | "error"

export type OllamaStatus = {
  platform: string
  baseURL: string
  preferredModel: string
  cliInstalled: boolean
  cliPath?: string
  installDir?: string
  cliVersion?: string
  modelsDir: string
  daemonRunning: boolean
  models: string[]
  hasEmbedModel: boolean
  selectedModel?: string
  ready: boolean
  phase: OllamaPhase
  message: string
  hint?: string
  installCommand?: string
  downloadURL: string
}

export type SetupStep = {
  step: string
  status: "running" | "ok" | "skip" | "error" | "manual"
  detail?: string
}

export type SetupResult = {
  ok: boolean
  status: OllamaStatus
  steps: SetupStep[]
  config?: {
    embedding_mode: "ollama"
    embedding_ollama_url: string
    embedding_ollama_model: string
    embedding_ollama_install_dir?: string
    embedding_ollama_models_dir?: string
  }
}

const PREFERRED_MODELS = [DEFAULT_EMBED_MODEL, "mxbai-embed-large", "bge-m3", "all-minilm", "snowflake-arctic-embed"]

type CommandResult = {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

type CommandRunner = (
  cmd: string,
  args: string[],
  timeoutMs?: number,
  env?: NodeJS.ProcessEnv,
) => Promise<CommandResult>

async function runCapture(
  cmd: string,
  args: string[],
  timeoutMs = 15_000,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const done = (result: CommandResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    try {
      const child = spawn(cmd, args, {
        windowsHide: true,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      })
      child.stdout?.setEncoding("utf8")
      child.stderr?.setEncoding("utf8")
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk
      })
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk
      })
      child.once("error", (error) => {
        done({ ok: false, code: -1, stdout: stdout.trim(), stderr: error.message })
      })
      child.once("close", (code) => {
        done({
          ok: code === 0,
          code: code ?? -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        })
      })
      timer = setTimeout(() => {
        child.kill()
        done({
          ok: false,
          code: -1,
          stdout: stdout.trim(),
          stderr: `命令执行超时（${timeoutMs}ms）`,
        })
      }, timeoutMs)
    } catch (error) {
      done({
        ok: false,
        code: -1,
        stdout: stdout.trim(),
        stderr: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

export function ollamaCliCandidates(osName: string = platform(), env: NodeJS.ProcessEnv = process.env) {
  if (osName !== "win32") return []
  return [
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe") : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Ollama", "ollama.exe") : undefined,
    env.ProgramFiles ? path.join(env.ProgramFiles, "Ollama", "ollama.exe") : undefined,
    env["ProgramFiles(x86)"] ? path.join(env["ProgramFiles(x86)"], "Ollama", "ollama.exe") : undefined,
  ].filter((item): item is string => Boolean(item))
}

function ollamaCliCandidatesWithInstallDir(
  installDir: string | undefined,
  osName: string = platform(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const custom = installDir ? [path.join(installDir, "ollama.exe"), path.join(installDir, "ollama", "ollama.exe")] : []
  return [...custom, ...ollamaCliCandidates(osName, env)]
}

export async function findOllamaCli(input?: {
  osName?: string
  env?: NodeJS.ProcessEnv
  run?: CommandRunner
  exists?: (file: string) => boolean
  installDir?: string
}) {
  const osName = input?.osName ?? platform()
  const env = input?.env ?? process.env
  const run = input?.run ?? runCapture
  const exists = input?.exists ?? existsSync
  const finder = osName === "win32" ? "where" : "which"
  const result = await run(finder, ["ollama"], 5_000)
  const fromPath = result.ok
    ? result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && exists(line))
    : undefined
  if (fromPath) return fromPath
  return ollamaCliCandidatesWithInstallDir(input?.installDir, osName, env).find(exists)
}

async function waitForOllamaCli(timeoutMs = 30_000, installDir?: string) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const cliPath = await findOllamaCli({ installDir })
    if (cliPath) return cliPath
    await sleep(500)
  }
}

async function ollamaVersion(cliPath = "ollama") {
  const result = await runCapture(cliPath, ["--version"], 5_000)
  if (!result.ok) return
  return result.stdout || result.stderr || undefined
}

export async function listOllamaModels(baseURL = DEFAULT_OLLAMA_URL) {
  const root = baseURL.replace(/\/$/, "").replace(/\/v1$/, "")
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 800)
  try {
    const res = await fetch(`${root}/api/tags`, { signal: ctrl.signal })
    if (!res.ok) return { running: false as const, models: [] as string[], root }
    const data = (await res.json()) as { models?: Array<{ name?: string }> }
    const models = (data.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n))
    return { running: true as const, models, root }
  } catch {
    return { running: false as const, models: [] as string[], root }
  } finally {
    clearTimeout(timer)
  }
}

function pickEmbedModel(models: string[], preferred?: string) {
  if (preferred) {
    const hit = models.find((n) => n === preferred || n.startsWith(`${preferred}:`))
    if (hit) return hit
  }
  for (const name of PREFERRED_MODELS) {
    const hit = models.find((n) => n === name || n.startsWith(`${name}:`))
    if (hit) return hit
  }
  return models.find((n) => /embed/i.test(n))
}

export async function inspectOllama(input?: {
  baseURL?: string
  preferredModel?: string
  installDir?: string
  modelsDir?: string
}): Promise<OllamaStatus> {
  const baseURL = input?.baseURL || DEFAULT_OLLAMA_URL
  const preferredModel = input?.preferredModel || DEFAULT_EMBED_MODEL
  const cliPath = await findOllamaCli({ installDir: input?.installDir })
  const cliInstalled = Boolean(cliPath)
  const installDir = cliPath ? path.dirname(cliPath) : input?.installDir
  const modelsDir = input?.modelsDir || process.env.OLLAMA_MODELS || path.join(homedir(), ".ollama", "models")
  const cliVersion = cliInstalled ? await ollamaVersion(cliPath) : undefined
  const live = await listOllamaModels(baseURL)
  const selectedModel = pickEmbedModel(live.models, preferredModel)
  const hasEmbedModel = Boolean(selectedModel)
  const ready = live.running && hasEmbedModel

  let phase: OllamaPhase = "idle"
  let message = "本地向量尚未启用"
  let hint: string | undefined
  let installCommand: string | undefined

  if (ready) {
    phase = "ready"
    message = `本地向量已就绪（${selectedModel}）`
  } else if (live.running && !hasEmbedModel) {
    phase = "pulling"
    message = "Ollama 已运行，但未找到嵌入模型"
    hint = `一键启用将执行：ollama pull ${preferredModel}`
  } else if (cliInstalled && !live.running) {
    phase = "starting"
    message = "Ollama 已安装，但服务未运行"
    hint = "一键启用将尝试启动 Ollama，并拉取嵌入模型"
  } else if (!cliInstalled) {
    phase = "installing"
    message = "本机未检测到 Ollama CLI"
    const osName = platform()
    installCommand =
      osName === "win32"
        ? "winget install -e --id Ollama.Ollama"
        : osName === "darwin"
          ? "brew install ollama"
          : "curl -fsSL https://ollama.com/install.sh | sh"
    hint = `可点击一键启用尝试安装，或手动执行：${installCommand}`
  }

  return {
    platform: platform(),
    baseURL,
    preferredModel,
    cliInstalled,
    cliPath,
    installDir,
    cliVersion,
    modelsDir,
    daemonRunning: live.running,
    models: live.models,
    hasEmbedModel,
    selectedModel,
    ready,
    phase: ready ? "ready" : phase,
    message,
    hint,
    installCommand,
    downloadURL: "https://ollama.com/download",
  }
}

async function tryStartOllama(cliPath = "ollama", modelsDir?: string) {
  try {
    const child = spawn(cliPath, ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, ...(modelsDir ? { OLLAMA_MODELS: modelsDir } : {}) },
    })
    child.unref()
  } catch {
    // ignore
  }

  for (let i = 0; i < 10; i++) {
    await sleep(500)
    const live = await listOllamaModels()
    if (live.running) return true
  }
  return false
}

function commandFailure(result: CommandResult) {
  return (result.stderr || result.stdout || `退出码 ${result.code}`).replace(/\s+/g, " ").trim().slice(0, 500)
}

function windowsPowerShell(env: NodeJS.ProcessEnv) {
  if (env.SystemRoot) {
    const executable = path.join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    if (existsSync(executable)) return executable
  }
  return "powershell.exe"
}

export async function tryInstallOllama(input?: {
  osName?: string
  env?: NodeJS.ProcessEnv
  run?: CommandRunner
  installDir?: string
}): Promise<SetupStep> {
  const osName = input?.osName ?? platform()
  const env = input?.env ?? process.env
  const run = input?.run ?? runCapture
  if (osName === "win32") {
    if (input?.installDir) {
      const escaped = input.installDir.replace(/'/g, "''")
      const powershell = await run(
        windowsPowerShell(env),
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          [
            "$ProgressPreference='SilentlyContinue'",
            "$installer=Join-Path $env:TEMP 'OllamaSetup.exe'",
            "Invoke-WebRequest 'https://ollama.com/download/OllamaSetup.exe' -OutFile $installer",
            `Start-Process -FilePath $installer -ArgumentList '/VERYSILENT','/NORESTART','/DIR=\"${escaped}\"' -Wait`,
          ].join("; "),
        ],
        10 * 60_000,
      )
      if (powershell.ok) {
        return { step: "install", status: "ok", detail: `已将 Ollama 安装到 ${input.installDir}` }
      }
      return {
        step: "install",
        status: "manual",
        detail: `自定义目录安装失败：${commandFailure(powershell)}。可手动运行 OllamaSetup.exe /DIR="${input.installDir}"`,
      }
    }
    const winget = await run(
      "winget",
      ["install", "-e", "--id", "Ollama.Ollama", "--accept-package-agreements", "--accept-source-agreements"],
      10 * 60_000,
    )
    const wingetText = `${winget.stdout}\n${winget.stderr}`
    if (winget.ok || /successfully installed|No available upgrade|already installed/i.test(wingetText)) {
      return { step: "install", status: "ok", detail: "已通过 winget 安装或确认 Ollama 可用" }
    }

    const powershell = await run(
      windowsPowerShell(env),
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$ProgressPreference='SilentlyContinue'; Invoke-RestMethod 'https://ollama.com/install.ps1' | Invoke-Expression",
      ],
      10 * 60_000,
    )
    if (powershell.ok) {
      return { step: "install", status: "ok", detail: "winget 不可用，已通过 Ollama 官方安装脚本完成安装" }
    }

    return {
      step: "install",
      status: "manual",
      detail: [
        `winget 失败：${commandFailure(winget)}`,
        `官方安装脚本失败：${commandFailure(powershell)}`,
        "请检查网络或系统权限，也可打开 https://ollama.com/download 手动安装。",
      ].join("；"),
    }
  }

  if (osName === "darwin") {
    const brew = await run("brew", ["install", "ollama"], 10 * 60_000)
    if (brew.ok) return { step: "install", status: "ok", detail: "已通过 Homebrew 安装 Ollama" }
    return {
      step: "install",
      status: "manual",
      detail: `自动安装未完成：${commandFailure(brew)}。请执行 brew install ollama，或打开 https://ollama.com/download`,
    }
  }

  const script = await run("bash", ["-lc", "curl -fsSL https://ollama.com/install.sh | sh"], 10 * 60_000)
  if (script.ok) return { step: "install", status: "ok", detail: "已通过官方脚本安装 Ollama" }
  return {
    step: "install",
    status: "manual",
    detail: `自动安装未完成：${commandFailure(script)}。请执行：curl -fsSL https://ollama.com/install.sh | sh`,
  }
}

async function pullModel(cliPath: string, model: string, modelsDir?: string): Promise<SetupStep> {
  const result = await runCapture(cliPath, ["pull", model], 600000, {
    ...process.env,
    ...(modelsDir ? { OLLAMA_MODELS: modelsDir } : {}),
  })
  if (result.ok) {
    return { step: "pull", status: "ok", detail: `已拉取模型 ${model}` }
  }
  return {
    step: "pull",
    status: "error",
    detail: result.stderr || result.stdout || `拉取模型失败：${model}`,
  }
}

async function persistModelsDirectory(modelsDir: string | undefined) {
  if (!modelsDir || platform() !== "win32") return
  await runCapture("setx", ["OLLAMA_MODELS", modelsDir], 15_000)
}

export async function setupLocalEmbedding(input?: {
  baseURL?: string
  model?: string
  allowInstall?: boolean
  installDir?: string
  modelsDir?: string
}): Promise<SetupResult> {
  const baseURL = input?.baseURL || DEFAULT_OLLAMA_URL
  const model = input?.model || DEFAULT_EMBED_MODEL
  const allowInstall = input?.allowInstall ?? true
  const steps: SetupStep[] = []

  await persistModelsDirectory(input?.modelsDir)
  steps.push({ step: "check", status: "running", detail: "正在检测本机 Ollama…" })
  let status = await inspectOllama({ baseURL, preferredModel: model, installDir: input?.installDir })
  steps[0] = {
    step: "check",
    status: "ok",
    detail: status.cliInstalled
      ? `已检测到 Ollama${status.cliVersion ? `（${status.cliVersion}）` : ""}`
      : "未找到 Ollama CLI",
  }

  if (!status.cliInstalled) {
    if (!allowInstall) {
      steps.push({
        step: "install",
        status: "manual",
        detail: status.installCommand || "请先安装 Ollama",
      })
      return { ok: false, status: { ...status, phase: "needs_manual" }, steps }
    }
    steps.push({ step: "install", status: "running", detail: "正在尝试安装 Ollama…" })
    const installed = await tryInstallOllama({ installDir: input?.installDir })
    steps[steps.length - 1] = installed
    if (installed.status === "ok") await waitForOllamaCli(30_000, input?.installDir)
    status = await inspectOllama({ baseURL, preferredModel: model, installDir: input?.installDir })
    if (!status.cliInstalled) {
      return {
        ok: false,
        status: {
          ...status,
          phase: "needs_manual",
          message: installed.detail || "仍需手动安装 Ollama",
          hint: installed.detail,
        },
        steps,
      }
    }
  }

  if (!status.daemonRunning) {
    steps.push({ step: "start", status: "running", detail: "正在启动 Ollama 服务…" })
    const started = await tryStartOllama(status.cliPath || "ollama", input?.modelsDir)
    steps[steps.length - 1] = started
      ? { step: "start", status: "ok", detail: "Ollama 服务已运行" }
      : {
          step: "start",
          status: "manual",
          detail: "无法自动启动 Ollama。请打开 Ollama 应用，或执行：ollama serve",
        }
    status = await inspectOllama({ baseURL, preferredModel: model, installDir: input?.installDir })
    if (!status.daemonRunning) {
      return { ok: false, status: { ...status, phase: "needs_manual" }, steps }
    }
  } else {
    steps.push({ step: "start", status: "skip", detail: "Ollama 服务已在运行" })
  }

  status = await inspectOllama({ baseURL, preferredModel: model, installDir: input?.installDir })
  if (input?.modelsDir && status.daemonRunning && !status.hasEmbedModel) {
    return {
      ok: false,
      status: {
        ...status,
        phase: "needs_manual",
        message: "模型目录已保存，需重启 Ollama 后继续",
        hint: `请退出并重新启动 Ollama，使 OLLAMA_MODELS=${input.modelsDir} 生效，然后再次点击一键启用。`,
      },
      steps: [
        ...steps,
        {
          step: "restart",
          status: "manual",
          detail: `模型目录已设置为 ${input.modelsDir}，需重启 Ollama 服务后再拉取模型`,
        },
      ],
    }
  }
  if (!status.hasEmbedModel) {
    steps.push({ step: "pull", status: "running", detail: `正在拉取嵌入模型 ${model}…` })
    const pulled = await pullModel(status.cliPath || "ollama", model, input?.modelsDir)
    steps[steps.length - 1] = pulled
    status = await inspectOllama({ baseURL, preferredModel: model, installDir: input?.installDir })
    if (!status.hasEmbedModel) {
      return {
        ok: false,
        status: { ...status, phase: "error", message: pulled.detail || "拉取嵌入模型失败" },
        steps,
      }
    }
  } else {
    steps.push({
      step: "pull",
      status: "skip",
      detail: `嵌入模型已存在：${status.selectedModel}`,
    })
  }

  const selected = status.selectedModel || model
  return {
    ok: true,
    status: {
      ...status,
      ready: true,
      phase: "ready",
      message: `本地向量已就绪（${selected}）`,
    },
    steps,
    config: {
      embedding_mode: "ollama",
      embedding_ollama_url: baseURL,
      embedding_ollama_model: selected.replace(/:latest$/, "") || model,
      ...(input?.installDir ? { embedding_ollama_install_dir: input.installDir } : {}),
      ...(input?.modelsDir ? { embedding_ollama_models_dir: input.modelsDir } : {}),
    },
  }
}
