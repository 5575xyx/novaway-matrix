// e2e 夹具：直接验证 Lexora sheets-editor.js 能在 NovaWay 环境挂载并保存。
// 不经过 NovaWay app —— 只把 Lexora 的 mountSheets 喂给一个真实 XLSX，
// 模拟 NovaWay Host 提供的最小 ViewContext，验证：
//   1. sheets-editor.js 从 /office/ 加载成功；
//   2. 表格编辑器挂载到容器（Univer 网格出现）；
//   3. save() 产出可解析的 XLSX 字节；
//   4. 用 save() 的字节重新挂载（模拟「保存后重开」）。
import { xlsxFromSheets } from "@novaway/core/office/create"
import JSZip from "jszip"

// 浏览器里没有 Buffer：分块转 base64。
function toBase64(bytes: Uint8Array) {
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function makeWorkbook(cells: readonly (readonly string[])[]) {
  return xlsxFromSheets("销售表", [{ name: "Sheet1", rows: cells }])
}

const macroProjectFixture = new Uint8Array([0, 0x58, 0x4c, 0x53, 0xff, 0x4d, 0x41, 0x43, 0x52, 0x4f])

async function makeMacroXlsm() {
  const archive = await JSZip.loadAsync(
    makeWorkbook([
      ["产品", "数量", "金额"],
      ["苹果", "12", "1200"],
      ["香蕉", "5", "350"],
    ]),
  )
  archive.file("xl/vbaProject.bin", macroProjectFixture)
  return new Uint8Array(await archive.generateAsync({ type: "uint8array" }))
}

async function readMacroProject(bytes: Uint8Array) {
  const archive = await JSZip.loadAsync(bytes)
  return (await archive.file("xl/vbaProject.bin")?.async("uint8array")) ?? null
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
    saveFile: async () => true,
  },
  environment: { colorScheme: "light" },
  onEnvironmentChange: () => ({ dispose: () => {} }),
}

interface SheetsEditor {
  save: () => Promise<Uint8Array>
  markSaved?: (bytes?: Uint8Array) => void
  dispose: () => void
}

let bundlePromise:
  | Promise<{
      mountSheets: (options: {
        context: unknown
        container: HTMLElement
        bytes: Uint8Array
        name: string
        onDirty: (dirty: boolean) => void
      }) => Promise<SheetsEditor>
    }>
  | undefined

function loadBundle() {
  bundlePromise ??= (async () => {
    // 运行时拼接 + 随机 query：esbuild 无法常量折叠、Vite 无法静态解析出
    // public 路径，交给浏览器原生 import()。Vite 中间件原样响应 /office/*。
    const bundleUrl = `/office/sheets-editor.js?novaway=${Math.random().toString(36).slice(2)}`
    return (await import(/* @vite-ignore */ bundleUrl)) as {
      mountSheets: (options: {
        context: unknown
        container: HTMLElement
        bytes: Uint8Array
        name: string
        onDirty: (dirty: boolean) => void
      }) => Promise<SheetsEditor>
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
  // Univer 会把容器设为 height:100%，需要父链 #root 有高度（夹具 HTML 已撑 100vh）。
  container.style.height = "100%"
  container.style.width = "100%"
  root.append(container)
  let dirty = false
  let current: SheetsEditor | undefined
  try {
    const { mountSheets } = await loadBundle()
    const mount = async (bytes: Uint8Array, name: string) => {
      current?.dispose()
      container.replaceChildren()
      dirty = false
      status.setAttribute("data-dirty", "false")
      const editor = await mountSheets({
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
    ;(window as unknown as Record<string, unknown>).__lexoraSheets = {
      mount,
      current: () => current,
      getDirty: () => dirty,
      makeMacroXlsm,
      readMacroProject,
      dispose: () => current?.dispose(),
    }
    await mount(
      makeWorkbook([
        ["产品", "数量", "金额"],
        ["苹果", "12", "1200"],
        ["香蕉", "5", "350"],
      ]),
      "sales.xlsx",
    )
  } catch (error) {
    status.textContent = `failed: ${error instanceof Error ? error.message : String(error)}`
    status.setAttribute("data-error", "true")
  }
}

void main()
