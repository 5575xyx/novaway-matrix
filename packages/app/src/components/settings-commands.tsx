import type { Command } from "@novaway/sdk/v2/client"
import { Button } from "@novaway/ui/button"
import { useDialog } from "@novaway/ui/context/dialog"
import { Dialog } from "@novaway/ui/dialog"
import { IconButton } from "@novaway/ui/icon-button"
import { Tag } from "@novaway/ui/tag"
import { TextField } from "@novaway/ui/text-field"
import { showToast } from "@novaway/ui/toast"
import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { AppIcon } from "./app-icon"
import { rowAccent, SettingsGroup } from "./settings-parts"

type CommandSource = "config" | "markdown" | "builtin"

const sourceOf = (command: Command): CommandSource => {
  if (command.source === "mcp" || command.source === "skill") return "builtin"
  return command.source === "command" ? "markdown" : "config"
}

const sourceLabel = (language: ReturnType<typeof useLanguage>, source: CommandSource) =>
  language.t(
    source === "config"
      ? ("settings.commands.source.config" as never)
      : source === "markdown"
        ? ("settings.commands.source.markdown" as never)
        : ("settings.commands.source.builtin" as never),
  )

/**
 * 命令（斜杠命令）设置页。
 *
 * 对齐 ZCode 的 Commands 区：列出当前可用的 /命令，并能新增/编辑/删除
 * 写在配置里的命令。磁盘上的 .novaway/command/*.md 命令也一并列出，
 * 但只读 —— 它们由文件本身管理，在 UI 里改会被下一次扫描覆盖。
 */
export const SettingsCommands: Component<{ directory?: string }> = (props) => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const dialog = useDialog()

  // 设置面板挂在主布局里，没有目录级的 Sync/Data Provider，
  // 所以命令列表直接用全局 SDK 按当前目录取（与记忆页同一套做法）。
  const client = createMemo(() => {
    const directory = props.directory
    if (!directory) return globalSDK.client
    return globalSDK.createClient({ directory, throwOnError: true })
  })

  const commands = useQuery(() => ({
    queryKey: ["settings", "commands", props.directory ?? ""],
    queryFn: () =>
      client()
        .command.list()
        .then((response) => response.data ?? []),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  }))

  const configured = createMemo(() => {
    const value = globalSync.data.config.command
    return value && typeof value === "object" ? (value as Record<string, Record<string, unknown>>) : {}
  })

  const list = createMemo(() =>
    (commands.data ?? [])
      .map((command) => ({ command, source: sourceOf(command) }))
      .sort((a, b) => a.command.name.localeCompare(b.command.name)),
  )

  const save = async (name: string, value: Record<string, unknown> | undefined) => {
    await globalSync.updateConfig({ command: { ...configured(), [name]: value } } as never)
  }

  const remove = async (name: string) => {
    await save(name, undefined)
  }

  const addCommand = () => {
    dialog.show(() => (
      <CommandDialog
        title={language.t("settings.commands.action.add" as never)}
        onSave={(name, template, description) => save(name, { template, ...(description ? { description } : {}) })}
      />
    ))
  }

  const editCommand = (name: string) => {
    const value = configured()[name] ?? {}
    dialog.show(() => (
      <CommandDialog
        title={language.t("settings.management.action.edit" as never)}
        initialName={name}
        initialTemplate={typeof value.template === "string" ? value.template : ""}
        initialDescription={typeof value.description === "string" ? value.description : ""}
        lockName
        onSave={(_name, template, description) =>
          save(name, { ...value, template, description: description || undefined })
        }
      />
    ))
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--popover)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 w-full">
          <h2 class="text-16-medium text-foreground">{language.t("settings.commands.title" as never)}</h2>
          <p class="text-13-regular text-foreground-subtle">{language.t("settings.commands.description" as never)}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <div>
          <div class="flex flex-wrap items-center gap-2 pb-3">
            <Button variant="secondary" icon="plus-small" onClick={addCommand}>
              {language.t("settings.commands.action.add" as never)}
            </Button>
          </div>
          <SettingsGroup>
            <Show
              when={list().length > 0}
              fallback={
                <div class="px-4 py-6 text-center text-13-regular text-foreground-subtle">
                  {language.t("settings.commands.empty" as never)}
                </div>
              }
            >
              <For each={list()}>
                {(item) => {
                  // 每条命令一个稳定色：图标块、标题前的色点都读它，
                  // 一屏几十个 /命令 时靠颜色分组更快。
                  const accent = rowAccent(item.command.name)
                  return (
                    <div class="flex min-w-0 items-center gap-3 border-t border-border px-4 py-3 transition-colors first:border-t-0 hover:bg-hover">
                      <AppIcon seed={item.command.name} glyph="console" />
                      <div class="flex min-w-0 flex-1 flex-col">
                        <div class="flex min-w-0 flex-wrap items-center gap-2">
                          <span class="size-1.5 shrink-0 rounded-full" style={{ background: accent }} />
                          <span class="truncate text-13-medium text-foreground">{"/" + item.command.name}</span>
                          <Tag>{sourceLabel(language, item.source)}</Tag>
                        </div>
                        <span class="mt-0.5 truncate text-12-regular text-foreground-subtle">
                          {item.command.description || item.command.template}
                        </span>
                      </div>
                      <Show when={item.source === "config"}>
                        <div class="flex shrink-0 items-center gap-1">
                          <IconButton
                            icon="edit"
                            variant="ghost"
                            onClick={() => editCommand(item.command.name)}
                            aria-label={language.t("settings.management.action.edit" as never)}
                          />
                          <IconButton
                            icon="trash"
                            variant="ghost"
                            onClick={() => void remove(item.command.name)}
                            aria-label={language.t("settings.management.action.delete" as never)}
                          />
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </Show>
          </SettingsGroup>
        </div>
      </div>
    </div>
  )
}

const CommandDialog: Component<{
  title: string
  initialName?: string
  initialTemplate?: string
  initialDescription?: string
  lockName?: boolean
  onSave: (name: string, template: string, description: string) => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [name, setName] = createSignal(props.initialName ?? "")
  const [description, setDescription] = createSignal(props.initialDescription ?? "")
  const [template, setTemplate] = createSignal(props.initialTemplate ?? "")
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  const submit = async (event: Event) => {
    event.preventDefault()
    if (saving()) return
    const nextName = name().trim()
    if (!nextName) {
      setError(language.t("settings.commands.field.nameRequired" as never))
      return
    }
    if (!template().trim()) {
      setError(language.t("settings.commands.field.templateRequired" as never))
      return
    }
    setSaving(true)
    try {
      await props.onSave(nextName, template().trim(), description().trim())
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title" as never),
        description: language.t("settings.management.toast.saved.description" as never),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),640px)]"
      // 动作按钮固定在弹窗右下角：表单再长滚动的也只是字段，取消/保存永远可见。
      // 保存按钮用 `form` 关联到正文里的表单，回车提交的行为保持不变。
      footer={
        <>
          <Button type="button" variant="secondary" disabled={saving()} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" form="settings-command-form" icon="check" disabled={saving()}>
            {language.t("settings.management.action.save" as never)}
          </Button>
        </>
      }
    >
      <form id="settings-command-form" class="flex flex-col gap-4 px-2.5 pb-3" onSubmit={(event) => void submit(event)}>
        <TextField
          label={language.t("settings.management.field.name" as never)}
          value={name()}
          onChange={setName}
          disabled={props.lockName || saving()}
          placeholder="example"
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <TextField
          label={language.t("settings.commands.field.description" as never)}
          value={description()}
          onChange={setDescription}
          disabled={saving()}
        />
        <TextField
          label={language.t("settings.commands.field.template" as never)}
          multiline
          value={template()}
          onChange={setTemplate}
          class="font-mono min-h-40"
          error={error()}
          disabled={saving()}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
      </form>
    </Dialog>
  )
}
