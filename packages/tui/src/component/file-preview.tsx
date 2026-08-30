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

  const loadFile = (filePath: string) => {
    try {
      const stat = statSync(filePath)
      setFileName(path.basename(filePath))
      
      if (stat.size > MAX_FILE_SIZE) {
        setContent(`[File too large: ${(stat.size / 1024).toFixed(1)}KB]`)
        setLineCount(0)
        return
      }

      const fileContent = readFileSync(filePath, "utf-8")
      const lines = fileContent.split("\n")
      setLineCount(lines.length)
      setContent(fileContent)
      setIsModified(false)
    } catch {
      setContent("[Cannot read file]")
      setFileName(path.basename(filePath))
      setLineCount(0)
    }
  }

  // Watch for filePath changes
  createMemo(() => {
    const fp = props.filePath
    if (fp) {
      loadFile(fp)
    }
  })

  // Cleanup timeout on unmount
  onCleanup(() => {
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
  })

  const saveFile = () => {
    if (!props.filePath || !textareaRef) return
    try {
      setIsSaving(true)
      const newContent = textareaRef.plainText
      writeFileSync(props.filePath, newContent, "utf-8")
      setContent(newContent)
      setIsModified(false)
    } catch (e) {
      console.error("Failed to save file:", e)
    } finally {
      setIsSaving(false)
    }
  }

  const handleContentChange = () => {
    if (textareaRef) {
      setIsModified(true)
      const lines = textareaRef.plainText.split("\n")
      setLineCount(lines.length)

      // Auto-save with debounce
      if (saveTimeout) {
        clearTimeout(saveTimeout)
      }
      saveTimeout = setTimeout(() => {
        saveFile()
      }, AUTO_SAVE_DELAY)
    }
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
