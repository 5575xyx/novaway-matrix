import { For, Show } from "solid-js"
import { FileIcon } from "./file-icon"
import { layoutToolFileChips, fileChipLabel, TOOL_FILE_CHIP_LIMIT, type ToolFileChip } from "./tool-file-chip-layout"

export { layoutToolFileChips, fileChipLabel, TOOL_FILE_CHIP_LIMIT }
export type { ToolFileChip }

/**
 * 工具摘要行里的文件列表：`[icon] index.html [icon] app.js +2`。
 *
 * 对齐 ZCode 的 file chip 行 —— 用户扫一眼就知道这次动了哪些文件，
 * 不用逐个展开工具行。裁剪规则在 tool-file-chips.ts（纯函数、有单测）。
 *
 * `onOpen` 存在时 chip 可点（打开该文件的预览）；不传则是纯展示。
 */
export function ToolFileChips(props: {
  files: readonly ToolFileChip[]
  limit?: number
  onOpen?: (path: string) => void
}) {
  const layout = () => layoutToolFileChips(props.files, props.limit)

  return (
    <Show when={props.files.length > 0}>
      <span data-slot="tool-file-chips">
        <For each={layout().visible}>
          {(file) => {
            const label = (
              <>
                <FileIcon node={{ path: file.path, type: "file" }} class="size-4 shrink-0" />
                <span data-slot="tool-file-chip-label">{fileChipLabel(file.path)}</span>
              </>
            )
            return (
              <Show
                when={props.onOpen}
                fallback={
                  <span data-slot="tool-file-chip" title={file.path}>
                    {label}
                  </span>
                }
              >
                {(open) => (
                  <button
                    type="button"
                    data-slot="tool-file-chip"
                    title={file.path}
                    class="tool-file-chip-button"
                    onClick={(event) => {
                      event.stopPropagation()
                      open()(file.path)
                    }}
                  >
                    {label}
                  </button>
                )}
              </Show>
            )
          }}
        </For>
        <Show when={layout().overflow > 0}>
          <span data-slot="tool-file-chip-overflow" title={props.files.map((f) => f.path).join("\n")}>
            +{layout().overflow}
          </span>
        </Show>
      </span>
    </Show>
  )
}
