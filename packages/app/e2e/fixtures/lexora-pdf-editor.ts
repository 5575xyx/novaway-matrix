// e2e 夹具：直接验证 Lexora pdf-editor.js 能在 NovaWay 环境挂载并保存。
// 不经过 NovaWay app —— 只把 Lexora 的 mountPdfEditor 喂给一个真实 PDF，
// 模拟 NovaWay Host 提供的最小 ViewContext，验证：
//   1. pdf-editor.js 从 /office/ 加载成功；
//   2. PDF 编辑器挂载到容器（pdfjs 画布出现）；
//   3. save() 产出可解析的 PDF 字节（%PDF 头）；
//   4. 用 save() 的字节重新挂载（模拟「保存后重开」）。
import { createPdf } from "@novaway/core/office/pdf/engine"

// 浏览器里没有 Buffer：分块转 base64。
function toBase64(bytes: Uint8Array) {
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

// 模拟 NovaWay Host 的最小 Lexora ViewContext（对齐 lexora-view-context.ts）。
const context = {
  signal: new AbortController().signal,
  workers: {
    create: async (entry: string | URL, options?: { type?: "classic" | "module" }) =>
      new Worker(typeof entry === "string" ? entry : entry.toString(), options),
  },
  clipboard: {
    read: async () => ({ text: "" }),
    write: async () => {},
  },
  resources: {
    pickFiles: async () => [],
    readBytes: async () => ({ data: new Uint8Array(), size: 0, eof: true }),
    saveFile: async () => true,
  },
  commands: {
    execute: async () => ({ ok: true, value: [] }),
  },
  environment: { colorScheme: "light" },
  onEnvironmentChange: () => ({ dispose: () => {} }),
}

interface OfficeEditor {
  save: () => Promise<Uint8Array>
  markSaved?: (bytes?: Uint8Array) => void
  dispose: () => void
}

let bundlePromise:
  | Promise<{
      mountPdfEditor: (options: {
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
    const bundleUrl = `/office/pdf-editor.js?novaway=${Math.random().toString(36).slice(2)}`
    return (await import(/* @vite-ignore */ bundleUrl)) as {
      mountPdfEditor: (options: {
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
  try {
    const { mountPdfEditor } = await loadBundle()
    const mount = async (bytes: Uint8Array, name: string) => {
      current?.dispose()
      container.replaceChildren()
      dirty = false
      status.setAttribute("data-dirty", "false")
      const editor = await mountPdfEditor({
        context,
        container,
        bytes,
        name,
        onDirty: (value) => {
          dirty = value
          status.setAttribute("data-dirty", String(value))
        },
      })
      current = editor
      status.textContent = "mounted"
      status.setAttribute("data-mounted", "true")
      return editor
    }
    ;(window as unknown as Record<string, unknown>).__lexoraPdf = {
      mount,
      current: () => current,
      getDirty: () => dirty,
      dispose: () => current?.dispose(),
    }
    await mount(await createPdf({ title: "季度经营分析报告", body: "营收同比 +42%，利润创新高。" }), "report.pdf")
  } catch (error) {
    status.textContent = `failed: ${error instanceof Error ? error.message : String(error)}`
    status.setAttribute("data-error", "true")
  }
}

void main()
