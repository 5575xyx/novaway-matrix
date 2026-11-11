/**
 * 工作区文件树拖拽协议：文件与目录都能拖进对话输入区。
 * 系统原生 drop 只认 `text/plain` / `text/uri-list`，目录没有可用的原生载体，
 * 所以目录靠自定义 MIME 传递结构化 payload；文件仍保留 `file:` 文本，右栏预览照旧可开。
 */

export const WORKSPACE_FILE_DRAG_MIME = "application/x-novaway-workspace-file"

export type WorkspaceFileDragPayload = {
  type: "file" | "directory"
  path: string
  name: string
}

export function serializeWorkspaceFileDragPayload(payload: WorkspaceFileDragPayload): string {
  return JSON.stringify(payload)
}

export function parseWorkspaceFileDragPayload(raw: string | null | undefined): WorkspaceFileDragPayload | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const value = parsed as Record<string, unknown>
    if (
      (value.type !== "file" && value.type !== "directory") ||
      typeof value.path !== "string" ||
      !value.path ||
      typeof value.name !== "string"
    ) {
      return null
    }
    return { type: value.type, path: value.path, name: value.name }
  } catch {
    return null
  }
}

export function readWorkspaceFileDragPayload(dataTransfer: DataTransfer | null): WorkspaceFileDragPayload | null {
  if (!dataTransfer || !Array.from(dataTransfer.types).includes(WORKSPACE_FILE_DRAG_MIME)) return null
  return parseWorkspaceFileDragPayload(dataTransfer.getData(WORKSPACE_FILE_DRAG_MIME))
}
