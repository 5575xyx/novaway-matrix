import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { Button } from "@novaway/ui/button"
import { useLanguage } from "@/context/language"
import { num, type Change, useGitSnapshot } from "./git-panel"

type Node = { name: string; path: string; directory: boolean; children: Node[]; change?: Change }

function treeOf(changes: Change[]): Node[] {
  const root: Node = { name: "", path: "", directory: true, children: [] }
  for (const change of changes) {
    const parts = change.file.split(/[\\/]/).filter(Boolean)
    let parent = root
    let path = ""
    parts.forEach((name, index) => {
      path = path ? path + "/" + name : name
      let child = parent.children.find((item) => item.name === name)
      if (!child) {
        child = { name, path, directory: index < parts.length - 1, children: [] }
        parent.children.push(child)
      }
      if (index === parts.length - 1) child.change = change
      parent = child
    })
  }
  const sort = (items: Node[]) => {
    items.sort((a, b) => (a.directory !== b.directory ? (a.directory ? -1 : 1) : a.name.localeCompare(b.name)))
    items.forEach((item) => sort(item.children))
  }
  sort(root.children)
  return root.children
}

function fileCount(node: Node): number {
  return node.children.reduce((sum, child) => sum + (child.directory ? fileCount(child) : 1), 0)
}

function tone(change: Change) {
  if (change.status === "added" || change.status === "untracked") return "text-success-base"
  if (change.status === "deleted" || change.status === "unmerged") return "text-critical-base"
  return change.status === "renamed" ? "text-interactive-base" : "text-warning-base"
}

type ChangeTreeProps = {
  nodes: Node[]
  depth?: number
  open: (file: string) => void
  stage: (change: Change) => void
  discard: (change: Change) => void
  collapsed: (path: string) => boolean
  toggle: (path: string) => void
}

function ChangeTree(props: ChangeTreeProps) {
  const language = useLanguage()
  const depth = () => props.depth ?? 0
  return (
    <For each={props.nodes}>
      {(node) => (
        <Show
          when={node.directory}
          fallback={
            <div
              class="source-control-file group flex min-h-7 items-center gap-1 rounded-md px-1.5 text-ui-sm hover:bg-hover"
              style={{ "padding-left": 8 + depth() * 14 + "px" }}
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                title={node.path}
                onClick={() => props.open(node.path)}
              >
                <Icon name="file-tree" size="small" class={"shrink-0 " + tone(node.change!)} />
                <span class="min-w-0 flex-1 truncate">{node.name}</span>
              </button>
              <span class={"font-mono text-ui-xs " + tone(node.change!)}>
                {node.change!.code || (node.change!.status === "untracked" ? "U" : "M")}
              </span>
              <span class="source-control-stat font-mono text-ui-xs tabular-nums text-foreground-subtle">
                <Show when={num(node.change!.additions) > 0}>+{num(node.change!.additions)}</Show>
                <Show when={num(node.change!.deletions) > 0}> -{num(node.change!.deletions)}</Show>
              </span>
              <button
                type="button"
                class="source-control-row-action rounded p-1 text-foreground-subtlest hover:bg-surface"
                title={node.change!.staged ? language.t("git.unstage") : language.t("git.stage")}
                onClick={() => props.stage(node.change!)}
              >
                <Icon name={node.change!.staged ? "check" : "plus-small"} size="small" />
              </button>
              <button
                type="button"
                class="source-control-row-action rounded p-1 text-foreground-subtlest hover:bg-surface hover:text-critical-base"
                title={language.t("git.discard")}
                onClick={() => props.discard(node.change!)}
              >
                <Icon name="close-small" size="small" />
              </button>
            </div>
          }
        >
          <button
            type="button"
            class="flex w-full min-h-7 items-center gap-1 rounded-md px-1.5 text-left text-ui-sm text-foreground-subtle hover:bg-hover"
            style={{ "padding-left": 8 + depth() * 14 + "px" }}
            onClick={() => props.toggle(node.path)}
          >
            <Icon name={props.collapsed(node.path) ? "chevron-right" : "chevron-down"} size="small" />
            <Icon name="folder" size="small" />
            <span class="min-w-0 flex-1 truncate">{node.name}</span>
            <span class="font-mono text-ui-xs">{fileCount(node)}</span>
          </button>
          <Show when={!props.collapsed(node.path)}>
            <ChangeTree
              nodes={node.children}
              depth={depth() + 1}
              open={props.open}
              stage={props.stage}
              discard={props.discard}
              collapsed={props.collapsed}
              toggle={props.toggle}
            />
          </Show>
        </Show>
      )}
    </For>
  )
}

export function GitSourceControlPanel(props: { onOpenFile: (file: string) => void; onBack?: () => void }): JSX.Element {
  const language = useLanguage()
  const git = useGitSnapshot()
  const [message, setMessage] = createSignal("")
  const [query, setQuery] = createSignal("")
  const [collapsed, setCollapsed] = createSignal(new Set<string>())
  const changes = createMemo(() => git.snapshot()?.changes ?? [])
  const visibleChanges = createMemo(() => {
    const value = query().trim().toLowerCase()
    return value ? changes().filter((item) => item.file.toLowerCase().includes(value)) : changes()
  })
  const stagedChanges = createMemo(() => visibleChanges().filter((item) => item.staged))
  const unstagedChanges = createMemo(() => visibleChanges().filter((item) => item.unstaged))
  const unstaged = createMemo(() =>
    changes()
      .filter((item) => item.unstaged)
      .map((item) => item.file),
  )
  const staged = createMemo(() =>
    changes()
      .filter((item) => item.staged)
      .map((item) => item.file),
  )
  const add = createMemo(() => changes().reduce((sum, item) => sum + num(item.additions), 0))
  const del = createMemo(() => changes().reduce((sum, item) => sum + num(item.deletions), 0))
  const stage = (change: Change) => void (change.staged ? git.unstage([change.file]) : git.stage([change.file]))
  const stageAll = () => void (unstaged().length ? git.stage(unstaged()) : git.unstage(staged()))
  const toggle = (path: string) =>
    setCollapsed((value) => {
      const next = new Set(value)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  const commit = () => {
    const text = message().trim()
    if (!text) return
    void git.commit(text).then((ok) => ok && setMessage(""))
  }

  const group = (title: string, items: Change[]) => (
    <Show when={items.length > 0}>
      <div class="mb-2">
        <div class="px-2 py-1 text-ui-xs font-medium text-foreground-subtle">
          {title} <span class="font-mono">{items.length}</span>
        </div>
        <ChangeTree
          nodes={treeOf(items)}
          open={props.onOpenFile}
          stage={stage}
          discard={(change) => void git.discard([change.file])}
          collapsed={(path) => collapsed().has(path)}
          toggle={toggle}
        />
      </div>
    </Show>
  )

  return (
    <div data-component="git-source-control" class="flex h-full min-h-0 flex-col bg-panel">
      <div class="flex h-10 shrink-0 items-center justify-between border-b border-border px-2">
        <div class="flex min-w-0 items-center gap-1">
          <Show when={props.onBack}>
            <button
              type="button"
              class="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-subtle hover:bg-hover hover:text-foreground"
              title={language.t("sidebar.tree.title")}
              aria-label={language.t("sidebar.tree.title")}
              onClick={() => props.onBack?.()}
            >
              <Icon name="chevron-left" size="small" />
            </button>
          </Show>
          <Icon name="branch" size="small" class="shrink-0 text-foreground-subtle" />
          <span class="truncate text-ui-base font-medium">{language.t("git.title")}</span>
        </div>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-foreground-subtle hover:bg-hover"
          title={language.t("git.refresh")}
          onClick={git.refresh}
        >
          <Icon name="refresh" size="small" />
        </button>
      </div>
      <Show
        when={!git.notARepo()}
        fallback={
          <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <Icon name="branch" size="large" />
            <div class="text-ui-sm text-foreground-subtle">{language.t("git.notARepo")}</div>
            <Button variant="primary" size="small" disabled={git.busy()} onClick={() => void git.initRepo()}>
              {language.t("git.init.action")}
            </Button>
          </div>
        }
      >
        <Show
          when={git.snapshot()}
          fallback={<div class="p-4 text-ui-sm text-foreground-subtle">{language.t("git.loading")}</div>}
        >
          {(snapshot) => (
            <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div class="shrink-0 border-b border-border px-3 py-2">
                <DropdownMenu>
                  <DropdownMenu.Trigger
                    as="button"
                    type="button"
                    class="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-ui-sm hover:bg-hover"
                  >
                    <Icon name="branch" size="small" />
                    <span class="min-w-0 flex-1 truncate font-mono">
                      {snapshot().branch.branch ?? language.t("git.noBranch")}
                    </span>
                    <Show when={num(snapshot().branch.ahead) > 0}>
                      <span class="font-mono text-ui-xs text-success-base">↑{num(snapshot().branch.ahead)}</span>
                    </Show>
                    <Show when={num(snapshot().branch.behind) > 0}>
                      <span class="font-mono text-ui-xs text-warning-base">↓{num(snapshot().branch.behind)}</span>
                    </Show>
                    <Icon name="chevron-down" size="small" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content class="mt-1" style={{ "min-width": "220px" }}>
                      <div class="px-2 py-1.5 text-ui-xs text-foreground-subtle">{language.t("git.branches")}</div>
                      <For each={snapshot().branches}>
                        {(branch) => (
                          <DropdownMenu.Item
                            disabled={branch.current}
                            onSelect={() => {
                              if (!branch.current) void git.checkout(branch.name)
                            }}
                          >
                            <div class="flex w-full items-center gap-2">
                              <Icon name={branch.current ? "check" : "branch"} size="small" />
                              <span class="min-w-0 flex-1 truncate font-mono">{branch.name}</span>
                              <Show when={branch.current}>
                                <span class="text-ui-xs text-foreground-subtle">
                                  {language.t("git.branch.manage.head")}
                                </span>
                              </Show>
                            </div>
                          </DropdownMenu.Item>
                        )}
                      </For>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
                <div class="mt-1 flex items-center gap-2 px-1 text-ui-xs text-foreground-subtle">
                  <Icon name="arrow-right" size="small" />
                  <span class="truncate">{snapshot().branch.upstream ?? language.t("git.noUpstream")}</span>
                  <Show when={num(snapshot().branch.ahead) > 0 || num(snapshot().branch.behind) > 0}>
                    <span class="ml-auto shrink-0 font-mono">
                      <Show when={num(snapshot().branch.ahead) > 0}>↑{num(snapshot().branch.ahead)}</Show>
                      <Show when={num(snapshot().branch.ahead) > 0 && num(snapshot().branch.behind) > 0}> </Show>
                      <Show when={num(snapshot().branch.behind) > 0}>↓{num(snapshot().branch.behind)}</Show>
                    </span>
                  </Show>
                </div>
              </div>
              <Show when={changes().length >= 1000}>
                <div class="mx-3 mt-2 rounded-lg border border-warning-base/40 bg-warning-base/10 px-3 py-2 text-ui-sm">
                  <div class="flex items-start gap-2">
                    <Icon name="warning" size="small" class="text-warning-base" />
                    <span>{language.t("git.tooManyChanges", { count: 1000 })}</span>
                  </div>
                  <div class="mt-2 flex justify-end gap-2">
                    <Button variant="secondary" size="small" disabled={git.busy()} onClick={stageAll}>
                      {language.t("git.stageAll")}
                    </Button>
                    <Button variant="secondary" size="small" disabled={git.busy()} onClick={git.refresh}>
                      {language.t("git.refresh")}
                    </Button>
                  </div>
                </div>
              </Show>
              <div class="shrink-0 border-b border-border px-3 py-2">
                <textarea
                  value={message()}
                  rows="2"
                  placeholder={language.t("git.commitPlaceholder")}
                  class="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-ui-sm outline-none placeholder:text-foreground-subtle focus:border-interactive-focus"
                  onInput={(event) => setMessage(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                      event.preventDefault()
                      commit()
                    }
                  }}
                />
                <div class="mt-2 flex items-center justify-between">
                  <span class="font-mono text-ui-xs tabular-nums">
                    <span class="text-success-base">+{add()}</span> <span class="text-critical-base">-{del()}</span>
                  </span>
                  <Button variant="primary" size="small" disabled={git.busy() || !message().trim()} onClick={commit}>
                    {language.t("git.commit")}
                  </Button>
                </div>
              </div>
              <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
                  <span class="text-ui-sm font-medium">
                    {language.t("git.changes")} <span class="text-foreground-subtle">{changes().length}</span>
                  </span>
                  <input
                    value={query()}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                    class="ml-auto min-w-0 max-w-[150px] rounded-md border border-border bg-background px-2 py-1 text-ui-xs outline-none placeholder:text-foreground-subtle focus:border-interactive-focus"
                    placeholder={language.t("git.changes")}
                    aria-label={language.t("git.changes")}
                  />
                  <button
                    type="button"
                    class="rounded-md px-2 py-1 text-ui-xs text-foreground-subtle hover:bg-hover"
                    disabled={git.busy() || (!unstaged().length && !staged().length)}
                    onClick={stageAll}
                  >
                    {unstaged().length ? language.t("git.stageAll") : language.t("git.unstageAll")}
                  </button>
                </div>
                <div class="source-control-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
                  <Show
                    when={visibleChanges().length}
                    fallback={
                      <div class="px-2 py-8 text-center text-ui-sm text-foreground-subtle">
                        {language.t("git.clean")}
                      </div>
                    }
                  >
                    <>
                      {group(language.t("git.staged"), stagedChanges())}
                      {group(language.t("git.unstaged"), unstagedChanges())}
                    </>
                  </Show>
                </div>
              </div>
              <Show when={git.error()}>
                <div class="border-t border-critical-base/30 px-3 py-2 text-ui-xs text-critical-base">
                  {git.error()}
                </div>
              </Show>
            </div>
          )}
        </Show>
      </Show>
    </div>
  )
}
