import { Show, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { Button } from "@novaway/ui/button"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Select } from "@novaway/ui/select"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { useModels } from "@/context/models"
import { useSettings } from "@/context/settings"
import { useSessionLayout } from "@/pages/session/session-layout"
import { decode64 } from "@/utils/base64"
import { isDefaultSessionTitle } from "@/utils/session-title"

export function WorkspaceHeader() {
  const params = useParams()
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const modelsCtx = useModels()
  const local = useLocal()
  const sessionLayout = useSessionLayout()
  const settings = useSettings()
  const directory = createMemo(() => decode64(params.dir) ?? "")
  const sessionStore = createMemo(() => (directory() ? globalSync.child(directory())[0] : undefined))
  const session = createMemo(() => sessionStore()?.session.find((s) => s.id === params.id))
  const variants = createMemo(() => ["default", ...local.model.variant.list()])
  const working = createMemo(() => {
    const id = session()?.id
    const store = sessionStore()
    return id && store ? store.session_working(id) : false
  })
  const dirName = createMemo(() => directory().split(/[\\/]/).filter(Boolean).pop() ?? directory())
  const branch = createMemo(() => sessionStore()?.vcs?.branch ?? "")

  return (
    <div
      data-component="workspace-header"
      class="flex items-center gap-2 h-10 px-3 border-b border-border-weak-base shrink-0 select-none"
    >
      <Show when={working()}>
        <span class="size-2 rounded-full bg-[var(--border-success-selected)] animate-pulse shrink-0" />
      </Show>
      <span class="text-ui-base font-semibold text-text-strong truncate max-w-[240px]">
        {session()?.title && !isDefaultSessionTitle(session()?.title) ? session()?.title : language.t("workspace.header.untitled")}
      </span>
      <span class="text-ui-xs text-text-weak truncate max-w-[180px] hidden md:block border border-border-weak-base rounded-md px-1.5 py-0.5">
        {branch() ? language.t("workspace.header.projectBranch", { project: dirName(), branch: branch() }) : dirName()}
      </span>
      <Show when={modelsCtx.autoMode() || local.model.current()}>
        <div data-component="workspace-model" class="min-w-0">
          <ModelSelectorPopover
            model={local.model}
            triggerAs={Button}
            triggerProps={{
              variant: "ghost",
              size: "normal",
              class: "text-ui-caption text-text-strong max-w-[150px] min-w-0 truncate",
            }}
          >
            <span class="truncate">
              {modelsCtx.autoMode() ? "Auto" : (local.model.current()?.name ?? language.t("dialog.model.select.title"))}
            </span>
            <Icon name="chevron-down" size="small" class="shrink-0" />
          </ModelSelectorPopover>
        </div>
      </Show>
      <Show when={!modelsCtx.autoMode() && variants().length > 2}>
        <Select
          size="small"
          options={variants()}
          current={local.model.variant.current() ?? "default"}
          label={(x) => language.t("workspace.header.variant." + x)}
          onSelect={(value) => local.model.variant.set(value === "default" ? undefined : value)}
          variant="ghost"
          class="text-ui-caption max-w-[120px]"
        />
      </Show>
      <div class="flex-1" />
      <Show when={settings.general.showTerminal()}>
        <IconButton
          icon="terminal"
          title={language.t("workspace.header.terminal")}
          variant="ghost"
          aria-expanded={sessionLayout.view().terminal.opened()}
          onClick={() => sessionLayout.view().terminal.toggle()}
          class={sessionLayout.view().terminal.opened() ? "text-text-interactive-base" : ""}
        />
      </Show>
      <IconButton
        icon="layout-right"
        title={language.t("workspace.header.sidePane")}
        variant="ghost"
        aria-expanded={layout.sidePane.opened()}
        onClick={() => layout.sidePane.toggle()}
        class={layout.sidePane.opened() ? "text-text-interactive-base" : ""}
      />
      <DropdownMenu>
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          aria-label={language.t("workspace.header.more")}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <Show when={settings.general.showFileTree()}>
              <DropdownMenu.Item onSelect={() => layout.sidePane.toggle("files")}>
                <DropdownMenu.ItemLabel>{language.t("command.fileTree.toggle")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </Show>
            <DropdownMenu.Item onSelect={() => layout.sidePane.toggle("git")}>
              <DropdownMenu.ItemLabel>{language.t("command.git.toggle")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              onSelect={() => {
                void navigator.clipboard.writeText(directory())
              }}
            >
              <DropdownMenu.ItemLabel>{language.t("workspace.header.copyPath")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => {
                void navigator.clipboard.writeText(session()?.title ?? directory())
              }}
            >
              <DropdownMenu.ItemLabel>{language.t("workspace.header.copyTitle")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}