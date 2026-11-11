// e2e 夹具：直接验证 Lexora docx-editor.js 能在 NovaWay 环境挂载并保存。
// 不经过 NovaWay app —— 只把 Lexora 的 mountDocxEditor 喂给一个真实 DOCX，
// 模拟 NovaWay Host 提供的最小 ViewContext，验证：
//   1. docx-editor.js 从 /office/ 加载成功；
//   2. 编辑器挂载到容器（React root + GenOffice 文档页出现）；
//   3. save() 产出可解析的 DOCX 字节；
//   4. 用 save() 的字节重新挂载（模拟「保存后重开」），能读到编辑后的内容。
import { createDocument } from "@novaway/core/office/create"
import JSZip from "jszip"

// 浏览器里没有 Buffer：分块转 base64。
function toBase64(bytes: Uint8Array) {
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function makeDocx(body: string) {
  return createDocument("report.docx", { title: "季度报告", body }).bytes
}

const macroProjectFixture = new Uint8Array([0, 1, 2, 0xff, 0x56, 0x42, 0x41, 0x00, 0x7f])

async function makeMacroDocm() {
  const archive = await JSZip.loadAsync(makeDocx("宏文件保真测试"))
  archive.file("word/vbaProject.bin", macroProjectFixture)
  return new Uint8Array(await archive.generateAsync({ type: "uint8array" }))
}

async function readMacroProject(bytes: Uint8Array) {
  const archive = await JSZip.loadAsync(bytes)
  return (await archive.file("word/vbaProject.bin")?.async("uint8array")) ?? null
}

// 模拟 NovaWay Host 的最小 Lexora ViewContext（对齐 docx-editor-host.ts）。
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
    saveFile: async () => true,
  },
  environment: { colorScheme: "light" },
  onEnvironmentChange: () => ({ dispose: () => {} }),
}

interface DocxEditor {
  save: () => Promise<Uint8Array>
  markSaved?: (bytes?: Uint8Array) => void
  dispose: () => void
}

let bundlePromise:
  | Promise<{
      mountDocxEditor: (options: {
        context: unknown
        container: HTMLElement
        bytes: Uint8Array
        name: string
        onDirty: (dirty: boolean) => void
      }) => Promise<DocxEditor>
    }>
  | undefined

function loadBundle() {
  bundlePromise ??= (async () => {
    // 运行时拼接 + 随机 query：esbuild 无法常量折叠、Vite 无法静态解析出
    // public 路径，交给浏览器原生 import()。Vite 中间件原样响应 /office/*。
    const bundleUrl = `/office/docx-editor.js?novaway=${Math.random().toString(36).slice(2)}`
    return (await import(/* @vite-ignore */ bundleUrl)) as {
      mountDocxEditor: (options: {
        context: unknown
        container: HTMLElement
        bytes: Uint8Array
        name: string
        onDirty: (dirty: boolean) => void
      }) => Promise<DocxEditor>
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
  container.style.height = "100vh"
  container.style.width = "100vw"
  root.append(container)

  let dirty = false
  let current: DocxEditor | undefined
  try {
    const { mountDocxEditor } = await loadBundle()
    const mount = async (bytes: Uint8Array, name: string) => {
      current?.dispose()
      container.replaceChildren()
      dirty = false
      status.setAttribute("data-dirty", "false")
      const editor = await mountDocxEditor({
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
    ;(window as unknown as Record<string, unknown>).__lexoraDocx = {
      mount,
      current: () => current,
      getDirty: () => dirty,
      makeMacroDocm,
      readMacroProject,
      dispose: () => current?.dispose(),
    }
    await mount(makeDocx("第一段正文\n第二段正文"), "report.docx")
  } catch (error) {
    status.textContent = `failed: ${error instanceof Error ? error.message : String(error)}`
    status.setAttribute("data-error", "true")
  }
}

void main()
