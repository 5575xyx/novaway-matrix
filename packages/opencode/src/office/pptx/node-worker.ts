import path from "node:path"
import os from "node:os"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { Effect } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { ensureSkillExtracted } from "@/skill/skill-assets"
import { isRecord } from "@/util/record"

export type PptWorkerTask = {
  mode: "review" | "export"
  deckDir: string
  htmlFiles: string[]
  output?: string
  browserChannel?: string
  sourceFingerprint?: string
}

/**
 * 在 Node 子进程中执行 PPT 浏览器阶段。
 *
 * Bun 运行时下 Playwright 与 Chrome DevTools 的 CDP 连接不可用，所以 DOM
 * 审计、截图和 HTML 提取都必须交给 Node 执行。Bun 侧只负责输入门禁和
 * PPTX 后检。
 */
export async function runPptxWorker(task: PptWorkerTask): Promise<unknown> {
  const node = process.env.NOVAWAY_PPT_NODE?.trim() || "node"
  const worker = await resolveWorkerFile()
  const dir = await mkdtemp(path.join(os.tmpdir(), "novaway-ppt-worker-"))
  try {
    const taskPath = path.join(dir, "task.json")
    const resultPath = path.join(dir, "result.json")
    await writeFile(taskPath, JSON.stringify(task), "utf8")

    await new Promise<void>((resolve, reject) => {
      const child = spawn(node, [worker, taskPath, resultPath], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })
      let stderr = ""
      child.stderr.on("data", (chunk) => {
        stderr += chunk
      })
      child.on("error", reject)
      child.on("close", (code) => {
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(stderr.trim() || `PPT 工作进程退出码 ${code}`))
      })
    })

    const parsed: unknown = JSON.parse(await readFile(resultPath, "utf8"))
    if (!isRecord(parsed) || typeof parsed.ok !== "boolean") {
      throw new Error("PPT 工作进程返回了无效结果")
    }
    const result = {
      ok: parsed.ok,
      value: parsed.value,
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    }
    if (!result.ok) throw new Error(result.error ?? "PPT 工作进程失败")
    return result.value
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function resolveWorkerFile(): Promise<string> {
  const devWorker = path.join(import.meta.dir, "worker.mjs")
  if (await pathExists(devWorker)) return devWorker

  // 打包环境：每次先按内容摘要校验/刷新内置资产，再取包含全部依赖的 worker。
  const extracted = await extractPackagedSkill()
  if (extracted) {
    const candidate = path.join(extracted, "pptx-worker", "worker.mjs")
    if (await pathExists(candidate)) return candidate
  }

  throw new Error("找不到 PPT 浏览器工作进程；请确认安装包包含完整内置技能资产且本机已安装 Node")
}

async function extractPackagedSkill() {
  return Effect.runPromise(
    Effect.gen(function* () {
      const fsys = yield* AppFileSystem.Service
      const global = yield* Global.Service
      return yield* ensureSkillExtracted("office-ppt", fsys, global)
    }).pipe(Effect.provide(AppFileSystem.defaultLayer), Effect.provide(Global.defaultLayer)),
  )
}

async function pathExists(target: string) {
  try {
    await readFile(target)
    return true
  } catch {
    return false
  }
}
