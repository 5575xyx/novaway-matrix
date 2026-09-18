import { For, Show, createMemo, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@novaway/ui/button"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { TextField } from "@novaway/ui/text-field"
import type { GitSnapshotResponses } from "@novaway/sdk/v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

type Snapshot = GitSnapshotResponses[200]
type Change = Snapshot["changes"][number]

// git 状态没有服务端推送事件，只能定时轮询一次快照。
const REFRESH_INTERVAL = 5000
// 一次批量提交的文件上限，避免把整个工作区塞进单次请求。
const MAX_BATCH = 200

const statusLetter = (change: Change) => {
  switch (change.status) {
    case "added":
      return "A"
    case "deleted":
      return "D"
    case "renamed":
      return "R"
    case "unmerged":
      return "U"
    case "untracked":
      return "?"
    default:
      return "M"
  }
}

// SDK 生成的数字字段带 NaN/Infinity 联合类型，展示前统一归一成整数。
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0)

// 后端错误可能是 Error、带 message 的对象，或纯字符串，统一取可读文本。
const messageOf = (err: unknown) => {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  if (typeof err === "object" && err !== null && "message" in err && typeof err.message === "string") return err.message
  return String(err)
}

const basename = (path: string) => {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return slash === -1 || slash === path.length - 1 ? path : path.slice(slash + 1)
}

const dirname = (path: string) => {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return slash <= 0 ? "" : path.slice(0, slash).replace(/[\\/]+$/, "")
}

const SectionHeader = (props: { title: JSX.Element; count?: number; action?: JSX.Element }): JSX.Element => (
  <div class="flex items-center gap-1 px-2 py-1">
    <span class="text-11-medium text-text-strong uppercase tracking-wide flex-1 truncate">{props.title}</span>
    <Show when={props.count !== undefined}>
      <span class="text-11-regular text-text-weak">{props.count}</span>
    </Show>
    {props.action}
  </div>
)

export function GitPanel() {
  const sdk = useSDK()
  const language = useLanguage()
  const [store, setStore] = createStore({
    snapshot: undefined as Snapshot | undefined,
    loading: true,
    busy: false,
    error: "",
    message: "",
    newBranch: false,
    newBranchName: "",
  })

  const staged = createMemo(() => store.snapshot?.changes.filter((c) => c.staged) ?? [])
  const unstaged = createMemo(() => store.snapshot?.changes.filter((c) => !c.staged) ?? [])
  const snapshot = () => store.snapshot

  const refresh = () => {
    if (store.busy) return
    sdk.client.git
      .snapshot()
      .then((result) => {
        setStore({ snapshot: result.data, loading: false, error: "" })
      })
      .catch((err: unknown) => {
        setStore({ loading: false, error: messageOf(err) })
      })
  }

  // 变更类接口执行后直接返回最新快照，省一次往返。
  const act = (run: () => Promise<{ data?: Snapshot }>) => {
    setStore("busy", true)
    return run()
      .then((result) => {
        setStore({ busy: false, snapshot: result.data ?? store.snapshot, error: "" })
      })
      .catch((err: unknown) => {
        setStore({ busy: false, error: messageOf(err) })
      })
  }

  const stage = (files: string[]) => act(() => sdk.client.git.add({ files: files.slice(0, MAX_BATCH) }).then((r) => r))
  const unstage = (files: string[]) => act(() => sdk.client.git.unstage({ files: files.slice(0, MAX_BATCH) }).then((r) => r))
  const discard = (file: string) => {
    if (!window.confirm(`${file} — ${language.t("git.discard")}？`)) return
    void act(() => sdk.client.git.discard({ files: [file] }).then((r) => r))
  }

  const commit = () => {
    const message = store.message.trim()
    if (!message || store.busy) return
    void act(() => sdk.client.git.commit({ message }).then((r) => r)).then(() => setStore("message", ""))
  }

  const checkout = (branch: string) => act(() => sdk.client.git.branch({ name: branch }).then((r) => r))

  const createBranch = () => {
    const name = store.newBranchName.trim()
    if (!name) return
    setStore("newBranch", false)
    setStore("newBranchName", "")
    void act(() => sdk.client.git.branch({ name, create: true }).then((r) => r))
  }

  const popStash = (ref: string) => act(() => sdk.client.git.stash({ ref }).then((r) => r))

  refresh()
  const timer = setInterval(() => {
    if (!store.busy) refresh()
  }, REFRESH_INTERVAL)
  onCleanup(() => clearInterval(timer))

  const branchName = () => snapshot()?.branch.branch ?? language.t("git.noBranch")
  const ahead = () => num(snapshot()?.branch.ahead)
  const behind = () => num(snapshot()?.branch.behind)
  const canCommit = () => !store.busy && store.message.trim().length > 0 && (staged().length > 0 || unstaged().length > 0)
  const canPush = () => Boolean(snapshot()?.branch.branch) && !store.busy
  const canPull = () => Boolean(snapshot()?.branch.upstream) && !store.busy

  return (
    <div data-component="git-panel" class="h-full flex flex-col gap-2 px-2 py-2 overflow-hidden">
      <div class="flex items-center gap-1">
        <Icon name="branch" size="small" class="text-icon-base shrink-0" />
        <span class="text-13-medium text-text-strong min-w-0 truncate flex-1" title={branchName()}>
          {branchName()}
        </span>
        <Show when={ahead() > 0 || behind() > 0}>
          <span class="text-11-regular text-text-weak shrink-0">
            <span classList={{ "text-success-base": ahead() > 0 }}>↑{ahead()}</span>{" "}
            <span classList={{ "text-warning-base": behind() > 0 }}>↓{behind()}</span>
          </span>
        </Show>
        <IconButton
          icon="cloud-upload"
          variant="ghost"
          size="normal"
          class="size-6 rounded-md shrink-0"
          disabled={!canPull()}
          data-action="git-pull"
          aria-label={language.t("git.pull")}
          onClick={() => void act(() => sdk.client.git.pull().then((r) => r))}
        />
        <IconButton
          icon="arrow-up"
          variant="ghost"
          size="normal"
          class="size-6 rounded-md shrink-0"
          disabled={!canPush()}
          data-action="git-push"
          aria-label={language.t("git.push")}
          onClick={() => void act(() => sdk.client.git.push().then((r) => r))}
        />
        <IconButton
          icon="refresh"
          variant="ghost"
          size="normal"
          class="size-6 rounded-md shrink-0"
          data-action="git-refresh"
          aria-label={language.t("git.refresh")}
          onClick={() => refresh()}
        />
        <DropdownMenu modal={false}>
          <IconButton
            icon="more-vertical"
            variant="ghost"
            size="normal"
            class="size-6 rounded-md shrink-0"
            data-action="git-more"
            aria-label={language.t("git.branches")}
          />
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger>
                  <span>{language.t("git.branches")}</span>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent>
                    <For each={snapshot()?.branches ?? []}>
                      {(item) => (
                        <DropdownMenu.Item disabled={item.current} onSelect={() => void checkout(item.name)}>
                          <DropdownMenu.ItemLabel>
                            {item.name}
                            <Show when={item.current}> · 当前</Show>
                          </DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      )}
                    </For>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      onSelect={() => {
                        setStore("newBranch", (x) => !x)
                        setStore("newBranchName", "")
                      }}
                    >
                      <DropdownMenu.ItemLabel>{language.t("git.createBranch")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
              <DropdownMenu.Item
                disabled={store.busy || unstaged().length === 0}
                onSelect={() => void act(() => sdk.client.git.stash({}).then((r) => r))}
              >
                <DropdownMenu.ItemLabel>{language.t("git.stash")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>

      <Show when={store.newBranch}>
        <div class="flex items-center gap-1">
          <TextField
            value={store.newBranchName}
            onChange={(value: string) => setStore("newBranchName", value)}
            placeholder={language.t("git.createBranch")}
            class="flex-1 min-w-0"
            onKeyDown={(event: { key: string; preventDefault: () => void }) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              createBranch()
            }}
          />
          <Button size="small" variant="primary" disabled={store.busy || !store.newBranchName.trim()} onClick={createBranch}>
            {language.t("git.createBranch")}
          </Button>
        </div>
      </Show>

      <div class="flex flex-col gap-1">
        <TextField
          multiline
          value={store.message}
          onChange={(value: string) => setStore("message", value)}
          placeholder={language.t("git.commitPlaceholder")}
          class="min-h-12 resize-none"
          data-component="git-commit-input"
        />
        <Button
          size="small"
          variant="primary"
          class="w-full"
          disabled={!canCommit()}
          data-action="git-commit"
          onClick={commit}
        >
          {language.t("git.commit")}
          <Show when={unstaged().length > 0}> · {language.t("git.commitAll")}</Show>
        </Button>
      </div>

      <Show when={store.error}>
        <div class="flex items-start gap-1 px-2 py-1 rounded-md bg-surface-base-active">
          <Icon name="warning" size="small" class="text-warning-base shrink-0" />
          <span class="text-12-regular text-text-strong break-all">{store.error}</span>
        </div>
      </Show>

      <Show when={store.loading && !store.snapshot}>
        <div class="flex-1 flex items-center justify-center text-12-regular text-text-weak">
          {language.t("git.loading")}
        </div>
      </Show>

      <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-1">
        <Show when={staged().length > 0}>
          <div>
            <SectionHeader
              title={language.t("git.staged")}
              count={staged().length}
              action={
                <IconButton
                  icon="close-small"
                  variant="ghost"
                  size="normal"
                  class="size-5 rounded-md"
                  disabled={store.busy}
                  data-action="git-unstage-all"
                  aria-label={language.t("git.unstageAll")}
                  onClick={() => void unstage(staged().map((c) => c.file))}
                />
              }
            />
            <For each={staged()}>
              {(change) => <ChangeRow change={change} busy={store.busy} onUnstage={() => void unstage([change.file])} onDiscard={() => discard(change.file)} language={language} />}
            </For>
          </div>
        </Show>

        <Show when={unstaged().length > 0}>
          <div>
            <SectionHeader
              title={language.t("git.unstaged")}
              count={unstaged().length}
              action={
                <IconButton
                  icon="plus-small"
                  variant="ghost"
                  size="normal"
                  class="size-5 rounded-md"
                  disabled={store.busy}
                  data-action="git-stage-all"
                  aria-label={language.t("git.stageAll")}
                  onClick={() => void stage(unstaged().map((c) => c.file))}
                />
              }
            />
            <For each={unstaged()}>
              {(change) => <ChangeRow change={change} busy={store.busy} onStage={() => void stage([change.file])} onDiscard={() => discard(change.file)} language={language} />}
            </For>
          </div>
        </Show>

        <Show when={staged().length === 0 && unstaged().length === 0 && !store.loading && !store.error}>
          <div class="flex items-center justify-center py-4 text-12-regular text-text-weak">
            {language.t("git.noChanges")}
          </div>
        </Show>

        <Show when={(snapshot()?.stash.length ?? 0) > 0}>
          <div>
            <SectionHeader title={language.t("git.stash")} count={snapshot()?.stash.length} />
            <For each={snapshot()?.stash ?? []}>
              {(entry) => (
                <button
                  type="button"
                  class="group/stash flex items-center gap-1 w-full px-2 py-1 rounded-md hover:bg-surface-raised-base-hover text-left"
                  data-action="git-stash-pop"
                  onClick={() => void popStash(entry.ref)}
                >
                  <span class="text-11-medium text-text-weak shrink-0 font-mono">{entry.ref}</span>
                  <span class="text-12-regular text-text-base min-w-0 flex-1 truncate">{entry.message}</span>
                  <span class="text-11-regular text-text-weak opacity-0 group-hover/stash:opacity-100 shrink-0">
                    {language.t("git.unstage")}
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show when={(snapshot()?.log.length ?? 0) > 0}>
          <div>
            <SectionHeader title={language.t("git.history")} />
            <For each={snapshot()?.log ?? []}>
              {(entry) => (
                <div class="px-2 py-1" title={`${entry.hash} ${entry.subject}`}>
                  <div class="flex items-center gap-1 min-w-0">
                    <span class="text-11-medium text-text-weak font-mono shrink-0">{entry.hash}</span>
                    <span class="text-12-regular text-text-base min-w-0 truncate">{entry.subject}</span>
                  </div>
                  <div class="text-11-regular text-text-weak pl-14 truncate">
                    {entry.author} · {entry.date}
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}

const ChangeRow = (props: {
  change: Change
  busy: boolean
  onStage?: () => void
  onUnstage?: () => void
  onDiscard: () => void
  language: { t: (key: string) => string }
}): JSX.Element => {
  const label = () => basename(props.change.file)
  const parent = () => dirname(props.change.file)
  const added = () => num(props.change.additions)
  const removed = () => num(props.change.deletions)
  const hasStats = () => !props.change.binary && (added() > 0 || removed() > 0)

  return (
    <div
      class="group/file flex items-center gap-1 w-full px-2 py-1 rounded-md hover:bg-surface-raised-base-hover"
      title={props.change.file}
    >
      <span
        class="text-11-medium font-mono w-3 text-center shrink-0"
        classList={{
          "text-warning-base": props.change.status === "modified" || props.change.status === "renamed",
          "text-success-base": props.change.status === "added",
          "text-error-base": props.change.status === "deleted" || props.change.status === "unmerged",
          "text-text-weak": props.change.status === "untracked",
        }}
      >
        {statusLetter(props.change)}
      </span>
      <span class="text-12-regular text-text-base min-w-0 truncate">
        <Show when={parent()}>{(value) => <span class="text-text-weak">{value()}/</span>}</Show>
        {label()}
      </span>
      <Show when={props.change.binary}>
        <span class="text-11-regular text-text-weak shrink-0">{props.language.t("git.binary")}</span>
      </Show>
      <Show when={hasStats()}>
        <span class="text-11-regular shrink-0 whitespace-nowrap">
          <span class="text-success-base">+{added()}</span> <span class="text-error-base">-{removed()}</span>
        </span>
      </Show>
      <div class="flex items-center gap-0.5 opacity-0 group-hover/file:opacity-100 shrink-0">
        <Show when={props.onUnstage}>
          {(action) => (
            <IconButton
              icon="close-small"
              variant="ghost"
              size="normal"
              class="size-5 rounded-md"
              disabled={props.busy}
              data-action="git-unstage"
              aria-label={props.language.t("git.unstage")}
              onClick={() => action()}
            />
          )}
        </Show>
        <Show when={props.onStage}>
          {(action) => (
            <IconButton
              icon="plus-small"
              variant="ghost"
              size="normal"
              class="size-5 rounded-md"
              disabled={props.busy}
              data-action="git-stage"
              aria-label={props.language.t("git.stage")}
              onClick={() => action()}
            />
          )}
        </Show>
        <IconButton
          icon="trash"
          variant="ghost"
          size="normal"
          class="size-5 rounded-md"
          disabled={props.busy}
          data-action="git-discard"
          aria-label={props.language.t("git.discard")}
          onClick={props.onDiscard}
        />
      </div>
    </div>
  )
}
