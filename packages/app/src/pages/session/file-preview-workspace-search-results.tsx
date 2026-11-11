import { For, Show, type Component } from "solid-js"

export type WorkspaceSearchRow = { path: string; line: number; text: string }
export type WorkspaceSearchGroup = { path: string; rows: WorkspaceSearchRow[] }

export const FilePreviewWorkspaceSearchResults: Component<{
  open: boolean
  inputRef: (element: HTMLInputElement) => void
  query: string
  busy: boolean
  groups: WorkspaceSearchGroup[]
  resultCount: number
  onQueryInput: (query: string) => void
  onQueryKeyDown: (event: KeyboardEvent) => void
  onClose: () => void
  onResult: (row: WorkspaceSearchRow) => void
}> = (props) => (
  <Show when={props.open}>
    <div class="flex shrink-0 flex-col border-b border-border bg-background-weak">
      <div class="flex items-center gap-1 px-3 py-1.5">
        <input
          ref={props.inputRef}
          type="text"
          data-action="text-workspace-search-query"
          placeholder="在项目里搜索…"
          class="h-6 w-56 rounded border border-border bg-background px-1.5 text-11-regular text-foreground outline-none focus:border-border-hover"
          value={props.query}
          onInput={(event) => props.onQueryInput(event.currentTarget.value)}
          onKeyDown={props.onQueryKeyDown}
        />
        <span class="text-11-regular text-foreground-subtlest">
          {props.busy
            ? "搜索中…"
            : props.resultCount > 0
              ? `${props.resultCount} 条 · ${props.groups.length} 个文件`
              : props.query.trim()
                ? "无匹配"
                : ""}
        </span>
        <span class="ml-auto">
          <button
            type="button"
            data-action="text-workspace-search-close"
            class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
            onClick={props.onClose}
          >
            关闭
          </button>
        </span>
      </div>
      <Show when={props.groups.length > 0}>
        <div class="max-h-64 overflow-y-auto pb-1">
          <For each={props.groups}>
            {(group) => (
              <div data-action="text-workspace-search-group">
                <div class="flex items-baseline gap-1 px-3 pt-1 text-11-medium text-foreground">
                  <span class="min-w-0 truncate">{group.path}</span>
                  <span class="shrink-0 text-foreground-subtlest">{group.rows.length}</span>
                </div>
                <For each={group.rows}>
                  {(row) => (
                    <button
                      type="button"
                      data-action="text-workspace-search-result"
                      class="flex w-full items-baseline gap-2 py-0.5 pl-6 pr-3 text-left text-11-regular transition-colors hover:bg-hover"
                      onClick={() => props.onResult(row)}
                    >
                      <span class="w-10 shrink-0 text-right tabular-nums text-foreground-subtlest">{row.line}</span>
                      <span class="min-w-0 truncate text-foreground-subtle">{row.text}</span>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  </Show>
)
