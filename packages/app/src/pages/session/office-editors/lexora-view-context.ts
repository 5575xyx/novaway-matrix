/**
 * Lexora ViewContext 的 NovaWay 侧最小实现。
 *
 * 供 DOCX / XLSX / PPTX / PDF 各编辑器 host 复用：Lexora 的 `ViewContext`
 * 字段非常多，各编辑器实际用到的子集高度重叠（workers / clipboard /
 * resources / environment / signal）。这里只实现这些编辑器真正触碰的
 * 最小子集，其余字段不实现。若某格式编辑器需要额外字段，扩展本模块并
 * 在对应 host 的类型里声明。
 */
import type { OfficeEditorContext } from "../office-editor-host"

/** Lexora ViewContext 里各编辑器实际用到的子集。 */
export interface LexoraViewContext {
  readonly signal: AbortSignal
  readonly workers: { create: (entry: string | URL, options?: { type?: "classic" | "module" }) => Promise<Worker> }
  readonly clipboard?: {
    read: () => Promise<{ text?: string; html?: string }>
    write: (data: { text?: string; html?: string }) => Promise<void>
  }
  readonly resources: {
    pickFiles: (options?: {
      filters?: { name: string; extensions: string[] }[]
      multiple?: boolean
    }) => Promise<{ name: string; mimeType: string; id: string; size: number }[]>
    readBytes: (
      resource: { id: string },
      options?: { offset?: number; length?: number },
    ) => Promise<{ data: Uint8Array; size: number; eof: boolean }>
    saveFile: (options: { name: string; data: Blob | ArrayBuffer | Uint8Array }) => Promise<boolean>
  }
  readonly environment: { colorScheme: string }
  onEnvironmentChange: (listener: (environment: { colorScheme: string }) => void) => { dispose: () => void }
  /** 通用命令桥：PDF 编辑器用 commands.execute 读写「签名收藏」偏好。 */
  readonly commands: { execute: (command: string, args?: Record<string, unknown>) => Promise<unknown> }
}

/** 构造 Lexora ViewContext 的最小可用子集（基于浏览器 API 与 Host 信号）。 */
export function buildLexoraContext(host: OfficeEditorContext): LexoraViewContext {
  const signal = host.signal ?? new AbortController().signal
  // `data-theme` is the theme id (for example `novaway`), not the light/dark
  // scheme. The editor consumes the actual scheme from `data-color-scheme`.
  // Reading the old attribute made every embedded office editor receive
  // `colorScheme: "novaway"` and stay in its light UI after a dark-mode switch.
  const readColorScheme = () => document.documentElement.getAttribute("data-color-scheme") ?? "light"
  const environment = { colorScheme: readColorScheme() }
  const listeners = new Set<(environment: { colorScheme: string }) => void>()
  const workers = new Set<Worker>()
  const observer = new MutationObserver(() => {
    environment.colorScheme = readColorScheme()
    for (const listener of listeners) listener({ ...environment })
  })
  // pickFiles 选中的 File 按 id 暂存，供 readBytes 分块读回（PPTX 插入图片等走这条链）。
  const picked = new Map<string, File>()
  signal.addEventListener(
    "abort",
    () => {
      for (const worker of workers) worker.terminate()
      workers.clear()
      picked.clear()
      listeners.clear()
      observer.disconnect()
    },
    { once: true },
  )
  return {
    signal,
    workers: {
      create: async (entry, options) => {
        signal.throwIfAborted()
        const url = typeof entry === "string" ? entry : new URL(entry.toString())
        const worker = new Worker(url, options)
        workers.add(worker)
        return worker
      },
    },
    clipboard: {
      read: async () => {
        const item = await navigator.clipboard.readText()
        return { text: item }
      },
      write: async (data) => {
        await navigator.clipboard.writeText(data.text ?? "")
      },
    },
    resources: {
      pickFiles: async (options) => {
        signal.throwIfAborted()
        const input = document.createElement("input")
        input.type = "file"
        input.multiple = options?.multiple ?? false
        if (options?.filters?.length)
          input.accept = options.filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",")
        const selected = await new Promise<File[]>((resolve) => {
          const finish = (files: File[]) => {
            signal.removeEventListener("abort", cancel)
            input.onchange = null
            input.oncancel = null
            resolve(files)
          }
          const cancel = () => finish([])
          input.onchange = () => finish(Array.from(input.files ?? []))
          input.oncancel = cancel
          signal.addEventListener("abort", cancel, { once: true })
          input.click()
        })
        if (signal.aborted) return []
        return selected.map((file) => {
          const id = crypto.randomUUID()
          picked.set(id, file)
          return { name: file.name, mimeType: file.type, id, size: file.size }
        })
      },
      readBytes: async (resource, options) => {
        signal.throwIfAborted()
        const file = picked.get(resource.id)
        if (!file) throw new Error("未找到已选择的文件。")
        const offset = options?.offset ?? 0
        const length = options?.length ?? file.size - offset
        const end = Math.min(offset + length, file.size)
        const data = new Uint8Array(await file.slice(offset, end).arrayBuffer())
        return { data, size: file.size, eof: end >= file.size }
      },
      saveFile: async (options) => {
        const blob = options.data instanceof Blob ? options.data : new Blob([options.data as BlobPart])
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = options.name
        link.click()
        URL.revokeObjectURL(url)
        return true
      },
    },
    environment,
    onEnvironmentChange(listener) {
      signal.throwIfAborted()
      listeners.add(listener)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-scheme"] })
      return {
        dispose: () => {
          listeners.delete(listener)
          if (!listeners.size) observer.disconnect()
        },
      }
    },
    // PDF 编辑器用「genoffice-*.manage」命令读写签名收藏偏好。
    // 浏览器宿主没有真实命令桥，退化为 localStorage 持久化（键按 command 隔离）。
    commands: {
      execute: async (command, args) => {
        const action = args?.action
        const key = `novaway:lexora:${command}:${String(args?.key ?? "")}`
        if (action === "preferences.get") {
          const raw = localStorage.getItem(key)
          return { ok: true, value: raw ? JSON.parse(raw) : [] }
        }
        if (action === "preferences.set") {
          localStorage.setItem(key, JSON.stringify(args?.value ?? null))
          return { ok: true }
        }
        throw new Error(`宿主未实现命令 ${command}:${String(action)}`)
      },
    },
  }
}
