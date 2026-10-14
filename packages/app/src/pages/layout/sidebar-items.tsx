import type { Session } from "@novaway/sdk/v2/client"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { IconButton } from "@novaway/ui/icon-button"
import { A, useNavigate, useParams } from "@solidjs/router"
import { base64Encode } from "@novaway/core/util/encode"
import { type Accessor, createMemo, createSignal, type JSX, Match, Show, Switch } from "solid-js"
import { produce } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { messageAgentColor } from "@/utils/agent"
import { displaySessionTitle } from "@/utils/session-title"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"
import { childSessionOnPath } from "./helpers"

const NovaWay_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

export function getProjectAvatarSource(id?: string, icon?: { color?: string; url?: string; override?: string }) {
  if (id === NovaWay_PROJECT_ID) return "https://NovaWay.ai/favicon.svg"
  if (icon?.override) return icon?.override
  if (icon?.color) return undefined
  return icon?.url
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
  const selected = createMemo(() => params.id === props.session.id)

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

  const titleText = () => displaySessionTitle(props.session.title, language.t("workspace.header.untitled"))

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
          "group/session relative w-full flex flex-col rounded-lg border-solid transition-colors hover:bg-hover py-2": true,
          "border-2 border-primary": selected(),
          "border border-border": !selected(),
          "before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-[var(--novaway-mode-color,var(--border-hover))]":
            selected(),
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
              <span class="shrink-0 text-11-regular text-foreground-subtle w-4 text-right">{(props.index ?? 0) + 1}.</span>
            </Show>
            <Show when={isWorking() || hasPermissions() || hasError() || unseenCount() > 0}>
              <div
                class="shrink-0 size-6 flex items-center justify-center"
                style={{ color: tint() ?? "var(--icon-blue)" }}
              >
                <Switch>
                  <Match when={isWorking()}>
                    <div class="relative size-[15px] flex items-center justify-center">
                      <div class="absolute inset-0 rounded-full border-[1.5px] border-icon-blue animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite] opacity-75" />
                      <div class="size-1.5 rounded-full bg-icon-blue" />
                    </div>
                  </Match>
                  <Match when={hasPermissions()}>
                    <div class="size-1.5 rounded-full bg-warning" />
                  </Match>
                  <Match when={hasError()}>
                    <div class="size-1.5 rounded-full bg-diff-removed" />
                  </Match>
                  <Match when={unseenCount() > 0}>
                    <div class="size-1.5 rounded-full bg-icon-blue" />
                  </Match>
                </Switch>
              </div>
            </Show>
            <Show
              when={editing()}
              fallback={<span class="text-13-medium text-foreground min-w-0 flex-1 truncate">{titleText()}</span>}
            >
              <input
                ref={(el) => {
                  inputRef = el
                }}
                type="text"
                value={draft()}
                disabled={saving()}
                placeholder="Enter 保存"
                class="text-14-medium text-foreground min-w-0 flex-1 rounded-[6px] px-1 -ml-1 border border-icon-blue outline-none bg-background placeholder:text-foreground-subtle"
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
            <span class="text-11-regular text-foreground-subtle pl-6">任务完成 · {completionTime()}</span>
          </Show>
          <Show when={sessionStore.vcs?.branch}>
            <span class="text-ui-xs text-foreground-subtle shrink-0 max-w-[120px] truncate">⎇ {sessionStore.vcs?.branch}</span>
          </Show>
          <Show
            when={props.session.summary && (props.session.summary.additions > 0 || props.session.summary.deletions > 0)}
          >
            <span class="text-ui-xs tabular-nums shrink-0">
              <span class="text-[var(--diff-added)]">+{props.session.summary?.additions ?? 0}</span>
              <span class="text-[var(--diff-removed)]">-{props.session.summary?.deletions ?? 0}</span>
            </span>
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
                  <DropdownMenu.Item
                    onSelect={() =>
                      dialog.show(() => (
                        <DialogDeleteSession
                          sessionID={props.session.id}
                          title={titleText() ?? ""}
                          directory={props.session.directory}
                        />
                      ))
                    }
                  >
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
          <span class="text-14-regular text-foreground">
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

