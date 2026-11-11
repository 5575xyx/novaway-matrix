import { File } from "@novaway/ui/file"
import type { SelectedLineRange } from "@/context/file"
import type { SessionDiffStyle } from "@/context/session-diff"
import type { FileSearchControl } from "@novaway/ui/file"
import type { normalize as normalizeDiff } from "@novaway/ui/session-diff"

export type FilePreviewDiff = ReturnType<typeof normalizeDiff>

export type FilePreviewDiffContentProps = {
  fileDiff: () => FilePreviewDiff
  diffStyle: SessionDiffStyle
  selectedLines: SelectedLineRange | null
  onLineSelected: (range: SelectedLineRange | null) => void
  onLineSelectionEnd: (range: SelectedLineRange | null) => void
  onRendered: () => void
  search?: FileSearchControl
  path?: string
  onContextMenu: (event: MouseEvent) => void
}

export function FilePreviewDiffContent(props: FilePreviewDiffContentProps) {
  return (
    <div class="relative overflow-hidden pb-40" onContextMenu={props.onContextMenu}>
      <File
        mode="diff"
        fileDiff={props.fileDiff().fileDiff}
        diffStyle={props.diffStyle}
        enableLineSelection
        selectedLines={props.selectedLines}
        onLineSelected={props.onLineSelected}
        onLineSelectionEnd={props.onLineSelectionEnd}
        onRendered={props.onRendered}
        search={props.search}
        class="select-text"
        media={{ mode: "auto", path: props.path }}
      />
    </div>
  )
}
