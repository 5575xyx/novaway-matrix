import { createEffect, createMemo, createSignal, For, on, Show, type Component } from "solid-js"
import { Dynamic } from "solid-js/web"
import { parseRichBlocks, type RichBlock } from "@novaway/core/office/rich/model"
import { showToast } from "@novaway/ui/toast"

/**
 * 富文本（HTML）编辑器：设计视图 + 源码视图。
 *
 * 对齐 Weave 的 `crates/rich-editor`：**HTML 文本本身就是文档**。
 * 两个视图编辑的是同一份文本，所以不存在「设计态和源码对不上」；
 * 保存只重写被改过的那个块（或者源码视图里的整篇），文档头、样式表、
 * 没动过的段落逐字节不变。
 *
 * 设计视图每段独立 contenteditable：用户改一段时，别的段落的原始标记
 * 不会被浏览器的序列化顺手改写。
 */

export type RichOp = Record<string, unknown> & { op: string }

export type RichFilePreviewProps = {
  /** 当前 HTML 文本（从文件读出来的内容）。 */
  content: string
  /** 保存单个块：只发被改过的那一段。 */
  onSaveBlock?: (block: number, html: string) => Promise<void>
  /** 结构操作：换段落类型、改对齐等。 */
  onSaveOps?: (ops: RichOp[]) => Promise<void>
  /** 保存源码视图里的整篇 HTML。 */
  onSaveSource?: (html: string) => Promise<void>
}

type ListGroup = { list: "ul" | "ol"; items: RichBlock[] }
type Item = { kind: "block"; block: RichBlock } | { kind: "list"; group: ListGroup }

const BLOCK_CHOICES = [
  { tag: "p", label: "正文" },
  { tag: "h1", label: "标题 1" },
  { tag: "h2", label: "标题 2" },
  { tag: "h3", label: "标题 3" },
  { tag: "blockquote", label: "引用" },
  { tag: "pre", label: "代码块" },
] as const

const ALIGN_CHOICES = [
  { align: "left", label: "左" },
  { align: "center", label: "中" },
  { align: "right", label: "右" },
  { align: "justify", label: "两端" },
] as const

/** 连续的列表项合成一个 ul/ol，否则 DOM 结构不合法。 */
function groupItems(blocks: RichBlock[]): Item[] {
  const items: Item[] = []
  for (const block of blocks) {
    if (block.tag === "li" && block.list) {
      const last = items.at(-1)
      if (last?.kind === "list" && last.group.list === block.list) {
        last.group.items.push(block)
        continue
      }
      items.push({ kind: "list", group: { list: block.list, items: [block] } })
      continue
    }
    items.push({ kind: "block", block })
  }
  return items
}

export const RichFilePreview: Component<RichFilePreviewProps> = (props) => {
  const [html, setHtml] = createSignal(props.content)
  const [mode, setMode] = createSignal<"design" | "source">("design")
  const [active, setActive] = createSignal<number>()
  const [source, setSource] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  // 文件被重新读出来（自己保存或 Agent 改完）时同步，但不要打断正在编辑的段。
  createEffect(
    on(
      () => props.content,
      (value) => {
        if (value !== html()) setHtml(value)
      },
      { defer: true },
    ),
  )

  const blocks = createMemo(() => parseRichBlocks(html()))
  const items = createMemo(() => groupItems(blocks()))
  const activeBlock = createMemo(() => blocks().find((block) => block.index === active()))

  const innerOf = (block: RichBlock) => html().slice(block.textStart, block.textEnd)

  const run = async (task: () => Promise<void>, title: string) => {
    if (saving()) return
    setSaving(true)
    try {
      await task()
    } catch (error) {
      showToast({
        variant: "error",
        title,
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  /** 设计视图：只发改过的那一段，保存的是它的 innerHTML。 */
  const commitBlock = (block: RichBlock, element: HTMLElement) => {
    const inner = element.innerHTML
    const original = innerOf(block)
    if (inner === original) return
    if (!props.onSaveBlock) {
      element.innerHTML = original
      showToast({ variant: "error", title: "无法保存", description: "这个预览没有写回通道。" })
      return
    }
    void run(async () => {
      await props.onSaveBlock!(block.index, inner)
      // 本地也同步一份，等待上层重读期间不会看到旧内容。
      const updated = html().slice(0, block.textStart) + inner + html().slice(block.textEnd)
      setHtml(updated)
    }, "保存失败")
  }

  const switchMode = (next: "design" | "source") => {
    if (next === "source") setSource(html())
    setActive(undefined)
    setMode(next)
  }

  const saveSource = () => {
    const value = source()
    if (value === html()) return
    if (!props.onSaveSource && !props.onSaveOps) return
    void run(async () => {
      if (props.onSaveSource) await props.onSaveSource(value)
      else await props.onSaveOps!([{ op: "setText", text: value }])
      setHtml(value)
      showToast({ title: "已保存", description: "整篇 HTML 已写回，编码与换行符保持不变。" })
    }, "保存失败")
  }

  const applyBlockOp = (op: RichOp) => {
    if (!props.onSaveOps) return
    void run(async () => {
      await props.onSaveOps!([op])
    }, "保存失败")
  }

  const exec = (command: string, value?: string) => {
    // execCommand 处理「选区上的行内格式」，是浏览器里最贴近 contenteditable
    // 语义的实现；保存时再由 setBlockHtml 统一规范成 strong/em/u/s/span。
    document.execCommand(command, false, value)
  }


  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <div class="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <div class="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
          <button
            type="button"
            data-action="rich-mode-design"
            class={[
              "rounded px-2 py-1 text-11-medium transition-colors",
              mode() === "design" ? "bg-hover text-foreground" : "text-foreground-subtle hover:text-foreground",
            ].join(" ")}
            onClick={() => switchMode("design")}
          >
            设计
          </button>
          <button
            type="button"
            data-action="rich-mode-source"
            class={[
              "rounded px-2 py-1 text-11-medium transition-colors",
              mode() === "source" ? "bg-hover text-foreground" : "text-foreground-subtle hover:text-foreground",
            ].join(" ")}
            onClick={() => switchMode("source")}
          >
            源码
          </button>
        </div>

        <Show when={mode() === "design" ? activeBlock() : undefined}>
          {(block) => (
            <>
              <select
                class="h-6 rounded border border-border bg-background px-1 text-11-regular text-foreground outline-none"
                value={block().tag}
                disabled={saving()}
                onChange={(event) =>
                  applyBlockOp({ op: "setBlockType", block: block().index, tag: event.currentTarget.value })
                }
              >
                <For each={BLOCK_CHOICES}>{(choice) => <option value={choice.tag}>{choice.label}</option>}</For>
                <Show when={!BLOCK_CHOICES.some((choice) => choice.tag === block().tag)}>
                  <option value={block().tag}>{block().tag}</option>
                </Show>
              </select>
              <For each={ALIGN_CHOICES}>
                {(choice) => (
                  <button
                    type="button"
                    title={choice.label + "对齐"}
                    class={[
                      "grid size-6 place-items-center rounded border text-11-medium transition-colors",
                      block().align === choice.align
                        ? "border-emerald-300/60 bg-emerald-300/15 text-emerald-100"
                        : "border-transparent text-foreground-subtle hover:bg-hover hover:text-foreground",
                    ].join(" ")}
                    disabled={saving()}
                    onClick={() =>
                      applyBlockOp({ op: "setBlockAlign", block: block().index, align: choice.align })
                    }
                  >
                    {choice.label}
                  </button>
                )}
              </For>
              <span class="mx-0.5 h-4 w-px bg-border" />
              <For
                each={
                  [
                    { label: "B", title: "加粗", command: "bold" },
                    { label: "I", title: "斜体", command: "italic" },
                    { label: "U", title: "下划线", command: "underline" },
                    { label: "S", title: "删除线", command: "strikeThrough" },
                  ] as const
                }
              >
                {(item) => (
                  <button
                    type="button"
                    title={item.title}
                    class="grid size-6 place-items-center rounded border border-transparent text-11-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                    disabled={saving()}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      exec(item.command)
                    }}
                  >
                    {item.label}
                  </button>
                )}
              </For>
              <label class="flex items-center gap-1 text-11-regular text-foreground-subtlest" title="文字颜色">
                字
                <input
                  type="color"
                  class="size-5 cursor-pointer rounded border border-border bg-transparent p-0"
                  onChange={(event) => exec("foreColor", event.currentTarget.value)}
                />
              </label>
              <label class="flex items-center gap-1 text-11-regular text-foreground-subtlest" title="高亮颜色">
                亮
                <input
                  type="color"
                  class="size-5 cursor-pointer rounded border border-border bg-transparent p-0"
                  onChange={(event) => exec("hiliteColor", event.currentTarget.value)}
                />
              </label>
            </>
          )}
        </Show>

        <span class="ml-auto shrink-0 text-11-regular text-foreground-subtlest">
          {mode() === "design"
            ? saving()
              ? "保存中…"
              : "点段落编辑，失焦自动保存"
            : "⌘/Ctrl+S 保存整篇"}
        </span>
      </div>

      <Show when={mode() === "design"}>
        <div class="min-h-0 flex-1 overflow-auto px-6 py-5">
          <div class="mx-auto w-full max-w-3xl space-y-2 text-14-regular leading-relaxed text-foreground">
            <For each={items()}>
              {(item) =>
                item.kind === "list" ? (
                  <Dynamic
                    component={item.group.list}
                    class={item.group.list === "ol" ? "list-decimal pl-6" : "list-disc pl-6"}
                  >
                    <For each={item.group.items}>
                      {(block) => (
                        <li
                          class="outline-offset-2"
                          contentEditable={block.editable || undefined}
                          onFocus={() => setActive(block.index)}
                          onBlur={(event) => commitBlock(block, event.currentTarget)}
                          title={block.editable ? undefined : block.reason}
                          innerHTML={block.editable ? innerOf(block) : undefined}
                        >
                          {block.editable ? undefined : block.text}
                        </li>
                      )}
                    </For>
                  </Dynamic>
                ) : (
                  <Dynamic
                    component={item.block.tag}
                    class="outline-offset-2"
                    classList={{ "opacity-60": !item.block.editable }}
                    contentEditable={item.block.editable || undefined}
                    onFocus={() => setActive(item.block.index)}
                    onBlur={(event: FocusEvent & { currentTarget: HTMLElement }) =>
                      commitBlock(item.block, event.currentTarget)
                    }
                    title={item.block.editable ? undefined : (item.block.reason ?? "这一段暂不支持编辑")}
                    // 不可编辑的块只显示纯文字：表格/脚本/自定义元素不经过 innerHTML，
                    // 免得把文件里的脚本或事件属性带进渲染进程。
                    innerHTML={item.block.editable ? innerOf(item.block) : undefined}
                  >
                    {item.block.editable ? undefined : item.block.text}
                  </Dynamic>
                )
              }
            </For>
          </div>
        </div>
      </Show>

      <Show when={mode() === "source"}>
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <span class="min-w-0 flex-1 truncate text-11-regular text-foreground-subtlest">
              这是文件的真实内容；设计视图和它永远一致
            </span>
            <button
              type="button"
              data-action="rich-source-save"
              class="rounded-lg border border-emerald-300/45 bg-emerald-300/12 px-3 py-1 text-12-medium text-emerald-100 transition-colors hover:bg-emerald-300/20 disabled:opacity-50"
              disabled={saving() || source() === html()}
              onClick={saveSource}
            >
              {saving() ? "保存中…" : "保存"}
            </button>
          </div>
          <textarea
            class="min-h-0 flex-1 resize-none bg-background px-4 py-3 font-mono text-12 leading-6 text-foreground outline-none"
            spellcheck={false}
            value={source()}
            onInput={(event) => setSource(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault()
                saveSource()
              }
            }}
          />
        </div>
      </Show>
    </div>
  )
}
