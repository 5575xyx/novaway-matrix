/**
 * Office Editor Host 组件（SolidJS 侧）。
 *
 * 负责 Lexora 式编辑器在 NovaWay 文件面板里的完整生命周期：
 *  - 把 base64 解码成字节，交给编辑器挂载到独立 DOM 容器；
 *  - 监听 dirty 回调，联动面板的未保存状态；
 *  - 保存时走 `office.document.save`（整字节写回原路径）；
 *  - 切走标签时只把编辑器摘到文档外保活，切回来直接挂回，不重新加载；
 *  - 真正关闭标签或磁盘变更时才 dispose，释放 React root / worker / 资源。
 *
 * 编辑器本身是 React/Univer 等，Solid 不直接嵌 React 组件 —— 这里只提供
 * 一个挂载点，由编辑器工厂在自己的 root 里挂载，互不污染。
 */
import { createEffect, createSignal, onCleanup, on } from "solid-js"
import { useDialog } from "@novaway/ui/context/dialog"
import { useSDK } from "@/context/sdk"
import { ConfirmDialog } from "@/components/dialog-confirm"
import { officeEditorMountFor } from "./office-editor-host"
import { createOfficeEditorLifecycle } from "./office-editor-lifecycle"
import { bytesToBase64 } from "./office-preview-utils"
import { registerOfficeEditorSave } from "./office-editor-session"
import {
  detachOfficeEditor,
  disposeOfficeEditor,
  officeEditorKey,
  peekOfficeEditor,
  putOfficeEditor,
  registerKeepAliveCloseGuard,
  type KeepAliveEntry,
} from "./office-editor-keepalive"

export function OfficeEditorHost(props: {
  /** 文件路径（工作区相对），保存与读回按它定位。 */
  path: string
  /** 文件 base64（含编码），打开时解码成编辑器初始字节。 */
  base64: string
  /** dirty 联动：面板据此显示未保存指示。 */
  onDirty?: (dirty: boolean) => void
  /** 保存前校验磁盘当前字节是否仍与编辑器基线一致。 */
  beforeSave?: (baselineBytes: Uint8Array) => Promise<string | false>
  /** 宿主注入的写盘通道：编辑器不直接写本地文件。 */
  writeBytes?: (bytes: Uint8Array, expectedBaselineSha256?: string) => Promise<void>
  /** 关闭守卫/回收对齐的标签路径（旧格式转换编辑时是原始文件路径）。 */
  closeGuardPath?: string
}) {
  const sdk = useSDK()
  const dialog = useDialog()
  let mountPoint: HTMLDivElement | undefined
  const [failed, setFailed] = createSignal<string | undefined>()
  const [loading, setLoading] = createSignal(true)
  let active: KeepAliveEntry | undefined
  let unregisterSave: (() => void) | undefined

  // 把当前面板的闭包绑到缓存实例上：切回来时脏状态/写盘都走最新面板。
  const bind = (entry: KeepAliveEntry) => {
    const client = sdk.client
    const write = props.writeBytes
    entry.bindings.onDirty = props.onDirty
    entry.bindings.beforeSave = props.beforeSave
    entry.bindings.write =
      write ??
      (async (bytes, expectedBaselineSha256) => {
        await client.office.document.save({
          directory: sdk.directory,
          path: entry.path,
          contentBase64: bytesToBase64(bytes),
          ...(expectedBaselineSha256 ? { expectedBaselineSha256 } : {}),
        })
      })
  }

  const attach = (entry: KeepAliveEntry) => {
    active = entry
    entry.attached = true
    bind(entry)
    mountPoint?.appendChild(entry.container)
    unregisterSave?.()
    unregisterSave = registerOfficeEditorSave(props.path, entry.session.save, entry.session.snapshot)
    props.onDirty?.(entry.session.dirty())
  }

  createEffect(
    on(
      () => [props.path, props.base64] as const,
      ([path, base64]) => {
        // 有未保存改动时，磁盘刷新也不重建：保住用户正在编辑的内容。
        if (active && active.path === path && active.session.dirty()) {
          bind(active)
          return
        }
        // 本实例上一次挂的编辑器先摘走保活（base64/路径变化才会走到这里）。
        if (active) {
          detachOfficeEditor(active)
          active = undefined
        }
        unregisterSave?.()
        unregisterSave = undefined
        setFailed(undefined)

        const key = officeEditorKey(sdk.directory, path)
        const cached = peekOfficeEditor(key)
        // 命中缓存且字节一致，或缓存里还有未保存改动：直接挂回，不重新加载。
        if (cached && (cached.base64 === base64 || cached.session.dirty())) {
          setLoading(false)
          attach(cached)
          return
        }
        // 字节变了且无未保存改动：旧实例作废，按新字节重建。
        if (cached) disposeOfficeEditor(key)

        const mount = officeEditorMountFor(path)
        if (!mount || !mountPoint) {
          setFailed("此格式没有可用的原生编辑器，请使用只读预览或转换导出。")
          setLoading(false)
          return
        }
        setLoading(true)
        const container = document.createElement("div")
        container.className = "h-full w-full"
        const entry: KeepAliveEntry = {
          key,
          path,
          tabPath: props.closeGuardPath ?? path,
          base64,
          container,
          attached: false,
          bindings: {
            write: async () => {
              throw new Error("Office 编辑器写盘通道尚未绑定")
            },
          },
          session: undefined!,
          ready: undefined!,
        }
        const session = createOfficeEditorLifecycle({
          context: { container, bytes: base64ToBytesCompat(base64), name: path.split("/").pop() ?? path },
          mount,
          beforeSave: (baseline) => entry.bindings.beforeSave?.(baseline) ?? Promise.resolve(undefined),
          write: (bytes, expected) => entry.bindings.write(bytes, expected),
          onDirty: (dirty) => entry.bindings.onDirty?.(dirty),
        })
        entry.session = session
        entry.ready = session.ready
        const name = path.split(/[\\/]/).pop() ?? path
        registerKeepAliveCloseGuard(
          entry,
          () =>
            new Promise<boolean>((resolve) => {
              let settled = false
              const finish = (allow: boolean) => {
                if (settled) return
                settled = true
                resolve(allow)
              }
              void dialog.show(() => (
                <ConfirmDialog
                  open
                  title="文档尚未保存"
                  description={`“${name}”有未保存的更改。关闭后这些更改将丢失。`}
                  confirmText="仍然关闭"
                  variant="danger"
                  onConfirm={() => finish(true)}
                  onClose={() => {
                    dialog.close()
                    finish(false)
                  }}
                />
              ))
            }),
        )
        putOfficeEditor(entry)
        attach(entry)
        void session.ready
          .then((mounted) => {
            if (active !== entry || !mounted) return
            setLoading(false)
          })
          .catch((error: unknown) => {
            if (active !== entry) return
            setFailed(error instanceof Error ? error.message : String(error))
            setLoading(false)
            disposeOfficeEditor(key)
          })
      },
    ),
  )

  onCleanup(() => {
    unregisterSave?.()
    unregisterSave = undefined
    // 切走标签：摘到文档外保活，不 dispose。关闭/回收由缓存层负责。
    if (active) {
      detachOfficeEditor(active)
      active = undefined
    }
  })

  return (
    <div class="relative flex h-full min-h-0 flex-col">
      {loading() && (
        <div class="absolute inset-0 z-10 flex items-center justify-center px-6 text-12-regular text-foreground-subtle">
          正在打开 {props.path.split("/").pop()} …
        </div>
      )}
      {failed() && (
        <div
          class="absolute inset-0 z-10 flex items-center justify-center px-6 text-12-regular text-critical-base"
          role="alert"
        >
          {failed()}
        </div>
      )}
      {/* 加载/失败期间隐藏编辑器半成品 UI，就绪后整体呈现；visibility 保留布局供编辑器测量。 */}
      <div
        ref={mountPoint}
        class="min-h-0 flex-1"
        classList={{ invisible: loading() || !!failed() }}
        data-office-editor-host=""
      />
    </div>
  )
}

/** 解码 base64：浏览器 atob 分块，避免大文件爆栈。 */
function base64ToBytesCompat(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
