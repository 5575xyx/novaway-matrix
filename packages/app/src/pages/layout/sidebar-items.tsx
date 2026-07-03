import type { Session } from "@opencode-ai/sdk/v2/client"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { getFilename } from "@opencode-ai/core/util/path"
import { A, useNavigate, useParams } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { type Accessor, createMemo, createSignal, For, type JSX, Match, Show, Switch } from "solid-js"
import { produce } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { getAvatarColors, type LocalProject, useLayout } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { messageAgentColor } from "@/utils/agent"
import { sessionTitle } from "@/utils/session-title"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"
import { childSessionOnPath, hasProjectPermissions } from "./helpers"

const OPENCODE_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

export function getProjectAvatarSource(id?: string, icon?: { color?: string; url?: string; override?: string }) {
  if (id === OPENCODE_PROJECT_ID) return "https://opencode.ai/favicon.svg"
  if (icon?.override) return icon?.override
  if (icon?.color) return undefined
  return icon?.url
}

export const ProjectIcon = (props: {
  project: LocalProject
  class?: string
  notify?: boolean
  working?: boolean
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const notification = useNotification()
  const permission = usePermission()
  const dirs = createMemo(() => [props.project.worktree, ...(props.project.sandboxes ?? [])])
  const unseenCount = createMemo(() =>
    dirs().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  const hasError = createMemo(() => dirs().some((directory) => notification.session.unseenHasError(directory)))
  const hasPermissions = createMemo(() =>
    dirs().some((directory) => {
      const [store] = globalSync.child(directory, { bootstrap: false })
      return hasProjectPermissions(store.permission, (item) => !permission.autoResponds(item, directory))
    }),
  )
  const notify = createMemo(() => props.notify && (hasPermissions() || unseenCount() > 0))
  const name = createMemo(() => props.project.name || getFilename(props.project.worktree))
  const avatarSource = createMemo(() => getProjectAvatarSource(props.project.id, props.project.icon))
  const avatarColors = createMemo(() => getAvatarColors(props.project.icon?.color))

  return (
    <div class={`relative size-8 shrink-0 rounded ${props.class ?? ""}`}>
      <div class="size-full rounded overflow-clip">
        <Show
          when={avatarSource()}
          fallback={
            <div
              class="project-icon-default size-full rounded grid place-items-center border border-white/30 text-[15px]"
              classList={{ "badge-mask": notify() }}
              style={{
                background: avatarColors().background,
                color: avatarColors().foreground,
              }}
            >
              <Icon name="folder" size="small" />
            </div>
          }
        >
          {(src) => (
            <Avatar
              fallback={name()}
              src={src()}
              {...avatarColors()}
              class="size-full rounded"
              classList={{ "badge-mask": notify() }}
            />
          )}
        </Show>
      </div>
      <Show when={notify()}>
        <div
          classList={{
            "absolute top-px right-px size-1.5 rounded-full z-10": true,
            "bg-surface-warning-strong": hasPermissions(),
            "bg-icon-critical-base": !hasPermissions() && hasError(),
            "bg-text-interactive-base": !hasPermissions() && !hasError(),
          }}
        />
      </Show>
      <Show when={props.working}>
        <div class="absolute bottom-px right-px size-3 rounded-full bg-background-base z-10 flex items-center justify-center">
          <div class="relative size-[9px] flex items-center justify-center">
            <div class="absolute inset-0 rounded-full border-[1px] border-text-interactive-base animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite] opacity-75" />
            <div class="size-[3px] rounded-full bg-text-interactive-base" />
          </div>
        </div>
      </Show>
    </div>
  )
}

export type SessionItemProps = {
  session: Session
  list: Session[]
  navList?: Accessor<Session[]>
  slug: string
  mobile?: boolean
  dense?: boolean
  showTooltip?: boolean
  showChild?: boolean
  level?: number
  sidebarExpanded: Accessor<boolean>
  clearHoverProjectSoon: () => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
  index?: number
}

export const SessionItem = (props: SessionItemProps): JSX.Element => {
  const params = useParams()
  const navigate = useNavigate()
  const layout = useLayout()
  const language = useLanguage()
  const notification = useNotification()
  const permission = usePermission()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const unseenCount = createMemo(() => notification.session.unseenCount(props.session.id))
  const hasError = createMemo(() => notification.session.unseenHasError(props.session.id))
  const [sessionStore, setSessionStore] = globalSync.child(props.session.directory)
  const hasPermissions = createMemo(() => {
    return !!sessionPermissionRequest(sessionStore.session, sessionStore.permission, props.session.id, (item) => {
      return !permission.autoResponds(item, props.session.directory)
    })
  })
  const isWorking = createMemo(() => {
    if (hasPermissions()) return false
    return sessionStore.session_working(props.session.id)
  })

  const tint = createMemo(() => messageAgentColor(sessionStore.message[props.session.id], sessionStore.agent))
  const tooltip = createMemo(() => props.showTooltip ?? (props.mobile || !props.sidebarExpanded()))
  const currentChild = createMemo(() => {
    if (!props.showChild) return
    return childSessionOnPath(sessionStore.session, props.session.id, params.id)
  })

  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  let inputRef: HTMLInputElement | undefined

  const titleText = () => sessionTitle(props.session.title)

  const completionTime = createMemo(() => {
    const updated = props.session.time?.updated
    if (!updated) return ""
    const date = new Date(updated)
    const now = new Date()
    const hours = date.getHours().toString().padStart(2, "0")
    const minutes = date.getMinutes().toString().padStart(2, "0")
    const seconds = date.getSeconds().toString().padStart(2, "0")
    const time = `${hours}:${minutes}:${seconds}`
    const dayMs = 86400000
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const diff = todayStart - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    if (diff < 0) return time
    if (diff < dayMs) return time
    if (diff < dayMs * 2) return `昨天 ${time}`
    if (diff < dayMs * 3) return `前天 ${time}`
    const month = (date.getMonth() + 1).toString().padStart(2, "0")
    const day = date.getDate().toString().padStart(2, "0")
    if (date.getFullYear() === now.getFullYear()) return `${month}-${day} ${time}`
    return `${date.getFullYear()}-${month}-${day} ${time}`
  })

  const openTitleEditor = () => {
    setDraft(titleText() ?? "")
    setEditing(true)
    requestAnimationFrame(() => {
      inputRef?.focus()
      inputRef?.select()
    })
  }

  const cancelEditing = () => {
    setEditing(false)
    setDraft("")
  }

  const saveTitle = async () => {
    if (saving()) return
    const next = draft().trim()
    if (!next || next === titleText()) {
      cancelEditing()
      return
    }
    setSaving(true)
    try {
      await globalSDK.client.session.update({ sessionID: props.session.id, title: next })
      setSessionStore(
        "session",
        produce((draft) => {
          for (const item of draft) {
            if (item.id === props.session.id) {
              item.title = next
              break
            }
          }
        }),
      )
      setEditing(false)
    } catch {
      // ignore
    }
    setSaving(false)
  }

  const warm = (span: number, priority: "high" | "low") => {
    const nav = props.navList?.()
    const list = nav?.some((item) => item.id === props.session.id && item.directory === props.session.directory)
      ? nav
      : props.list

    props.prefetchSession(props.session, priority)

    const idx = list.findIndex((item) => item.id === props.session.id && item.directory === props.session.directory)
    if (idx === -1) return

    for (let step = 1; step <= span; step++) {
      const next = list[idx + step]
      if (next) props.prefetchSession(next, step === 1 ? "high" : priority)

      const prev = list[idx - step]
      if (prev) props.prefetchSession(prev, step === 1 ? "high" : priority)
    }
  }

  return (
    <>
      <div
        data-session-id={props.session.id}
        classList={{
          "group/session relative w-full flex flex-col rounded-lg border-solid transition-colors hover:bg-surface-raised-base-hover py-2": true,
          "border-2 border-border-interactive-base": params.id === props.session.id,
          "border border-border-weak-base": params.id !== props.session.id,
        }}
      >
        <A
          href={`/${props.slug}/session/${props.session.id}`}
          class="flex flex-col gap-0.5 min-w-0 w-full text-left focus:outline-none px-2"
          onPointerDown={() => warm(2, "high")}
          onFocus={() => warm(2, "high")}
          onClick={() => {
            if (layout.sidebar.opened()) return
            props.clearHoverProjectSoon()
          }}
        >
          <div class="flex items-center gap-2">
            <Show when={props.index !== undefined}>
              <span class="shrink-0 text-11-regular text-text-weak w-4 text-right">{(props.index ?? 0) + 1}.</span>
            </Show>
            <Show when={isWorking() || hasPermissions() || hasError() || unseenCount() > 0}>
              <div
                class="shrink-0 size-6 flex items-center justify-center"
                style={{ color: tint() ?? "var(--icon-interactive-base)" }}
              >
                <Switch>
                  <Match when={isWorking()}>
                    <div class="relative size-[15px] flex items-center justify-center">
                      <div class="absolute inset-0 rounded-full border-[1.5px] border-text-interactive-base animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite] opacity-75" />
                      <div class="size-1.5 rounded-full bg-text-interactive-base" />
                    </div>
                  </Match>
                  <Match when={hasPermissions()}>
                    <div class="size-1.5 rounded-full bg-surface-warning-strong" />
                  </Match>
                  <Match when={hasError()}>
                    <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
                  </Match>
                  <Match when={unseenCount() > 0}>
                    <div class="size-1.5 rounded-full bg-text-interactive-base" />
                  </Match>
                </Switch>
              </div>
            </Show>
            <Show
              when={editing()}
              fallback={
                <span class="text-13-medium text-text-strong min-w-0 flex-1 truncate">{titleText()}</span>
              }
            >
              <input
                ref={(el) => {
                  inputRef = el
                }}
                type="text"
                value={draft()}
                disabled={saving()}
                placeholder="Enter 保存"
                class="text-14-medium text-text-strong min-w-0 flex-1 rounded-[6px] px-1 -ml-1 border border-text-interactive-base outline-none bg-background-base placeholder:text-text-weak"
                onInput={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void saveTitle()
                    return
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    cancelEditing()
                  }
                }}
                onBlur={cancelEditing}
              />
            </Show>
          </div>
          <Show when={completionTime()}>
            <span class="text-11-regular text-text-weak pl-6">任务完成 · {completionTime()}</span>
          </Show>
        </A>
        <Show when={!props.level}>
          <div class="absolute top-1 right-1 z-10">
            <DropdownMenu gutter={4} placement="bottom-start">
              <DropdownMenu.Trigger
                as={IconButton}
                icon="dot-grid"
                variant="ghost"
                class="size-6 rounded-md opacity-0 group-hover/session:opacity-100 pointer-events-none group-hover/session:pointer-events-auto transition-opacity"
                aria-label={language.t("common.moreOptions")}
              />
              <DropdownMenu.Portal>
                <DropdownMenu.Content style={{ "min-width": "104px" }}>
                  <DropdownMenu.Item onSelect={openTitleEditor}>
                    <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => void props.archiveSession(props.session)}>
                    <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={props.session.id} title={titleText() ?? ""} directory={props.session.directory} />)}>
                    <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </div>
        </Show>
      </div>
      <Show when={currentChild()} keyed>
        {(child) => (
          <div class="w-full" style={{ "padding-left": `${((props.level ?? 0) + 1) * 16}px` }}>
            <SessionItem {...props} session={child} level={(props.level ?? 0) + 1} />
          </div>
        )}
      </Show>
    </>
  )
}

function DialogDeleteSession(props: { sessionID: string; title: string; directory: string }) {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const dialog = useDialog()
  const navigate = useNavigate()
  const params = useParams()
  const [sessionStore, setSessionStore] = globalSync.child(props.directory)
  const removeFromStore = () => {
    const removed = new Set<string>([props.sessionID])
    const byParent = new Map<string, string[]>()
    const sessions = sessionStore.session ?? []
    for (const item of sessions) {
      const parentID = item.parentID
      if (!parentID) continue
      const existing = byParent.get(parentID)
      if (existing) {
        existing.push(item.id)
        continue
      }
      byParent.set(parentID, [item.id])
    }
    const stack = [props.sessionID]
    while (stack.length) {
      const parentID = stack.pop()
      if (!parentID) continue
      const children = byParent.get(parentID)
      if (!children) continue
      for (const child of children) {
        if (removed.has(child)) continue
        removed.add(child)
        stack.push(child)
      }
    }
    setSessionStore(
      "session",
      produce((draft) => {
        for (let i = draft.length - 1; i >= 0; i--) {
          if (removed.has(draft[i].id)) {
            draft.splice(i, 1)
          }
        }
      }),
    )
  }

  const handleDelete = async () => {
    const isCurrentSession = params.id === props.sessionID
    try {
      await globalSDK.client.session.delete({ sessionID: props.sessionID })
    } catch {
      // ignore — session may already be deleted server-side
    }
    removeFromStore()
    dialog.close()
    if (isCurrentSession) {
      const slug = base64Encode(props.directory)
      navigate(`/${slug}/session`)
    }
  }

  return (
    <Dialog title={language.t("session.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {language.t("session.delete.confirm", { name: props.title })}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" onClick={() => void handleDelete()}>
            {language.t("session.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export const NewSessionItem = (props: {
  slug: string
  mobile?: boolean
  dense?: boolean
  sidebarExpanded: Accessor<boolean>
  clearHoverProjectSoon: () => void
}): JSX.Element => {
  const layout = useLayout()
  const language = useLanguage()
  const label = language.t("command.session.new")
  const tooltip = () => props.mobile || !props.sidebarExpanded()
  const item = (
    <A
      href={`/${props.slug}/session`}
      end
      class={`flex items-center gap-2 min-w-0 w-full text-left focus:outline-none ${props.dense ? "py-0.5" : "py-1"}`}
      onClick={() => {
        if (layout.sidebar.opened()) return
        props.clearHoverProjectSoon()
      }}
    >
      <div class="shrink-0 size-6 flex items-center justify-center">
        <Icon name="new-session" size="small" class="text-icon-weak" />
      </div>
      <span class="text-14-regular text-text-strong min-w-0 flex-1 truncate">{label}</span>
    </A>
  )

  return (
    <div class="group/session relative w-full min-w-0 rounded-md cursor-default transition-colors pl-2 pr-3 hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[.active]:border has-[.active]:border-solid has-[.active]:border-text-interactive-base">
      <Show
        when={!tooltip()}
        fallback={
          <Tooltip placement={props.mobile ? "bottom" : "right"} value={label} gutter={10} class="min-w-0 w-full">
            {item}
          </Tooltip>
        }
      >
        {item}
      </Show>
    </div>
  )
}

export const SessionSkeleton = (props: { count?: number }): JSX.Element => {
  const items = Array.from({ length: props.count ?? 4 }, (_, index) => index)
  return (
    <div class="flex flex-col gap-1">
      <For each={items}>
        {() => <div class="h-8 w-full rounded-md bg-surface-raised-base opacity-60 animate-pulse" />}
      </For>
    </div>
  )
}
