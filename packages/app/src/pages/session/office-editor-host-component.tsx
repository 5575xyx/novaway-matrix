/**
 * Office Editor Host 组件（SolidJS 侧）。
 *
 * 负责 Lexora 式编辑器在 NovaWay 文件面板里的完整生命周期：
 *  - 把 base64 解码成字节，交给编辑器挂载到独立 DOM 容器；
 *  - 监听 dirty 回调，联动面板的未保存状态；
 *  - 保存时走 `office.document.save`（整字节写回原路径）；
 *  - 卸载时调用编辑器 dispose，释放 React root / worker / 资源。
 *
 * 编辑器本身是 React/Univer 等，Solid 不直接嵌 React 组件 —— 这里只提供
 * 一个 div 容器，由编辑器工厂在自己的 root 里挂载，互不污染。
 */
import { createEffect, createSignal, onCleanup, on } from "solid-js"
import { useSDK } from "@/context/sdk"
import { officeEditorMountFor } from "./office-editor-host"
import { createOfficeEditorLifecycle } from "./office-editor-lifecycle"
import { bytesToBase64 } from "./office-preview-utils"
import { registerOfficeEditorSave } from "./office-editor-session"

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
}) {
  const sdk = useSDK()
  let container: HTMLDivElement | undefined
  const [failed, setFailed] = createSignal<string | undefined>()
  const [loading, setLoading] = createSignal(true)
  let session: ReturnType<typeof createOfficeEditorLifecycle> | undefined
  let mountedPath: string | undefined
  let unregisterSave: (() => void) | undefined

  createEffect(
    on(
      () => [props.path, props.base64] as const,
      ([path, base64]) => {
        if (session?.dirty() && path === mountedPath) return
        unregisterSave?.()
        unregisterSave = undefined
        session?.dispose()
        session = undefined
        mountedPath = path
        setFailed(undefined)
        setLoading(true)
        const mount = officeEditorMountFor(path)
        if (!mount || !container) {
          setFailed("此格式没有可用的原生编辑器，请使用只读预览或转换导出。")
          setLoading(false)
          return
        }
        // Snapshot the target and SDK client before any asynchronous work.
        const client = sdk.client
        const write = props.writeBytes
        const current = createOfficeEditorLifecycle({
          context: { container, bytes: base64ToBytesCompat(base64), name: path.split("/").pop() ?? path },
          mount,
          beforeSave: props.beforeSave,
          write:
            write ??
            (async (bytes, expectedBaselineSha256) => {
              await client.office.document.save({
                directory: sdk.directory,
                path,
                contentBase64: bytesToBase64(bytes),
                ...(expectedBaselineSha256 ? { expectedBaselineSha256 } : {}),
              })
            }),
          onDirty: (dirty) => props.onDirty?.(dirty),
        })
        session = current
        void current.ready
          .then((mounted) => {
            if (session !== current || !mounted) return
            unregisterSave = registerOfficeEditorSave(path, current.save, current.snapshot)
            setLoading(false)
          })
          .catch((error: unknown) => {
            if (session !== current) return
            setFailed(error instanceof Error ? error.message : String(error))
            setLoading(false)
          })
      },
    ),
  )

  onCleanup(() => {
    unregisterSave?.()
    session?.dispose()
    session = undefined
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
          class="absolute inset-0 z-10 flex items-center justify-center px-6 text-12-regular text-icon-critical-base"
          role="alert"
        >
          {failed()}
        </div>
      )}
      <div ref={container} class="min-h-0 flex-1" data-office-editor-host="" />
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
