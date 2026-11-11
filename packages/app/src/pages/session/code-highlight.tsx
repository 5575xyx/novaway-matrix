/**
 * 纯文本编辑器的语法着色层。
 *
 * 编辑本体仍然是 `<textarea>` —— 输入法、选区、撤销、可访问性全交给浏览器；
 * 这一层只是把同一段文字用 Shiki 上色后垫在下面，textarea 的字在
 * 「着色已同步」时设为透明。三者必须严格对齐：字体、字号、行高、padding
 * 都从 textarea 的 class 继承，滚动由外层 translate 跟随。
 *
 * 为什么只在停顿后着色：Shiki 是整篇重算，几千行的文件每次按键都算一遍
 * 会卡输入。着色期间文字先按普通颜色显示（绝不隐藏刚打的字），停顿 180ms
 * 后一次性换成彩色；正在打字时看到的就是普通文本，停下来才上色。
 */

import { createEffect, createSignal, on, onCleanup, type Component } from "solid-js"
import { getSharedHighlighter } from "@pierre/diffs"
import { bundledLanguages, type BundledLanguage } from "shiki"
import { syntaxLanguageOf } from "@novaway/core/office/text/language"

/** 超过这个体积就不着色：全量高亮的代价会盖过观感收益。 */
const MAX_HIGHLIGHT_CHARS = 120_000
const IDLE_MS = 180

type Highlighter = Awaited<ReturnType<typeof getSharedHighlighter>>

let shared: Promise<Highlighter> | undefined
function highlighter() {
  // 和 Markdown 渲染共用同一个实例：主题（NovaWay）和已加载语言都复用。
  shared ??= getSharedHighlighter({ themes: ["NovaWay"], langs: [], preferredHighlighter: "shiki-wasm" })
  return shared
}

type Props = {
  text: string
  /** 用来认语言；纯文本文件会返回 undefined。 */
  path?: string
  scrollTop: number
  scrollLeft: number
  /** 着色与当前文字一致时为 true；textarea 据此决定是否把字设成透明。 */
  onSync?: (synced: boolean) => void
}

export const CodeHighlight: Component<Props> = (props) => {
  const [html, setHtml] = createSignal("")
  let sequence = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const clear = () => {
    sequence += 1
    setHtml("")
    props.onSync?.(false)
  }

  createEffect(
    on(
      () => [props.text, props.path] as const,
      ([text, target]) => {
        if (timer) clearTimeout(timer)
        const language = syntaxLanguageOf(target)
        if (!language || text.length > MAX_HIGHLIGHT_CHARS) {
          clear()
          return
        }
        // 文字变了就立刻回到「普通文本」：新打的字必须是可见的。
        // 同时推进序号，让上一次还在路上的着色结果作废。
        sequence += 1
        props.onSync?.(false)
        timer = setTimeout(() => {
          const current = ++sequence
          void (async () => {
            try {
              const h = await highlighter()
              if (disposed || current !== sequence) return
              if (!h.getLoadedLanguages().includes(language)) {
                await h.loadLanguage(language as BundledLanguage)
              }
              if (disposed || current !== sequence) return
              const next = h
                .codeToHtml(text, { lang: language as BundledLanguage, theme: "NovaWay" })
                // pre 的 tabindex 会多一个 Tab 停靠点；外层已经 pointer-events: none。
                .replace(' tabindex="0"', "")
              if (disposed || current !== sequence) return
              setHtml(next)
              props.onSync?.(true)
            } catch {
              // 着色失败不影响编辑：保持普通文本。
              if (!disposed && current === sequence) clear()
            }
          })()
        }, IDLE_MS)
      },
    ),
  )

  onCleanup(() => {
    disposed = true
    if (timer) clearTimeout(timer)
  })

  return (
    <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        data-component="code-highlight"
        class="font-mono text-13 leading-6"
        style={{ transform: `translate(${-props.scrollLeft}px, ${-props.scrollTop}px)` }}
        innerHTML={html()}
      />
    </div>
  )
}
