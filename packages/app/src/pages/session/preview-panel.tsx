import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Spinner } from "@novaway/ui/spinner"
import { Tooltip } from "@novaway/ui/tooltip"
import { createSignal, onCleanup, on, createEffect, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePreview } from "@/context/preview"
import { usePreviewInspection } from "@/context/preview-inspection"
import { useSideChat } from "@/pages/session/use-side-chat"
import { normalizePreviewUrl } from "@/utils/preview-url"
import { pickedElementLabel, type PickedElement } from "@/utils/preview-pick"

const IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"

const IFRAME_ALLOW = "fullscreen"

export function PreviewPanel(props: { files?: { count: () => number; open: () => void } }) {
  const language = useLanguage()
  const preview = usePreview()
  const inspection = usePreviewInspection()
  const sideChat = useSideChat()

  /**
   * 「让 AI 操作这个页面」：右栏是 iframe，跨进程拿不到 DOM，
   * 所以把当前地址交给辅助对话，让 AI 用内置 browser_* 工具
   * 在同一地址上执行点击/输入/截图。比假装能直接操控 iframe 更可靠。
   */
  const askAi = () =>
    void sideChat.open({
      draft: `${language.t("preview.aiPrompt" as never)}
${url()}

`,
    })

  const url = preview.url
  const embedUrl = preview.embedUrl

  const [store, setStore] = createStore({
    draft: url(),
    invalid: false,
    reload: 1,
  })

  createEffect(
    on(
      url,
      (next) => {
        if (store.draft === next) return
        setStore("draft", next)
        setStore("invalid", false)
      },
      { defer: true },
    ),
  )

  const go = () => {
    // 输入框清空后确认 = 主动退出预览:清掉地址回到初始空态,
    // 而不是继续挂着上一次打开的页面。
    if (!store.draft.trim()) {
      preview.clear()
      setStore("invalid", false)
      return
    }
    const normalized = normalizePreviewUrl(store.draft)
    if (!normalized) {
      setStore("invalid", true)
      return
    }
    setStore("invalid", false)
    preview.setUrl(normalized)
    setStore("reload", store.reload + 1)
  }

  const refresh = () => {
    // 刷新跟随输入框:输入已清空时刷新等同退出预览,有地址时重载当前页。
    if (!store.draft.trim()) {
      preview.clear()
      return
    }
    if (!url()) return
    setStore("reload", store.reload + 1)
  }

  const openExternal = () => {
    if (!url()) return
    window.open(url(), "_blank", "noopener,noreferrer")
  }

  /**
   * iframe 加载态。
   *
   * `file://` 本地 HTML（尤其是带 CDN 脚本/字体的原型页）首次加载要好几秒，
   * 期间 iframe 是一片纯白 —— 看起来像"点了没反应"。这里在 iframe 上盖一层
   * 旋转指示 + 地址，等 load 事件到了再淡出。地址或刷新序号变化时立刻回到加载态。
   *
   * 兜底：某些地址（被 CSP/协议拦截）不会触发 load，20 秒后强制收起遮罩，
   * 让用户看到浏览器自己的错误页，而不是永远转圈。
   */
  const [frameLoaded, setFrameLoaded] = createSignal(false)
  const [slowHint, setSlowHint] = createSignal(false)
  let slowTimer: ReturnType<typeof setTimeout> | undefined
  let giveUpTimer: ReturnType<typeof setTimeout> | undefined
  const beginLoading = () => {
    setFrameLoaded(false)
    setSlowHint(false)
    if (slowTimer) clearTimeout(slowTimer)
    if (giveUpTimer) clearTimeout(giveUpTimer)
    slowTimer = setTimeout(() => setSlowHint(true), 4000)
    giveUpTimer = setTimeout(() => setFrameLoaded(true), 20000)
  }
  const finishLoading = () => {
    if (slowTimer) clearTimeout(slowTimer)
    if (giveUpTimer) clearTimeout(giveUpTimer)
    setFrameLoaded(true)
  }
  createEffect(
    on(
      () => [embedUrl(), store.reload] as const,
      () => beginLoading(),
      { defer: true },
    ),
  )
  onCleanup(() => {
    if (slowTimer) clearTimeout(slowTimer)
    if (giveUpTimer) clearTimeout(giveUpTimer)
  })

  return (
    <div
      id="preview-panel"
      role="region"
      aria-label={language.t("preview.title")}
      class="flex h-full min-h-0 flex-col overflow-hidden bg-panel"
    >
      <div class="flex h-10 shrink-0 items-center gap-1.5 border-b border-border bg-panel px-2">
        <div class="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-panel px-2 focus-within:border-border-hover">
          <Icon name="link" size="small" class="shrink-0 text-foreground-subtlest" />
          <input
            value={store.draft}
            onInput={(event) => {
              setStore("draft", event.currentTarget.value)
              if (store.invalid) setStore("invalid", false)
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              go()
            }}
            class="min-w-0 flex-1 bg-transparent text-12-regular text-foreground outline-none placeholder:text-foreground-subtlest"
            placeholder={language.t("preview.url.placeholder")}
            aria-label={language.t("preview.url.placeholder")}
            spellcheck={false}
            autocomplete="off"
          />
          <Show when={store.invalid}>
            <span class="shrink-0 text-11-regular text-rose-600 dark:text-rose-400">
              {language.t("preview.invalid")}
            </span>
          </Show>
        </div>
        <Show when={props.files && props.files.count() > 0}>
          <Tooltip value={language.t("preview.showFiles")} placement="top">
            <IconButton
              icon="folder"
              variant="ghost"
              onClick={() => props.files?.open()}
              aria-label={language.t("preview.showFiles")}
            />
          </Tooltip>
        </Show>
        <Tooltip
          value={inspection.ready() ? language.t("preview.pick.toggle") : language.t("preview.pick.unavailable")}
          placement="top"
        >
          <IconButton
            icon="window-cursor"
            variant="ghost"
            onClick={inspection.toggle}
            disabled={!inspection.ready()}
            classList={{
              "bg-hover text-foreground": inspection.armed(),
            }}
            aria-label={language.t("preview.pick.toggle")}
            aria-pressed={inspection.armed()}
          />
        </Tooltip>
        <Tooltip value={language.t("preview.go")} placement="top">
          <IconButton icon="enter" variant="ghost" onClick={go} aria-label={language.t("preview.go")} />
        </Tooltip>
        <Tooltip value={language.t("preview.aiOperate" as never)} placement="top">
          <IconButton
            icon="autopilot"
            variant="ghost"
            onClick={askAi}
            disabled={!url()}
            aria-label={language.t("preview.aiOperate" as never)}
          />
        </Tooltip>
        <Tooltip value={language.t("preview.refresh")} placement="top">
          <IconButton
            icon="refresh"
            variant="ghost"
            onClick={refresh}
            disabled={!url()}
            aria-label={language.t("preview.refresh")}
          />
        </Tooltip>
        <Tooltip value={language.t("preview.openExternal")} placement="top">
          <IconButton
            icon="square-arrow-top-right"
            variant="ghost"
            onClick={openExternal}
            disabled={!url()}
            aria-label={language.t("preview.openExternal")}
          />
        </Tooltip>
      </div>

      <div class="relative min-h-0 flex-1">
        {/* keyed Show 的 children 在 untrack 中执行，故把刷新序号与 URL 一起作为 when 值：任一变化都生成新对象，从而重新挂载 iframe */}
        <Show when={embedUrl() ? { target: embedUrl(), reload: store.reload } : undefined} keyed>
          {(frame) => (
            <iframe
              src={frame.target}
              title={frame.target}
              class="absolute inset-0 h-full w-full border-0"
              sandbox={IFRAME_SANDBOX}
              allow={IFRAME_ALLOW}
              referrerPolicy="no-referrer-when-downgrade"
              onLoad={finishLoading}
              ref={(element) => inspection.setFrame(element)}
            />
          )}
        </Show>
        {/* 加载遮罩：iframe 首帧到达前压住那片纯白，加载完淡出。 */}
        <Show when={embedUrl() && !frameLoaded()}>
          <div
            data-slot="preview-loading"
            class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-panel/92 backdrop-blur-[1px] transition-opacity duration-200"
          >
            <Spinner class="size-6 text-icon-blue" />
            <div class="text-12-regular text-foreground-subtle">{language.t("preview.loading")}</div>
            <div class="max-w-[80%] truncate text-11-regular text-foreground-subtlest">{url()}</div>
            <Show when={slowHint()}>
              <div class="mt-1 max-w-[80%] text-center text-11-regular leading-relaxed text-foreground-subtlest">
                {language.t("preview.loading.slow")}
              </div>
            </Show>
          </div>
        </Show>
        <Show when={!url()}>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div class="flex size-10 items-center justify-center rounded-xl border border-border bg-panel">
              <Icon name="browser" size="large" class="text-foreground-subtlest" />
            </div>
            <div class="text-14-medium text-foreground">{language.t("preview.title")}</div>
            <div class="max-w-80 text-12-regular leading-relaxed text-foreground-subtle">
              {language.t("preview.empty.description")}
            </div>
            <div class="max-w-80 text-11-regular leading-relaxed text-foreground-subtlest">
              {language.t("preview.empty.hint")}
            </div>
          </div>
        </Show>
        {/* 选中元素后先写一句评论，再决定要不要挂到对话上。
            以前点完立刻加进输入框，用户只能事后补「我是说那个蓝色按钮」。 */}
        <Show when={inspection.pending()} keyed>
          {(element) => (
            <PickCommentCard
              element={element}
              onAdd={(comment) => inspection.commit(comment)}
              onCancel={() => inspection.cancel()}
            />
          )}
        </Show>
      </div>
    </div>
  )
}

/**
 * 元素评论卡：贴在预览区底部。
 * 内容为空也允许添加 —— 相当于「就是这块，你自己看」，模型仍能拿到元素说明。
 */
function PickCommentCard(props: { element: PickedElement; onAdd: (comment: string) => void; onCancel: () => void }) {
  const language = useLanguage()
  const [draft, setDraft] = createSignal("")
  let area: HTMLTextAreaElement | undefined

  onMount(() => area?.focus())

  return (
    <div
      data-component="preview-pick-comment"
      class="absolute inset-x-3 bottom-3 z-20 mx-auto flex max-w-[560px] flex-col gap-2 rounded-xl border border-border bg-popover p-3 shadow-[var(--shadow-md)]"
    >
      <div class="flex min-w-0 items-center gap-1.5">
        <Icon name="window-cursor" size="small" class="shrink-0 text-foreground-subtle" />
        <span class="truncate text-12-medium text-foreground">{pickedElementLabel(props.element)}</span>
        <span class="ml-auto shrink-0 text-11-regular text-foreground-subtlest">
          {language.t("preview.pick.commentTitle")}
        </span>
      </div>
      <textarea
        ref={area}
        value={draft()}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            props.onCancel()
            return
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            props.onAdd(draft())
          }
        }}
        placeholder={language.t("preview.pick.commentPlaceholder")}
        class="min-h-16 w-full resize-y rounded-lg border border-border bg-background p-2 text-12-regular leading-relaxed text-foreground outline-none transition-colors focus:border-border-hover"
      />
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-11-regular text-foreground-subtlest">
          {language.t("preview.pick.commentHint")}
        </span>
        <button
          type="button"
          class="rounded-lg px-2.5 py-1.5 text-12-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
          onClick={() => props.onCancel()}
        >
          {language.t("common.cancel")}
        </button>
        <button
          type="button"
          data-action="preview-pick-add"
          class="rounded-lg border border-emerald-300/45 bg-emerald-300/12 px-3 py-1.5 text-12-medium text-emerald-100 transition-colors hover:bg-emerald-300/20"
          onClick={() => props.onAdd(draft())}
        >
          {language.t("preview.pick.add")}
        </button>
      </div>
    </div>
  )
}
