// e2e 夹具：直接验证 Lexora slides-editor.js 能在 NovaWay 环境挂载并保存。
// 不经过 NovaWay app —— 只把 Lexora 的 mountSlidesEditor 喂给一个真实 PPTX，
// 模拟 NovaWay Host 提供的最小 ViewContext，验证：
//   1. slides-editor.js 从 /office/ 加载成功；
//   2. 演示文稿编辑器挂载到容器（画布/幻灯片出现）；
//   3. save() 产出可解析的 PPTX 字节；
//   4. 用 save() 的字节重新挂载（模拟「保存后重开」）。
import { pptxFromSlides } from "@novaway/core/office/create"
import { buildLexoraContext } from "@/pages/session/office-editors/lexora-view-context"
import JSZip from "jszip"

// 浏览器里没有 Buffer：分块转 base64。
function toBase64(bytes: Uint8Array) {
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function makeDeck() {
  return pptxFromSlides("项目汇报", [
    { title: "项目汇报", lines: ["年度目标与关键结果"] },
    { title: "数据概览", lines: ["增长 42%", "活跃用户 1.2 万"] },
  ])
}

const macroProjectFixture = new Uint8Array([0, 0x50, 0x50, 0x54, 0xff, 0x4d, 0x41, 0x43, 0x52, 0x4f])

async function makeMacroPptm() {
  const archive = await JSZip.loadAsync(makeDeck())
  archive.file("ppt/vbaProject.bin", macroProjectFixture)
  return new Uint8Array(await archive.generateAsync({ type: "uint8array" }))
}

async function readMacroProject(bytes: Uint8Array) {
  const archive = await JSZip.loadAsync(bytes)
  return (await archive.file("ppt/vbaProject.bin")?.async("uint8array")) ?? null
}

interface OfficeEditor {
  save: () => Promise<Uint8Array>
  markSaved?: (bytes?: Uint8Array) => void
  dispose: () => void
}

let bundlePromise:
  | Promise<{
      mountSlidesEditor: (options: {
        context: unknown
        container: HTMLElement
        bytes: Uint8Array
        name: string
        onDirty: (dirty: boolean) => void
      }) => Promise<OfficeEditor>
    }>
  | undefined

function loadBundle() {
  bundlePromise ??= (async () => {
    // 运行时拼接 + 随机 query：esbuild 无法常量折叠、Vite 无法静态解析出
    // public 路径，交给浏览器原生 import()。Vite 中间件原样响应 /office/*。
    const bundleUrl = `/office/slides-editor.js?novaway=${Math.random().toString(36).slice(2)}`
    return (await import(/* @vite-ignore */ bundleUrl)) as {
      mountSlidesEditor: (options: {
        context: unknown
        container: HTMLElement
        bytes: Uint8Array
        name: string
        onDirty: (dirty: boolean) => void
      }) => Promise<OfficeEditor>
    }
  })()
  return bundlePromise
}

async function main() {
  const root = document.getElementById("root")!
  const status = document.createElement("div")
  status.setAttribute("data-slot", "status")
  status.textContent = "loading"
  root.append(status)

  const container = document.createElement("div")
  container.id = "editor"
  container.style.height = "100%"
  container.style.width = "100%"
  root.append(container)
  let dirty = false
  let current: OfficeEditor | undefined
  let currentAbortController: AbortController | undefined
  try {
    const { mountSlidesEditor } = await loadBundle()
    const mount = async (bytes: Uint8Array, name: string) => {
      current?.dispose()
      currentAbortController?.abort()
      currentAbortController = new AbortController()
      container.replaceChildren()
      dirty = false
      status.setAttribute("data-dirty", "false")
      const onDirty = (value: boolean) => {
        dirty = value
        status.setAttribute("data-dirty", String(value))
      }
      const context = buildLexoraContext({
        container,
        bytes,
        name,
        onDirty,
        signal: currentAbortController.signal,
      })
      status.setAttribute("data-color-scheme", context.environment.colorScheme)
      context.onEnvironmentChange(({ colorScheme }) => status.setAttribute("data-color-scheme", colorScheme))
      const editor = await mountSlidesEditor({
        context,
        container,
        bytes,
        name,
        onDirty,
      })
      current = editor
      status.textContent = "mounted"
      status.setAttribute("data-mounted", "true")
      return editor
    }
    ;(window as unknown as Record<string, unknown>).__lexoraSlides = {
      mount,
      current: () => current,
      getDirty: () => dirty,
      makeMacroPptm,
      readMacroProject,
      dispose: () => current?.dispose(),
    }
    await mount(makeDeck(), "deck.pptx")
  } catch (error) {
    status.textContent = `failed: ${error instanceof Error ? error.message : String(error)}`
    status.setAttribute("data-error", "true")
  }
}

void main()
