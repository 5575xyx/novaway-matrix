import { RichFilePreview, type RichOp } from "@/pages/session/rich-file-preview"

export function FilePreviewRichContent(props: {
  path: string
  content: string
  readOnly: boolean
  findRequest: () => number
  /** 顶部文件头的「预览 / 查看原文」切换。 */
  mode?: "design" | "source"
  onModeChange?: (mode: "design" | "source") => void

  onSaveBlock: (block: number, html: string) => Promise<void>
  onSaveOps: (ops: RichOp[]) => Promise<void>
  onSaveSource: (html: string) => Promise<void>
}) {
  return (
    <RichFilePreview
      path={props.path}
      content={props.content}
      readOnly={props.readOnly}
      findRequest={props.findRequest}
      mode={props.mode}
      onModeChange={props.onModeChange}
      onSaveBlock={props.onSaveBlock}
      onSaveOps={props.onSaveOps}
      onSaveSource={props.onSaveSource}
    />
  )
}
