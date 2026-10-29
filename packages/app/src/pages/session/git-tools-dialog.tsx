import { createMemo, createSignal, For, Show } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import type { useGitSnapshot } from "./git-panel"

type Git = ReturnType<typeof useGitSnapshot>

const fieldClass =
  "h-8 min-w-0 flex-1 rounded-md border border-border bg-input px-2 text-ui-sm text-foreground " +
  "placeholder:text-foreground-subtlest outline-none focus:border-primary"

/**
 * 分支管理弹窗。
 *
 * 状态面板的分支下拉是「高频、轻量」入口（切换 / 新建）。删除分支、看清全部分支
 * 放在单独的弹窗里，避免把下拉塞成一个小管理器；新建成功/失败也会明示，
 * 不再出现「点了新建没反应」的观感。
 */
export function GitBranchDialog(props: { git: Git; onClose: () => void }) {
  const language = useLanguage()
  const [name, setName] = createSignal("")
  const [pending, setPending] = createSignal<string | undefined>()

  const snapshot = createMemo(() => props.git.snapshot())
  const branches = createMemo(() => snapshot()?.branches ?? [])
  const current = createMemo(() => snapshot()?.branch.branch ?? "")

  const run = (key: string, action: () => Promise<boolean>) => {
    setPending(key)
    void action().finally(() => setPending(undefined))
  }

  const create = () => {
    const value = name().trim()
    if (!value || props.git.busy()) return
    void props.git.createBranch(value).then((ok) => {
      if (ok) setName("")
    })
  }

  return (
    <Dialog
      title={language.t("git.branch.manage.title")}
      size="normal"
      footer={
        <Button variant="secondary" onClick={props.onClose}>
          {language.t("common.close")}
        </Button>
      }
    >
      <div data-slot="dialog-body" class="flex flex-col gap-4 p-1">
        <div class="flex flex-col gap-1.5">
          <div class="text-12-medium text-foreground-subtle">
            {language.t("git.branch.manage.current", { branch: current() || language.t("git.noBranch") })}
          </div>
          <div class="max-h-64 overflow-y-auto rounded-lg border border-border">
            <Show
              when={branches().length > 0}
              fallback={
                <div class="px-3 py-4 text-12-regular text-foreground-subtle">
                  {language.t("git.branch.manage.empty")}
                </div>
              }
            >
              <For each={branches()}>
                {(branch) => (
                  <div class="group flex items-center gap-2 border-b border-border px-2 py-1.5 last:border-b-0">
                    <Icon
                      name="branch"
                      size="small"
                      classList={{
                        "shrink-0": true,
                        "text-foreground": branch.name === current(),
                        "text-foreground-subtlest": branch.name !== current(),
                      }}
                    />
                    <span class="min-w-0 flex-1 truncate text-12-regular text-foreground">{branch.name}</span>
                    <Show when={branch.name === current()}>
                      <span class="shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-ui-xs text-foreground-subtle">
                        {language.t("git.branch.manage.head")}
                      </span>
                    </Show>
                    <Show when={branch.name !== current()}>
                      <button
                        type="button"
                        class="shrink-0 rounded-md px-1.5 py-0.5 text-ui-xs text-foreground-subtle opacity-0 transition-opacity hover:bg-hover hover:text-foreground group-hover:opacity-100 disabled:opacity-40"
                        disabled={props.git.busy() || pending() !== undefined}
                        onClick={() => run(`switch:${branch.name}`, () => props.git.checkout(branch.name))}
                      >
                        {language.t("git.branch.manage.switch")}
                      </button>
                      <button
                        type="button"
                        class="shrink-0 rounded-md px-1.5 py-0.5 text-ui-xs text-foreground-subtle opacity-0 transition-opacity hover:bg-hover hover:text-rose-600 group-hover:opacity-100 disabled:opacity-40"
                        disabled={props.git.busy() || pending() !== undefined}
                        onClick={() => run(`remove:${branch.name}`, () => props.git.removeBranch(branch.name))}
                      >
                        {language.t("git.branch.manage.remove")}
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="text-12-medium text-foreground-subtle">{language.t("git.branch.manage.create")}</div>
          <div class="flex items-center gap-1.5">
            <input
              type="text"
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                create()
              }}
              placeholder={language.t("git.branch.newPlaceholder")}
              class={fieldClass}
            />
            <Button variant="secondary" size="small" disabled={!name().trim() || props.git.busy()} onClick={create}>
              {language.t("git.branch.create")}
            </Button>
          </div>
          <div class="text-ui-xs text-foreground-subtlest">{language.t("git.branch.manage.createHint")}</div>
        </div>

        <Show when={props.git.error()}>
          <div class="rounded-md bg-rose-500/10 px-2 py-1.5 text-ui-xs text-rose-600 dark:text-rose-400">
            {props.git.error()}
          </div>
        </Show>
      </div>
    </Dialog>
  )
}

/**
 * 远程仓库弹窗：添加 / 移除 remote。
 *
 * 推送前没有 remote 是新手最常卡住的一步（面板只会报「没有配置远程仓库」，
 * 却没有任何地方能加），这里给一个能直接填地址的入口。
 */
export function GitRemoteDialog(props: { git: Git; onClose: () => void }) {
  const language = useLanguage()
  const [remoteName, setRemoteName] = createSignal("origin")
  const [remoteUrl, setRemoteUrl] = createSignal("")

  const remotes = createMemo(() => props.git.snapshot()?.remotes ?? [])

  const add = () => {
    const name = remoteName().trim() || "origin"
    const url = remoteUrl().trim()
    if (!url || props.git.busy()) return
    void props.git.addRemote({ name, url }).then((ok) => {
      if (ok) setRemoteUrl("")
    })
  }

  return (
    <Dialog
      title={language.t("git.remote.title")}
      size="normal"
      footer={
        <Button variant="secondary" onClick={props.onClose}>
          {language.t("common.close")}
        </Button>
      }
    >
      <div data-slot="dialog-body" class="flex flex-col gap-4 p-1">
        <div class="flex flex-col gap-1.5">
          <div class="text-12-medium text-foreground-subtle">{language.t("git.remote.current")}</div>
          <div class="rounded-lg border border-border">
            <Show
              when={remotes().length > 0}
              fallback={
                <div class="px-3 py-4 text-12-regular text-foreground-subtle">{language.t("git.remote.empty")}</div>
              }
            >
              <For each={remotes()}>
                {(remote) => (
                  <div class="group flex items-center gap-2 border-b border-border px-2 py-1.5 last:border-b-0">
                    <Icon name="globe" size="small" class="shrink-0 text-foreground-subtlest" />
                    <span class="shrink-0 text-12-medium text-foreground">{remote.name}</span>
                    <span class="min-w-0 flex-1 truncate text-ui-xs text-foreground-subtle">{remote.url}</span>
                    <button
                      type="button"
                      class="shrink-0 rounded-md px-1.5 py-0.5 text-ui-xs text-foreground-subtle opacity-0 transition-opacity hover:bg-hover hover:text-rose-600 group-hover:opacity-100 disabled:opacity-40"
                      disabled={props.git.busy()}
                      onClick={() => void props.git.removeRemote(remote.name)}
                    >
                      {language.t("git.remote.remove")}
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="text-12-medium text-foreground-subtle">{language.t("git.remote.add")}</div>
          <div class="flex items-center gap-1.5">
            <input
              type="text"
              value={remoteName()}
              onInput={(event) => setRemoteName(event.currentTarget.value)}
              placeholder="origin"
              class="h-8 w-24 shrink-0 rounded-md border border-border bg-input px-2 text-ui-sm text-foreground placeholder:text-foreground-subtlest outline-none focus:border-primary"
            />
            <input
              type="text"
              value={remoteUrl()}
              onInput={(event) => setRemoteUrl(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                add()
              }}
              placeholder={language.t("git.remote.urlPlaceholder")}
              class={fieldClass}
            />
            <Button variant="secondary" size="small" disabled={!remoteUrl().trim() || props.git.busy()} onClick={add}>
              {language.t("common.add")}
            </Button>
          </div>
        </div>

        <Show when={props.git.error()}>
          <div class="rounded-md bg-rose-500/10 px-2 py-1.5 text-ui-xs text-rose-600 dark:text-rose-400">
            {props.git.error()}
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
