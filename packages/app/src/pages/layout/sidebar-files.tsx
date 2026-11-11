import { For, Show, createSignal } from "solid-js"
import { FileIcon } from "@novaway/ui/file-icon"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { encodeFilePath } from "@/context/file/path"
import * as RecentFiles from "@/context/file/recent-files"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { requestPreviewOpenMode } from "@/pages/session/editor-memory"
import { isOfficePreviewPath } from "@/pages/session/office-preview-utils"
import { createWorkspaceFiles } from "./workspace-files-store"

/**
 * 左侧「文件」视图：最近打开 + 变更文件列表。
 *
 * 整棵文件树已经搬到右侧面板，
 * 左栏只留"我改了哪些文件"这种一眼能看完的清单，头部按钮负责打开右侧树。
 */
export function SidebarFiles(props: { directory: string; sessionKey: () => string }) {
  const language = useLanguage()
  const layout = useLayout()
  const files = createWorkspaceFiles(() => props.directory)
  const recent = () => RecentFiles.recent(props.directory)
  const [showRecent, setShowRecent] = createSignal(true)

  const openFile = (path: string, mode: "diff" | "file") => {
    requestPreviewOpenMode(props.directory, path, mode)
    void layout.tabs(props.sessionKey()).open(`file://${encodeFilePath(path)}`)
    layout.sidePane.add(isOfficePreviewPath(path) ? "office" : "preview")
  }

  const openTree = () => {
    // 树嵌在「工作区文件」面板里：展开右栏并确保预览标签在前。
    layout.sidePane.setTree(true)
    layout.sidePane.add("preview")
    layout.sidePane.open()
  }

  return (
    <div class="flex size-full min-h-0 flex-col">
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <span class="flex-1 text-ui-caption text-foreground">{language.t("sidebar.tree.title")}</span>
        <IconButton
          icon="tree-structure"
          size="small"
          variant="ghost"
          data-action="sidebar-open-file-tree"
          title={language.t("sidebar.tree.openInPane")}
          aria-label={language.t("sidebar.tree.openInPane")}
          onClick={openTree}
        />
        <IconButton
          icon="refresh"
          size="small"
          variant="ghost"
          title={language.t("git.refresh")}
          aria-label={language.t("git.refresh")}
          onClick={() => files.refresh()}
        />
      </div>
      {/* 最近打开：只读路径不读内容，点一条按标签页打开。 */}
      <Show when={recent().length > 0 || showRecent()}>
        <div class="shrink-0 border-b border-border">
          <div class="flex h-7 w-full items-center gap-1 px-2 text-ui-caption text-foreground-subtle">
            <button
              type="button"
              data-action="sidebar-recent-toggle"
              class="flex min-w-0 flex-1 items-center gap-1 text-left transition-colors hover:text-foreground"
              onClick={() => setShowRecent(!showRecent())}
            >
              <Icon name={showRecent() ? "chevron-down" : "chevron-right"} size="small" class="shrink-0" />
              <span class="truncate">{language.t("sidebar.tree.recent")}</span>
            </button>
            <Show when={recent().length > 0}>
              <button
                type="button"
                data-action="sidebar-recent-clear"
                class="shrink-0 rounded px-1 py-0.5 text-ui-xs text-foreground-subtlest transition-colors hover:bg-hover hover:text-foreground"
                title={language.t("sidebar.tree.recentClear")}
                onClick={() => {
                  for (const item of recent()) RecentFiles.forgetRecent(props.directory, item)
                }}
              >
                {language.t("sidebar.tree.recentClear")}
              </button>
            </Show>
          </div>
          <Show when={showRecent()}>
            <Show
              when={recent().length > 0}
              fallback={
                <div class="px-6 pb-2 text-ui-xs text-foreground-subtle">{language.t("sidebar.tree.recentEmpty")}</div>
              }
            >
              <div class="pb-1">
                <For each={recent().slice(0, 10)}>
                  {(recentPath) => (
                    <button
                      type="button"
                      data-action="sidebar-recent-open"
                      data-path={recentPath}
                      class="flex w-full items-center gap-1.5 px-6 py-0.5 text-left text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                      title={recentPath}
                      onClick={() => openFile(recentPath, "file")}
                    >
                      <FileIcon node={{ path: recentPath, type: "file" }} class="size-3.5 shrink-0" />
                      <span class="min-w-0 truncate">{recentPath}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </Show>
      <div class="flex h-7 shrink-0 items-center gap-2 border-b border-border px-2 text-ui-caption text-foreground-subtle">
        <span class="flex-1 truncate">{language.t("sidebar.tree.changed")}</span>
        <span class="shrink-0 text-ui-xs text-foreground-subtlest">
          {language.t("sidebar.tree.changes", { count: files.changedFiles().length })}
        </span>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto no-scrollbar py-1">
        <Show
          when={files.changedEntries().length > 0}
          fallback={
            <div class="px-3 py-4 text-ui-xs text-foreground-subtle">
              {!props.directory ? language.t("sidebar.tree.empty") : language.t("sidebar.tree.noChanges")}
            </div>
          }
        >
          <For each={files.changedEntries()}>
            {(entry) => {
              const status = () => files.statusByPath().get(entry.path)
              return (
                <button
                  type="button"
                  data-action="sidebar-change-open"
                  data-path={entry.path}
                  class="flex w-full items-center gap-1.5 rounded-md py-0.5 pl-2 pr-2 text-left text-ui-caption text-foreground transition-colors hover:bg-hover"
                  title={entry.path}
                  onClick={() => openFile(entry.path, "diff")}
                >
                  <FileIcon
                    node={{ path: entry.path, type: "file" }}
                    class="size-4 shrink-0 text-foreground-subtlest"
                  />
                  <span class="min-w-0 flex-1 truncate">{entry.name}</span>
                  <Show when={status()}>
                    <span class="shrink-0 text-ui-xs font-semibold" style={files.statusColor(status()!)}>
                      {files.statusLabel(status()!)}
                    </span>
                  </Show>
                </button>
              )
            }}
          </For>
        </Show>
      </div>
    </div>
  )
}
