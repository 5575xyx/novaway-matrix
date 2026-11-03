/**
 * 一站式发布。
 *
 * 一个弹窗里完成「发什么 + 发到哪」：先选内容类型与素材，再勾账号（可跨平台），
 * 提交后同一个弹窗切成进度视图 —— 每个账号一行，主进程逐个执行并把进度推回来
 * （见 desktop/platform/publish/runner.ts）。
 *
 * 关键约定：
 * - 内容类型决定可选账号：不支持的平台直接置灰并写明原因，不让用户白等。
 * - 批次串行执行，进度事件带 accountId，界面用一张表合并，不关心先后顺序。
 * - 关闭弹窗不取消任务（主进程会跑完并落盘），下次打开能在"最近发布"里看到结果。
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"
import { Icon } from "@novaway/ui/icon"
import { usePlatformAccounts, PLATFORM_LIST, type PlatformAccount } from "@/context/platform-accounts"
import {
  PUBLISH_KIND_LABEL,
  supportsPublish,
  type PublishKind,
} from "@/pages/pulse/publish-capabilities"
import type { PublishAccountResult, PublishBatch } from "@/pages/pulse/publish-types"

const KINDS: PublishKind[] = ["video", "image_text", "article"]

const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "avi", "mkv", "flv", "webm"]
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"]

function statusLabel(result: PublishAccountResult) {
  switch (result.status) {
    case "pending":
      return "排队中"
    case "running":
      return result.message || "进行中"
    case "success":
      // 公众号只做到"存草稿"，主进程会在 message 里写明；没有就还是"发布成功"。
      return result.message || "发布成功"
    case "unsupported":
      return result.message || "不支持"
    case "cancelled":
      return "已取消"
    default:
      return result.message || "失败"
  }
}

function statusTone(result: PublishAccountResult) {
  switch (result.status) {
    case "success":
      return "text-emerald-600 dark:text-emerald-400"
    case "failed":
      return "text-rose-600 dark:text-rose-400"
    case "unsupported":
      return "text-amber-600 dark:text-amber-400"
    case "running":
      return "text-foreground"
    default:
      return "text-foreground-subtle"
  }
}

function AccountRow(props: {
  account: PlatformAccount
  kind: PublishKind
  checked: boolean
  onToggle: () => void
}) {
  const platform = usePlatformAccounts()
  const info = () => PLATFORM_LIST.find((p) => p.id === props.account.platform)
  const supported = () => supportsPublish(props.account.platform, props.kind)
  // 登录状态不作为硬门槛：巡检可能因为平台风控误判，发布时主进程会给出更准确的原因。
  const available = () => supported()
  const unverified = () => supported() && props.account.status !== "valid"

  return (
    <label
      class="flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors"
      classList={{
        "cursor-pointer hover:bg-hover": available(),
        "opacity-45 cursor-not-allowed": !available(),
      }}
      title={!supported() ? `${info()?.name} 暂不支持发布${PUBLISH_KIND_LABEL[props.kind]}` : undefined}
    >
      <input
        type="checkbox"
        checked={props.checked}
        disabled={!available()}
        onChange={() => available() && props.onToggle()}
        class="size-4 rounded border-border accent-[var(--novaway-mode-color,#FF6B6B)]"
      />
      <div class="relative size-7 shrink-0 overflow-hidden rounded-full bg-background-alt flex items-center justify-center">
        {props.account.avatar ? (
          <img src={props.account.avatar} alt="" class="size-full object-cover" />
        ) : info()?.icon ? (
          <img src={info()?.icon} alt="" class="size-4 object-contain opacity-70" />
        ) : (
          <span class="text-11-regular text-foreground-subtle">{props.account.nickname?.charAt(0)}</span>
        )}
      </div>
      <span class="min-w-0 flex-1 truncate text-13-medium text-foreground">{platform.displayName(props.account)}</span>
      <Show when={info()?.icon} fallback={<span class="text-xs">{info()?.name}</span>}>
        <span class="flex items-center gap-1 text-11-regular text-foreground-subtlest">
          <img src={info()?.icon} alt="" class="size-3" />
          {info()?.name}
        </span>
      </Show>
      <Show when={unverified()}>
        <span
          class="rounded-full border border-amber-300/40 bg-amber-300/10 px-1.5 py-0.5 text-10-medium text-amber-600 dark:text-amber-300"
          title="登录状态未确认（巡检可能被平台风控误判），发布时若失败会给出原因"
        >
          未验证
        </span>
      </Show>
      <Show when={!supported()}>
        <span class="rounded-full border border-amber-300/40 bg-amber-300/10 px-1.5 py-0.5 text-10-medium text-amber-600 dark:text-amber-300">
          不支持
        </span>
      </Show>
    </label>
  )
}

export function PublishModal(props: { accountId?: string }) {
  const dialog = useDialog()
  const platform = usePlatformAccounts()

  // 默认内容类型要"一进来就能发"：
  // - 从某个账号点进来 → 选这个平台支持的；
  // - 只有一个账号（比如只有一个公众号）→ 同样选它支持的，
  //   否则默认"图文"，公众号那一行一直是灰的、按钮写着"发布到 0 个账号"，
  //   用户会以为发布中心坏了。
  const initialKind = (): PublishKind => {
    const accounts = platform.store.accounts
    const account = props.accountId
      ? accounts.find((a) => a.id === props.accountId)
      : accounts.length === 1
        ? accounts[0]
        : undefined
    if (account) {
      const supported = KINDS.find((item) => supportsPublish(account.platform, item))
      if (supported) return supported
    }
    // 多账号：图文覆盖面最广，优先它。
    if (accounts.some((a) => supportsPublish(a.platform, "image_text"))) return "image_text"
    for (const item of KINDS) {
      if (accounts.some((a) => supportsPublish(a.platform, item))) return item
    }
    return "image_text"
  }

  const defaultKind = initialKind()
  const [kind, setKind] = createSignal<PublishKind>(defaultKind)
  const [title, setTitle] = createSignal("")
  const [content, setContent] = createSignal("")
  const [tags, setTags] = createSignal("")
  const [files, setFiles] = createSignal<string[]>([])
  // 没指定账号时，默认勾上"能发这类内容"的账号 —— 否则一进来按钮就是
  // "发布到 0 个账号"，看起来像功能坏了。
  const [selectedIds, setSelectedIds] = createSignal(
    new Set<string>(
      props.accountId
        ? [props.accountId]
        : platform.store.accounts.filter((a) => supportsPublish(a.platform, defaultKind)).map((a) => a.id),
    ),
  )
  const [phase, setPhase] = createSignal<"compose" | "running" | "done">("compose")
  const [results, setResults] = createSignal<Record<string, PublishAccountResult>>({})
  const [batch, setBatch] = createSignal<PublishBatch | undefined>()
  const [error, setError] = createSignal("")
  const [history, setHistory] = createSignal<PublishBatch[]>([])

  onMount(() => {
    // 进度事件按 accountId 合并；同一时刻只允许有一个批次在跑，不必区分 batchId。
    const offProgress = platform.onPublishProgress((event) => {
      setResults((prev) => ({ ...prev, [event.result.accountId]: event.result }))
      setPhase((current) => (current === "done" ? current : "running"))
    })
    const offFinished = platform.onPublishFinished((finished) => {
      if ("error" in finished) {
        setError(finished.error)
        setPhase("compose")
        return
      }
      setBatch(finished)
      setResults(Object.fromEntries(finished.results.map((item) => [item.accountId, item])))
      setPhase("done")
      void platform.publishBatches().then(setHistory)
    })
    void platform.publishBatches().then(setHistory)
    onCleanup(() => {
      offProgress()
      offFinished()
    })
  })

  const selectedAccounts = createMemo(() => platform.store.accounts.filter((a) => selectedIds().has(a.id)))
  const readyAccounts = createMemo(() => selectedAccounts().filter((a) => supportsPublish(a.platform, kind())))
  const skippedAccounts = createMemo(() => selectedAccounts().filter((a) => !supportsPublish(a.platform, kind())))

  const needsFiles = () => kind() !== "article"
  const canPublish = createMemo(() => {
    if (readyAccounts().length === 0) return false
    if (needsFiles() && files().length === 0) return false
    // 公众号后台不接受空标题；其它平台标题可选。
    if (kind() === "article" && !title().trim()) return false
    if (!content().trim() && !title().trim()) return false
    return true
  })

  // 换内容类型后，如果原来勾的账号一个都不支持新类型，就自动改勾支持的账号，
  // 免得上一步选完、下一步又变成"发布到 0 个账号"。
  const chooseKind = (next: PublishKind) => {
    setKind(next)
    const kept = platform.store.accounts.filter((a) => selectedIds().has(a.id) && supportsPublish(a.platform, next))
    if (kept.length > 0) return
    setSelectedIds(new Set(platform.store.accounts.filter((a) => supportsPublish(a.platform, next)).map((a) => a.id)))
  }

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllSupported = () => {
    setSelectedIds(new Set(platform.store.accounts.filter((a) => supportsPublish(a.platform, kind())).map((a) => a.id)))
  }

  const pickFiles = async () => {
    const picker = window.api?.openFilePicker
    if (!picker) {
      setError("当前环境只能选择项目内文件，请用桌面端发布")
      return
    }
    const extensions = kind() === "video" ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS
    let picked: string | string[] | null = null
    try {
      picked = await picker({
        multiple: kind() !== "video",
        title: kind() === "video" ? "选择视频" : "选择图片",
        extensions,
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : "选择文件失败")
      return
    }
    if (!picked) return
    const list = Array.isArray(picked) ? picked : [picked]
    setFiles(kind() === "video" ? list.slice(0, 1) : [...files(), ...list])
    setError("")
  }

  const submit = async () => {
    if (!canPublish()) return
    setError("")
    setResults(
      Object.fromEntries(
        readyAccounts().map((account) => [
          account.id,
          {
            accountId: account.id,
            platform: account.platform,
            nickname: account.nickname,
            status: "pending" as const,
            progress: 0,
            message: "排队中",
            updatedAt: Date.now(),
          },
        ]),
      ),
    )
    setPhase("running")
    try {
      const result = await platform.publishBatch(
        readyAccounts().map((account) => account.id),
        {
          kind: kind(),
          title: title().trim(),
          description: content().trim(),
          filePaths: files(),
          tags: tags()
            .split(/[\s,，]+/)
            .map((tag) => tag.replace(/^#/, "").trim())
            .filter(Boolean),
        },
      )
      if (!result.ok) {
        setError(result.error || "发布失败")
        setPhase("compose")
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      setPhase("compose")
    }
  }

  // 进度按 results 展示而不是按当前勾选：关掉弹窗再打开时勾选已经清空，
  // 但主进程那一批还在跑，进度仍要看得见。
  const progressRows = createMemo(() => Object.values(results()))

  const rowName = (row: PublishAccountResult) => {
    const account = platform.store.accounts.find((a) => a.id === row.accountId)
    if (account) return platform.displayName(account)
    return row.nickname || PLATFORM_LIST.find((p) => p.id === row.platform)?.name || row.platform
  }

  const successCount = () => Object.values(results()).filter((item) => item.status === "success").length
  const failedCount = () =>
    Object.values(results()).filter((item) => item.status === "failed" || item.status === "cancelled").length

  return (
    <Dialog
      title="发布内容"
      size="large"
      footer={
        <>
          <Show when={phase() === "compose"}>
            <button
              type="button"
              class="rounded-[8px] border border-border bg-background px-4 py-2 text-13-medium text-foreground transition-colors hover:bg-hover"
              onClick={() => dialog.close()}
            >
              取消
            </button>
            <button
              type="button"
              class="rounded-[8px] px-4 py-2 text-13-medium text-white transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: "linear-gradient(135deg, var(--novaway-mode-color, #FF6B6B), #e05555)",
                "box-shadow": "0 4px 12px color-mix(in srgb, var(--novaway-mode-color, #FF6B6B) 30%, transparent)",
              }}
              disabled={!canPublish()}
              onClick={submit}
            >
              发布到 {readyAccounts().length} 个账号
            </button>
          </Show>
          <Show when={phase() === "running"}>
            <button
              type="button"
              class="rounded-[8px] border border-border bg-background px-4 py-2 text-13-medium text-foreground transition-colors hover:bg-hover"
              onClick={() => void platform.cancelPublish()}
            >
              取消剩余
            </button>
          </Show>
          <Show when={phase() === "done"}>
            <button
              type="button"
              class="rounded-[8px] border border-border bg-background px-4 py-2 text-13-medium text-foreground transition-colors hover:bg-hover"
              onClick={() => {
                setPhase("compose")
                setResults({})
                setBatch(undefined)
              }}
            >
              再发一次
            </button>
            <button
              type="button"
              class="rounded-[8px] px-4 py-2 text-13-medium text-white transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0"
              style={{
                background: "linear-gradient(135deg, var(--novaway-mode-color, #FF6B6B), #e05555)",
                "box-shadow": "0 4px 12px color-mix(in srgb, var(--novaway-mode-color, #FF6B6B) 30%, transparent)",
              }}
              onClick={() => dialog.close()}
            >
              完成
            </button>
          </Show>
        </>
      }
    >
      <div class="max-h-[640px] overflow-y-auto p-5">
        <Show when={phase() === "compose"}>
          <div class="space-y-5">
            {/* 内容类型：决定账号可用性，所以放在最上面先选。 */}
            <div>
              <div class="mb-2 text-13-medium text-foreground">内容类型</div>
              <div class="flex gap-2">
                <For each={KINDS}>
                  {(item) => (
                    <button
                      type="button"
                      class="flex-1 rounded-[8px] border px-3 py-2 text-12-medium transition-all duration-150 active:scale-[0.98]"
                      classList={{
                        "border-[var(--novaway-mode-color,#FF6B6B)] bg-[color-mix(in_srgb,var(--novaway-mode-color,#FF6B6B)_10%,transparent)] text-foreground":
                          kind() === item,
                        "border-border bg-background text-foreground-subtle hover:bg-hover": kind() !== item,
                      }}
                      onClick={() => chooseKind(item)}
                    >
                      {PUBLISH_KIND_LABEL[item]}
                    </button>
                  )}
                </For>
              </div>
            </div>

            <Show when={needsFiles()}>
              <div>
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-13-medium text-foreground">
                    {kind() === "video" ? "视频文件" : "图片"}
                  </span>
                  <button
                    type="button"
                    class="rounded-[6px] border border-border px-2.5 py-1 text-12-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                    onClick={pickFiles}
                  >
                    选择文件
                  </button>
                </div>
                <div class="rounded-[10px] border border-dashed border-border bg-background-alt/40 p-3">
                  <Show
                    when={files().length > 0}
                    fallback={
                      <div class="py-4 text-center text-12-regular text-foreground-subtlest">
                        {kind() === "video" ? "选择一个视频文件" : "选择一张或多张图片"}
                      </div>
                    }
                  >
                    <div class="flex flex-wrap gap-2">
                      <For each={files()}>
                        {(file) => (
                          <span class="inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-11-regular text-foreground-subtle">
                            <Icon name="folder" size="small" class="shrink-0" />
                            <span class="truncate">{file.split(/[\\/]/).pop()}</span>
                            <button
                              type="button"
                              class="shrink-0 text-foreground-subtlest transition-colors hover:text-rose-500"
                              onClick={() => setFiles((prev) => prev.filter((item) => item !== file))}
                            >
                              <Icon name="close-small" size="small" />
                            </button>
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>

            <div>
              <label class="mb-2 block text-13-medium text-foreground">标题</label>
              <input
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
                placeholder="输入标题（可选）"
                class="w-full rounded-[8px] border border-border bg-background px-3.5 py-2.5 text-13-regular text-foreground outline-none transition-all duration-150 placeholder:text-foreground-subtle focus:border-[var(--novaway-mode-color,#FF6B6B)]"
              />
            </div>

            <div>
              <label class="mb-2 block text-13-medium text-foreground">
                {kind() === "article" ? "正文" : "描述"}
              </label>
              <textarea
                value={content()}
                onInput={(e) => setContent(e.currentTarget.value)}
                placeholder={kind() === "article" ? "文章正文…" : "作品描述…"}
                rows={kind() === "article" ? 8 : 4}
                class="w-full resize-none rounded-[8px] border border-border bg-background px-3.5 py-2.5 text-13-regular text-foreground outline-none transition-all duration-150 placeholder:text-foreground-subtle focus:border-[var(--novaway-mode-color,#FF6B6B)]"
              />
            </div>

            <div>
              <label class="mb-2 block text-13-medium text-foreground">话题标签</label>
              <input
                value={tags()}
                onInput={(e) => setTags(e.currentTarget.value)}
                placeholder="用空格分隔，例如：生活 好物 效率"
                class="w-full rounded-[8px] border border-border bg-background px-3.5 py-2.5 text-13-regular text-foreground outline-none transition-all duration-150 placeholder:text-foreground-subtle focus:border-[var(--novaway-mode-color,#FF6B6B)]"
              />
            </div>

            <div>
              <div class="mb-2 flex items-center justify-between">
                <span class="text-13-medium text-foreground">发布账号</span>
                <button
                  type="button"
                  class="text-12-regular text-foreground-subtle transition-colors hover:text-foreground"
                  onClick={selectAllSupported}
                >
                  全选支持{kind() === "video" ? "视频" : kind() === "image_text" ? "图文" : "文章"}的账号
                </button>
              </div>
              <div class="max-h-56 space-y-0.5 overflow-y-auto rounded-[10px] border border-border bg-background-alt/40 p-2">
                <For each={platform.store.accounts}>
                  {(account) => (
                    <AccountRow
                      account={account}
                      kind={kind()}
                      checked={selectedIds().has(account.id)}
                      onToggle={() => toggle(account.id)}
                    />
                  )}
                </For>
                <Show when={platform.store.accounts.length === 0}>
                  <div class="py-6 text-center text-12-regular text-foreground-subtlest">暂无账号，请先添加</div>
                </Show>
              </div>
              <div class="mt-1.5 flex items-center justify-between text-11-regular text-foreground-subtle">
                <span>将发布到 {readyAccounts().length} 个账号</span>
                <Show when={platform.store.accounts.length > 0 && readyAccounts().length === 0}>
                  <span class="text-rose-600 dark:text-rose-400">
                    没有账号支持{PUBLISH_KIND_LABEL[kind()]}，换个内容类型或先添加账号
                  </span>
                </Show>
                <Show when={skippedAccounts().length > 0}>
                  <span class="text-amber-600 dark:text-amber-400">
                    {skippedAccounts().length} 个账号已跳过（该平台不支持
                    {PUBLISH_KIND_LABEL[kind()]}）
                  </span>
                </Show>
              </div>
            </div>

            <Show when={error()}>
              <div class="rounded-[8px] border border-rose-300/40 bg-rose-300/10 px-3 py-2 text-12-regular text-rose-600 dark:text-rose-300">
                {error()}
              </div>
            </Show>

            <Show when={history().length > 0}>
              <div>
                <div class="mb-2 text-13-medium text-foreground">最近发布</div>
                <div class="space-y-1.5">
                  <For each={history().slice(0, 3)}>
                    {(item) => {
                      const ok = item.results.filter((result) => result.status === "success").length
                      const fail = item.results.length - ok
                      return (
                        <div class="flex items-center gap-2 rounded-[8px] border border-border bg-background px-2.5 py-1.5 text-11-regular text-foreground-subtle">
                          <Icon name="archive" size="small" class="shrink-0 text-foreground-subtlest" />
                          <span class="min-w-0 flex-1 truncate">{item.input.title || item.input.description || "未命名内容"}</span>
                          <span class="shrink-0 text-emerald-600 dark:text-emerald-400">成功 {ok}</span>
                          <Show when={fail > 0}>
                            <span class="shrink-0 text-rose-600 dark:text-rose-400">失败 {fail}</span>
                          </Show>
                          <span class="shrink-0 text-foreground-subtlest">
                            {new Date(item.startedAt).toLocaleString("zh-CN", { hour12: false })}
                          </span>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={phase() !== "compose"}>
          <div class="space-y-4">
            <div class="rounded-[10px] border border-border bg-background-alt/40 p-4">
              <div class="text-13-medium text-foreground">
                {phase() === "running" ? "正在发布…" : `发布完成：成功 ${successCount()}，失败 ${failedCount()}`}
              </div>
              <div class="mt-1 text-11-regular text-foreground-subtlest">
                共 {progressRows().length} 个账号 · {PUBLISH_KIND_LABEL[batch()?.input.kind ?? kind()]} ·{" "}
                {batch()?.input.title || batch()?.input.description?.slice(0, 20) || title() || content().slice(0, 20)}
              </div>
            </div>

            <div class="space-y-1.5">
              <For each={progressRows()}>
                {(result) => (
                  <div class="rounded-[8px] border border-border bg-background px-3 py-2">
                    <div class="flex items-center gap-2">
                      <span class="min-w-0 flex-1 truncate text-12-medium text-foreground">{rowName(result)}</span>
                      <span class="shrink-0 text-11-regular text-foreground-subtlest">
                        {PLATFORM_LIST.find((p) => p.id === result.platform)?.name || result.platform}
                      </span>
                      <span class={`shrink-0 text-11-medium ${statusTone(result)}`}>{statusLabel(result)}</span>
                    </div>
                    <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-background-alt">
                      <div
                        class="h-full rounded-full transition-[width] duration-300"
                        classList={{
                          "bg-[var(--novaway-mode-color,#FF6B6B)]":
                            result.status === "running" || result.status === "pending",
                          "bg-emerald-500": result.status === "success",
                          "bg-rose-500": result.status === "failed",
                          "bg-amber-500": result.status === "unsupported" || result.status === "cancelled",
                        }}
                        style={{ width: `${Math.max(4, result.progress)}%` }}
                      />
                    </div>
                  </div>
                )}
              </For>
            </div>

            <Show when={phase() === "done"}>
              <div class="text-center text-11-regular text-foreground-subtlest">
                批次 {batch()!.id} · 结果已保存，可在下次打开时查看「最近发布」
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
