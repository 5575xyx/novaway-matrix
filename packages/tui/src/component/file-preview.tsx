import { createSignal, createMemo, Show, onCleanup, onMount } from "solid-js"
import { TextAttributes, TextareaRenderable } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useTuiConfig } from "../config"
import { useBindings } from "../keymap"
import { fileIcon } from "../util/panel-icons"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import path from "node:path"

const MAX_FILE_SIZE = 1024 * 100 // 100KB limit for preview
const AUTO_SAVE_DELAY = 500 // Auto-save debounce delay in ms

export interface FilePreviewProps {
  filePath: string | null
  onClose: () => void
}

export function FilePreview(props: FilePreviewProps) {
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const [content, setContent] = createSignal<string>("")
  const [fileName, setFileName] = createSignal<string>("")
  const [lineCount, setLineCount] = createSignal<number>(0)
  const [isModified, setIsModified] = createSignal<boolean>(false)
  const [isSaving, setIsSaving] = createSignal<boolean>(false)
  let textareaRef: TextareaRenderable | undefined
  const [textareaTarget, setTextareaTarget] = createSignal<TextareaRenderable>()
  let saveTimeout: NodeJS.Timeout | undefined
  // 缓冲区当前对应的文件与内容:切文件、防抖保存、过滤 setText 回显都靠它们对账。
  let loadedPath: string | undefined
  const [loadedContent, setLoadedContent] = createSignal<string>("")
  // 占位文案(文件过大/读不了)绝不能被自动保存写回磁盘毁掉真文件,用这个开关拦住。
  let canEdit = false

  // 文件编辑器里回车就该换行:全局托管输入层(见 keymap.tsx)会在 textarea 聚焦时
  // 把 return 绑成"提交",对提示输入框是对的,对文件编辑器就成了什么都不发生。
  // 挂一个更高优先级的局部层(和 dialog-prompt 同一招),只在本文本框聚焦时生效,
  // 把 return 抢回来走 input.newline(该命令的操作对象就是当前聚焦的编辑器)。
  useBindings(() => ({
    target: textareaTarget,
    enabled: textareaTarget() !== undefined,
    priority: 1,
    bindings: [{ key: "return", cmd: "input.newline" }],
  }))

  // 返回实际灌入缓冲区的文本,供切文件后命令式 setText 用。
  const loadFile = (filePath: string): string => {
    const name = path.basename(filePath)
    setFileName(name)
    try {
      const stat = statSync(filePath)

      if (stat.size > MAX_FILE_SIZE) {
        canEdit = false
        const notice = `[文件过大：${(stat.size / 1024).toFixed(1)}KB，暂不支持打开编辑]`
        setContent(notice)
        setLoadedContent(notice)
        setLineCount(0)
        setIsModified(false)
        return notice
      }

      const fileContent = readFileSync(filePath, "utf-8")
      canEdit = true
      setLineCount(fileContent.split("\n").length)
      setContent(fileContent)
      setLoadedContent(fileContent)
      setIsModified(false)
      return fileContent
    } catch {
      canEdit = false
      const notice = "[无法读取文件]"
      setContent(notice)
      setLoadedContent(notice)
      setLineCount(0)
      setIsModified(false)
      return notice
    }
  }

  // 防抖期间用户切走了文件:把仍在缓冲区里的旧文件内容写回旧路径。
  // 不做这一步,挂起的定时器之后会拿着旧内容写到新路径上,直接覆盖掉新文件。
  const flushPendingSave = () => {
    if (!saveTimeout) return
    clearTimeout(saveTimeout)
    saveTimeout = undefined
    if (canEdit && loadedPath && textareaRef) {
      try {
        writeFileSync(loadedPath, textareaRef.plainText, "utf-8")
      } catch {
        // 落盘失败不阻塞切换,与自动保存的静默语义一致
      }
    }
  }

  // 切文件时组件不重挂载,而 textarea 的 initialValue 只在挂载那一刻生效 ——
  // 之后必须命令式 setText 才能把新内容灌进去,否则永远显示第一个文件的内容。
  createMemo(() => {
    const fp = props.filePath
    if (!fp) return
    if (loadedPath && loadedPath !== fp) flushPendingSave()
    const text = loadFile(fp)
    loadedPath = fp
    if (textareaRef) textareaRef.setText(text)
  })

  // Cleanup timeout on unmount
  onCleanup(() => {
    flushPendingSave()
  })

  const saveFile = (targetPath?: string) => {
    const filePath = targetPath ?? props.filePath
    if (!filePath || !textareaRef || !canEdit) return
    try {
      setIsSaving(true)
      const newContent = textareaRef.plainText
      writeFileSync(filePath, newContent, "utf-8")
      setContent(newContent)
      setLoadedContent(newContent)
      setIsModified(false)
    } catch (e) {
      console.error("Failed to save file:", e)
    } finally {
      setIsSaving(false)
    }
  }

  const handleContentChange = () => {
    if (!textareaRef) return
    // setText 灌入的加载内容也会触发一次内容变更(原生事件可能异步到达),
    // 内容与刚加载的一致就不算用户编辑:免得一切文件就被标成"已修改"、
    // 还多跑一次把同样内容写回去的自动保存。
    if (textareaRef.plainText === loadedContent()) {
      if (saveTimeout) {
        clearTimeout(saveTimeout)
        saveTimeout = undefined
      }
      setIsModified(false)
      return
    }
    setIsModified(true)
    setLineCount(textareaRef.plainText.split("\n").length)

    // 保存目标定格在"编辑发生时"的文件,而不是定时器触发时的当前文件。
    const editingPath = props.filePath
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
    saveTimeout = setTimeout(() => {
      saveTimeout = undefined
      saveFile(editingPath ?? undefined)
    }, AUTO_SAVE_DELAY)
  }

  return (
    <Show when={props.filePath}>
      <box
        flexDirection="column"
        flexGrow={1}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={1}
        paddingRight={1}
      >
        <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            {fileIcon(fileName(), false)} {fileName()} {isModified() ? "(已修改)" : ""} {isSaving() ? "保存中..." : ""}
          </text>
          <text fg={theme.textMuted} onMouseUp={props.onClose}>
            [X] 关闭
          </text>
        </box>
        <text fg={theme.textMuted} paddingBottom={1}>
          {lineCount()} 行
        </text>
        {/* 行号槽在编辑框最左边:line_number 会把 textarea 当作 target 挂进来,
            行号跟随滚动与总行数自动变化(占位/错误提示文案没有行信息,gutter 自动留空)。 */}
        <line_number flexGrow={1} minHeight={0} width="100%" fg={theme.textMuted} minWidth={3} paddingRight={1}>
          <textarea
            ref={(val: TextareaRenderable) => {
              textareaRef = val
              setTextareaTarget(val)
            }}
            width="100%"
            flexGrow={1}
            focused
            initialValue={content()}
            onContentChange={handleContentChange}
            backgroundColor={theme.backgroundPanel}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.text}
            cursorStyle={tuiConfig.cursor}
            placeholder="开始编辑..."
            placeholderColor={theme.textMuted}
          />
        </line_number>
      </box>
    </Show>
  )
}
