/**
 * Office 编辑器保活缓存。
 *
 * 右栏用 keyed Show 承载文件标签：切标签会整块卸载 FileTabContent，连带把
 * OfficeEditorHost 卸载。若卸载即 dispose，切回来就要重新加载（用户看到的转圈）。
 *
 * 这里把「已挂载的编辑器」按 目录+路径 缓存下来：切走时只把编辑器的 DOM 容器
 * 摘到文档外（React root / worker / 撤销栈都还在），切回来直接挂回，不再重建。
 * 只有真正关闭标签（×）或文件在磁盘上变了且没有未保存改动时才 dispose。
 *
 * 缓存与渲染解耦：即便切到「工作区文件」宿主再切回 Office，编辑器也还在。
 */
import type { createOfficeEditorLifecycle } from "./office-editor-lifecycle"
import { registerOfficeEditorCloseGuard } from "./office-editor-session"

type Session = ReturnType<typeof createOfficeEditorLifecycle>

/** 编辑器回调的可变绑定：切回来时换成当前面板的闭包，避免脏状态写到旧面板。 */
export type OfficeEditorBindings = {
  onDirty?: (dirty: boolean) => void
  write: (bytes: Uint8Array, expectedBaselineSha256?: string) => Promise<void>
  beforeSave?: (baseline: Uint8Array) => Promise<string | false>
}

export type KeepAliveEntry = {
  /** 缓存键：目录 + 挂载路径（旧格式转换后的现代副本路径）。 */
  key: string
  /** 编辑器实际挂载的路径（保存/读回按它定位）。 */
  path: string
  /** 标签路径：关闭守卫与回收按它对齐（旧格式这里是原始 .doc/.xls 路径）。 */
  tabPath: string
  /** 挂载时的文件 base64：磁盘变了且无未保存改动时据此判定需要重建。 */
  base64: string
  /** 编辑器自己的 DOM 容器；摘挂只移动它，不动 React root。 */
  container: HTMLDivElement
  session: Session
  ready: Promise<boolean>
  bindings: OfficeEditorBindings
  attached: boolean
  unregisterGuard?: () => void
}

const cache = new Map<string, KeepAliveEntry>()

export function officeEditorKey(directory: string, path: string) {
  return `${directory}\u0000${path}`
}

export function peekOfficeEditor(key: string) {
  return cache.get(key)
}

/** 放入缓存；同键或同标签的旧实例先释放，避免遗留孤儿编辑器。 */
export function putOfficeEditor(entry: KeepAliveEntry) {
  for (const [key, existing] of [...cache]) {
    if (existing === entry) continue
    if (key === entry.key || existing.tabPath === entry.tabPath) disposeEntry(key, existing)
  }
  cache.set(entry.key, entry)
}

/** 切走：把容器摘到文档外，清掉脏回调，但保留编辑器实例。 */
export function detachOfficeEditor(entry: KeepAliveEntry) {
  entry.attached = false
  entry.bindings.onDirty = undefined
  entry.container.remove()
}

function disposeEntry(key: string, entry: KeepAliveEntry) {
  if (cache.get(key) === entry) cache.delete(key)
  entry.unregisterGuard?.()
  entry.session.dispose()
  entry.container.remove()
}

/** 关闭标签 / 磁盘变更：真正释放编辑器。 */
export function disposeOfficeEditor(key: string) {
  const entry = cache.get(key)
  if (!entry) return
  disposeEntry(key, entry)
}

/** 回收：标签集合里已不存在的编辑器全部释放（覆盖 ×、关闭其它、命令关闭等所有路径）。 */
export function reconcileOfficeEditors(directory: string, openTabPaths: ReadonlySet<string>) {
  for (const [key, entry] of [...cache]) {
    if (!key.startsWith(`${directory}\u0000`)) continue
    if (openTabPaths.has(entry.tabPath)) continue
    disposeEntry(key, entry)
  }
}

/** 目录/会话 teardown：释放该目录下的全部编辑器。 */
export function disposeOfficeEditorsForDirectory(directory: string) {
  for (const [key, entry] of [...cache]) {
    if (key.startsWith(`${directory}\u0000`)) disposeEntry(key, entry)
  }
}

/** 注册一个常驻关闭守卫：读缓存实例的脏状态，标签 inactive 时也能拦截关闭。 */
export function registerKeepAliveCloseGuard(entry: KeepAliveEntry, confirm: () => Promise<boolean>) {
  entry.unregisterGuard = registerOfficeEditorCloseGuard(entry.tabPath, () => {
    if (!entry.session.dirty()) return Promise.resolve(true)
    return confirm()
  })
}
