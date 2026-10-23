import { Show, createEffect, createMemo, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { locateSnippet } from "@/utils/knowledge-locate"

/**
 * 原文视图：纯文本渲染 + 引用片段定位。
 *
 * Markdown 渲染无法可靠地把「源文偏移」映射到 DOM，所以引用定位单独走这个视图：
 * 保留原始换行、按字符区间切段，把命中片段包进 <mark> 并滚到可见区域。
 */
export function KnowledgeTextView(props: {
  text: string
  snippet?: string
  /** 检索命中的切片偏移：用它定位比按关键词搜更准。 */
  offset?: number
  class?: string
}): JSX.Element {
  const language = useLanguage()
  let markRef: HTMLElement | undefined

  const located = createMemo(() => locateSnippet(props.text, props.snippet, props.offset))
  const before = createMemo(() => {
    const hit = located()
    return hit ? props.text.slice(0, hit.start) : props.text
  })
  const match = createMemo(() => {
    const hit = located()
    return hit ? props.text.slice(hit.start, hit.end) : ""
  })
  const after = createMemo(() => {
    const hit = located()
    return hit ? props.text.slice(hit.end) : ""
  })

  createEffect(() => {
    // 片段变化后把高亮滚进视野（block:center 比 start 更不容易被顶栏遮住）。
    if (!located()) return
    markRef?.scrollIntoView({ block: "center", behavior: "smooth" })
  })

  return (
    <div class="flex flex-col gap-1.5">
      <Show when={located()}>
        <div class="flex items-center gap-2 text-11-regular text-foreground-subtlest">
          <span class="rounded bg-[color-mix(in_srgb,#f59e0b_22%,transparent)] px-1.5 py-0.5 text-[#b45309]">
            {language.t("knowledge.locate.found")}
          </span>
          <span>{language.t("knowledge.locate.mode." + located()!.mode)}</span>
        </div>
      </Show>
      <div class={"overflow-y-auto rounded-lg border border-border bg-surface/60 p-4 " + (props.class ?? "")}>
        <pre class="whitespace-pre-wrap break-words font-sans text-13-regular leading-6 text-foreground">
          {before()}
          <Show when={match()}>
            <mark
              ref={markRef}
              data-component="knowledge-citation-mark"
              class="rounded bg-[color-mix(in_srgb,#f59e0b_34%,transparent)] px-0.5 text-foreground"
            >
              {match()}
            </mark>
          </Show>
          {after()}
        </pre>
      </div>
    </div>
  )
}
