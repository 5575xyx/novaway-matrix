/**
 * 标签切换之间的编辑器记忆。
 *
 * 一条硬承诺：**切走再切回来，光标、选区、滚动位置和未保存的
 * 修改都还在**。我们这边的标签是「只渲染当前激活的那个」，切走时整块 DOM
 * 都会被销毁（见 session-side-panel 里的 keyed Show），所以状态必须存在组件外面。
 *
 * 这里只放三样东西，都是纯数据，不碰 DOM：
 *   - 未保存的草稿（写盘失败或还没写完就被切走时，回来还能接着改）；
 *   - 光标 / 选区（字符偏移，恢复时按当前文本长度夹一下）；
 *   - 滚动位置（左右也要记：代码编辑器是 `wrap="off"` 的横向滚动）。
 *
 * 容量按 LRU 收口：长期开着几十个标签也不会无限涨。
 */

import { createSignal } from "solid-js"

export type EditorViewState = {
  selectionStart: number
  selectionEnd: number
  scrollTop: number
  scrollLeft: number
}

const LIMIT = 40

/**
 * 草稿落盘（崩溃恢复）。
 *
 * 内存里的草稿只在一次会话里有效；应用被强杀 / 崩溃后，没写盘的字就没了。
 * 常见做法是「恢复目录 + 定期快照」，我们这边进程里能直接用的是 localStorage：
 * 同样是持久化、同样跨重启，而且不需要额外的文件生命周期管理。
 *
 * 约束：
 * - 只持久化**草稿**（未保存的修改），视图位置不落盘（跨重启没有意义）；
 * - 单条超过 1 MB 不落盘（localStorage 的配额大约 5 MB，写不进去还会抛异常）；
 * - key 带上工作区目录，两个工作区里同名文件互不干扰。
 */
const DRAFT_PREFIX = "novaway.draft.v1:"
const DRAFT_MAX_CHARS = 1_000_000

let draftScope = ""

/** 由文件面板在挂载时报告当前工作区目录（用来隔离不同工作区的草稿）。 */
export function setDraftScope(directory: string) {
  draftScope = directory.replace(/\\/g, "/").replace(/\/+$/, "")
}

const draftKey = (path: string) => DRAFT_PREFIX + draftScope + "::" + path

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

const drafts = new Map<string, string>()
const views = new Map<string, EditorViewState>()
// 富文本设计视图 / 表格网格这类「没有光标但会滚动」的区域，只记滚动位置。
const scrolls = new Map<string, { top: number; left: number }>()
// 视图状态：Markdown 的实况/阅读/源码、CSV 的格子/文本、幻灯片的缩放。
// 这些也是「切走再切回来应该还在」的一部分。
const modes = new Map<string, string>()
const zooms = new Map<string, number>()

// 落盘是防抖的：每敲一个字都写一次 localStorage，大文件会明显卡顿。
const pendingDrafts = new Set<string>()
let persistTimer: ReturnType<typeof setTimeout> | undefined
let persistHooked = false

function writePersisted(path: string) {
  const store = storage()
  if (!store) return
  try {
    const text = drafts.get(path)
    if (text === undefined) store.removeItem(draftKey(path))
    else if (text.length > DRAFT_MAX_CHARS) store.removeItem(draftKey(path))
    else store.setItem(draftKey(path), text)
  } catch {
    // 配额满 / 隐私模式：内存里的草稿仍然有效，只是重启后恢复不了。
  }
}

/** 立刻把排队的草稿写进 localStorage（关窗/崩溃前也能调用）。 */
export function flushDrafts() {
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer)
    persistTimer = undefined
  }
  for (const path of pendingDrafts) writePersisted(path)
  pendingDrafts.clear()
}

function schedulePersist(path: string) {
  pendingDrafts.add(path)
  if (persistTimer !== undefined) return
  persistTimer = setTimeout(() => {
    persistTimer = undefined
    flushDrafts()
  }, 400)
  // 关窗时把最后 400ms 内的输入也带出去。只挂一次，重复挂会泄漏。
  if (!persistHooked) {
    persistHooked = true
    if (typeof globalThis.addEventListener === "function") globalThis.addEventListener("pagehide", flushDrafts)
  }
}

/** Map 的插入顺序就是 LRU：重新 set 会把它挪到队尾。 */
function remember<T>(store: Map<string, T>, path: string, value: T) {
  store.delete(path)
  store.set(path, value)
  while (store.size > LIMIT) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

/** 记下还没写盘的草稿；稍后落盘一份，崩溃/重启后还能恢复。 */
export function rememberDraft(path: string, text: string) {
  remember(drafts, path, text)
  schedulePersist(path)
}

/** 取回内存里的草稿；没有就是 undefined（调用方退回磁盘内容）。 */
export function draftOf(path: string): string | undefined {
  const value = drafts.get(path)
  if (value === undefined) return undefined
  // 命中一次就挪到队尾，避免正在编辑的文件被别的文件挤掉。
  remember(drafts, path, value)
  return value
}

/**
 * 取回**上次运行留下的**草稿。
 *
 * 和 `draftOf` 分开：内存缓存有 LRU 上限，落盘那份没有。恢复时先问内存，
 * 再问落盘；混在一起会让「被 LRU 挤掉」看起来像「草稿还在」，语义就糊了。
 */
export function persistedDraftOf(path: string): string | undefined {
  const store = storage()
  if (!store) return undefined
  try {
    return store.getItem(draftKey(path)) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * 写盘成功后清掉草稿。
 *
 * 传了 `text` 就比较一下：保存期间用户可能又敲了字，
 * 那种情况下里面已经是新内容，清掉会把新输入也丢了。
 */
export function clearDraft(path: string, text?: string) {
  if (text !== undefined && drafts.get(path) !== text) return
  drafts.delete(path)
  pendingDrafts.delete(path)
  try {
    storage()?.removeItem(draftKey(path))
  } catch {
    // 删不掉也不影响：下次保存成功时会再清一次。
  }
}

export function rememberView(path: string, view: EditorViewState) {
  remember(views, path, view)
}

export function viewOf(path: string): EditorViewState | undefined {
  const value = views.get(path)
  if (value === undefined) return undefined
  remember(views, path, value)
  return value
}

/** 记下只关心滚动的区域（富文本设计视图、表格网格）。 */
export function rememberScroll(path: string, top: number, left = 0) {
  remember(scrolls, path, { top, left })
}

export function scrollOf(path: string): { top: number; left: number } | undefined {
  const value = scrolls.get(path)
  if (value === undefined) return undefined
  remember(scrolls, path, value)
  return value
}

const [previewOpenModeRevision, setPreviewOpenModeRevision] = createSignal(0)
const previewOpenModes = new Map<string, "diff" | "file">()
const previewOpenModeKey = (directory: string, path: string) => JSON.stringify([directory, path])

/** 记录文件从哪个入口打开：文件树看文件，变更列表看改动。 */
export function requestPreviewOpenMode(directory: string, path: string, mode: "diff" | "file") {
  previewOpenModes.set(previewOpenModeKey(directory, path), mode)
  setPreviewOpenModeRevision((value) => value + 1)
}

export function previewOpenModeOf(directory: string, path: string): "diff" | "file" | undefined {
  previewOpenModeRevision()
  return previewOpenModes.get(previewOpenModeKey(directory, path))
}

/** 记下这个标签上次用的视图（markdown: live/preview/source；csv: grid/text）。 */
export function rememberViewMode(path: string, mode: string) {
  remember(modes, path, mode)
}

export function viewModeOf(path: string): string | undefined {
  const value = modes.get(path)
  if (value === undefined) return undefined
  remember(modes, path, value)
  return value
}

/** 记下预览缩放（1 = 适宽，PPTX 这类按页缩放的视图用）。 */
export function rememberZoom(path: string, zoom: number) {
  if (!Number.isFinite(zoom) || zoom <= 0) return
  remember(zooms, path, zoom)
}

export function zoomOf(path: string): number | undefined {
  const value = zooms.get(path)
  if (value === undefined) return undefined
  remember(zooms, path, value)
  return value
}

/** 文件被删除/改名时清掉，避免下次打开同名的另一个文件时还原错位置。 */
export function forgetEditorMemory(path: string) {
  clearDraft(path)
  views.delete(path)
  scrolls.delete(path)
  modes.delete(path)
  zooms.delete(path)
}

/** 应用启动时列出还没保存的草稿（恢复提示用）。 */
export function persistedDrafts(): string[] {
  const store = storage()
  if (!store) return []
  const prefix = DRAFT_PREFIX + draftScope + "::"
  const paths: string[] = []
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index)
      if (key?.startsWith(prefix)) paths.push(key.slice(prefix.length))
    }
  } catch {
    return []
  }
  return paths
}

/**
 * 单测用：把内存缓存和落盘草稿都清空。
 *
 * `keepPersisted` 保留落盘那份 —— 用来模拟「应用重启」：内存是空的，磁盘还在。
 */
export function resetEditorMemory(keepPersisted = false) {
  drafts.clear()
  views.clear()
  scrolls.clear()
  modes.clear()
  zooms.clear()
  pendingDrafts.clear()
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer)
    persistTimer = undefined
  }
  if (keepPersisted) return
  const store = storage()
  if (!store) return
  try {
    const keep: string[] = []
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index)
      if (key?.startsWith(DRAFT_PREFIX)) keep.push(key)
    }
    for (const key of keep) store.removeItem(key)
  } catch {
    // 清不掉也无所谓：单测里拿不到 localStorage 才是常态。
  }
}
