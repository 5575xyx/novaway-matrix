/**
 * Markdown 实况预览（Obsidian 式 live preview）。
 *
 * 整篇按块渲染成最终样子；**双击哪一行，那一行就变回源码** ——
 * `#`、`**`、`[]()` 这些标记只在正在编辑的那一行里出现，同一块里的其它行
 * 仍然是排版后的样子（粒度到「光标所在行」）。
 * 围栏代码块和表格是天然的多行结构，拆成单行就没有意义，仍然整块编辑。
 *
 * 提交时只把这一行（或整块）的源码拼回原文（`replaceMarkdownRange`），
 * 区间外的字符、换行符、前后空行都逐字保留，所以不会因为「预览」而重排整篇。
 *
 * 为什么用 textarea 而不是一个 contenteditable：富文本编辑器的光标、输入法、
 * 撤销和 Markdown 语法会互相打架；逐行切换成 textarea 能把这三件事都交还给浏览器，
 * 同时保留「只有正在编辑的行露出标记」这一实况预览的核心体验。
 */

import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { Markdown } from "@novaway/ui/markdown"
import {
  replaceMarkdownRange,
  splitMarkdownBlocks,
  splitMarkdownLines,
  type MarkdownBlock,
  type MarkdownLine,
} from "@novaway/core/office/text/live-preview"

type Props = {
  text: string
  /** 和阅读视图一致：点文件链接时由外面开标签。 */
  onFileOpen?: (path: string) => void
  /** 点 `[[wikilink]]`：目标原样交回，由外面按当前文件解析成路径再打开。 */
  onWikiLink?: (target: string) => void
  /** 提交一行或一块的新源码时把整篇新文本交回去（外部负责写草稿 + 保存）。 */
  onChange: (next: string) => void
}

type Editing = {
  /** 正在编辑的字符区间（行级编辑时就是那一行的区间）。 */
  start: number
  end: number
  /** 进入编辑时的原文，用来判断有没有真的改动。 */
  original: string
  /** 编辑器里的当前内容（可能已经被改成多行）。 */
  source: string
  /** 围栏代码块 / 表格整块编辑；其余是单行编辑。 */
  whole: boolean
}

export function MarkdownLive(props: Props) {
  const blocks = () => splitMarkdownBlocks(props.text)
  const allLines = createMemo(() => splitMarkdownLines(props.text))
  // 正在编辑的区间用「首尾偏移 + 原文」认出，文本变化后行号漂移也不会编辑到别处。
  const [editing, setEditing] = createSignal<Editing | null>(null)
  // Esc 取消：blur 会再触发一次 commit，这个标记让它跳过并立刻复位
  // （万一 blur 没发生 —— 元素先被移除 —— 下一帧也会自动恢复）。
  let cancelled = false

  // 外部改了内容（AI 写入、跟写、撤销）：正在编辑的这一行已经对不上原文，
  // 直接退出编辑而不是把用户没提交的字盖到新内容上。
  createEffect(
    on(
      () => props.text,
      () => {
        if (editing()) setEditing(null)
      },
      { defer: true },
    ),
  )

  const begin = (line: { start: number; end: number; source: string }, whole: boolean) => {
    setEditing({ start: line.start, end: line.end, original: line.source, source: line.source, whole })
  }

  const commit = () => {
    const current = editing()
    if (!current) return
    if (cancelled) {
      cancelled = false
      return
    }
    setEditing(null)
    if (current.source === current.original) return
    props.onChange(replaceMarkdownRange(props.text, current.start, current.end, current.source))
  }

  const autosize = (element: HTMLTextAreaElement) => {
    element.style.height = "auto"
    element.style.height = element.scrollHeight + "px"
  }

  const editor = (current: () => Editing) => (
    <div class="my-1" data-action="markdown-live-editor">
      <textarea
        class="block w-full resize-none rounded-md border border-border-hover bg-background px-2 py-1.5 font-mono text-13 leading-6 text-foreground outline-none"
        spellcheck={false}
        value={current().source}
        ref={(element) => {
          requestAnimationFrame(() => {
            autosize(element)
            element.focus()
            element.setSelectionRange(element.value.length, element.value.length)
          })
        }}
        onInput={(event) => {
          autosize(event.currentTarget)
          const active = editing()
          if (active) setEditing({ ...active, source: event.currentTarget.value })
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            cancelled = true
            const element = event.currentTarget
            setEditing(null)
            element.blur()
            queueMicrotask(() => {
              cancelled = false
            })
            return
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
      />
      <div class="pb-1 text-11-regular text-foreground-subtlest">Esc 取消 · ⌘/Ctrl+Enter 保存 · 点别处也会保存</div>
    </div>
  )

  /**
   * 任务列表的复选框可以直接点：和 Obsidian 一样，点一下就把这一行的 `[ ]` / `[x]`
   * 翻过来写回原文，不用双击进源码模式。认不出任务行时什么也不做。
   */
  const toggleTask = (line: MarkdownLine) => {
    const match = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(line.source)
    if (!match) return false
    const next = match[2]!.trim() === "" ? "x" : " "
    // 标记位就在 `- [` 之后；不能用 indexOf(空格) —— 列表符号后面本来就有空格。
    const at = match[1]!.length
    const source = line.source.slice(0, at) + next + line.source.slice(at + 1)
    props.onChange(replaceMarkdownRange(props.text, line.start, line.end, source))
    return true
  }

  const renderedLine = (block: MarkdownBlock, line: MarkdownLine) => (
    <div
      data-action="markdown-live-line"
      data-live-line={line.number}
      class="md-live-line cursor-text rounded-sm transition-colors hover:bg-hover/40"
      classList={{ "is-inline": block.kind === "paragraph" }}
      title="点击修改这一行"
      onClick={(event) => {
        const target = event.target
        if (target instanceof HTMLInputElement && target.type === "checkbox") {
          event.preventDefault()
          toggleTask(line)
          return
        }
        if (target instanceof Element && target.closest("a, button")) return
        begin(line, false)
      }}
    >
      <Markdown
        text={line.source}
        onFileOpen={props.onFileOpen}
        onWikiLink={props.onWikiLink}
        onTaskToggle={() => toggleTask(line)}
      />
    </div>
  )

  const renderedBlock = (block: MarkdownBlock) => (
    <div
      data-action="markdown-live-block"
      class="cursor-text rounded-md transition-colors hover:bg-hover/40"
      title="点击修改"
      onClick={(event) => {
        // 链接和复选框照常工作 —— 用户点它们时想要的是跳转/勾选，不是编辑。
        const target = event.target
        if (!(target instanceof Element)) return
        if (target.closest("a, input, button")) return
        begin(block, true)
      }}
    >
      <Markdown text={block.source} onFileOpen={props.onFileOpen} onWikiLink={props.onWikiLink} />
    </div>
  )

  return (
    <div data-component="markdown-live" class="flex flex-col">
      <For each={blocks()}>
        {(block) => {
          const lines = () =>
            allLines().filter((line) => line.number >= block.firstLine && line.number <= block.lastLine)
          const whole = () => block.kind === "fence" || block.kind === "table"
          const active = () => editing()
          return (
            <div class="group relative" data-live-block={block.index} data-live-kind={block.kind}>
              <Show
                when={whole()}
                fallback={
                  <For each={lines()}>
                    {(line) => (
                      <Show
                        when={!active()?.whole && active()?.start === line.start && active()?.end === line.end}
                        fallback={renderedLine(block, line)}
                      >
                        {editor(() => active()!)}
                      </Show>
                    )}
                  </For>
                }
              >
                <Show
                  when={active()?.whole && active()?.start === block.start && active()?.end === block.end}
                  fallback={renderedBlock(block)}
                >
                  {editor(() => active()!)}
                </Show>
              </Show>
            </div>
          )
        }}
      </For>
      <Show when={blocks().length === 0}>
        <div class="py-1 text-12-regular text-foreground-subtlest" data-action="markdown-live-empty">
          空文档。从这里开始写就行。
        </div>
        <textarea
          data-action="markdown-live-editor"
          class="mt-1 block min-h-16 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 font-mono text-13 leading-6 text-foreground outline-none focus:border-border-hover"
          spellcheck={false}
          placeholder="# 标题"
          onBlur={(event) => {
            const next = event.currentTarget.value
            if (next.trim().length > 0) props.onChange(next)
          }}
        />
      </Show>
    </div>
  )
}
