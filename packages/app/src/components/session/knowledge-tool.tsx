import { For, Show, createSignal } from "solid-js"
import { KnowledgeTextView } from "./knowledge-text-view"
import type { KnowledgeHit } from "@novaway/sdk/v2"
import { useDialog } from "@novaway/ui/context/dialog"
import { Dialog } from "@novaway/ui/dialog"
import { Icon } from "@novaway/ui/icon"
import { Markdown } from "@novaway/ui/markdown"
import { BasicTool, ToolRegistry } from "@novaway/ui/message-part"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

type Citation = {
  index: number
  via?: "hybrid" | "graph"
  title: string
  documentID: string
  collectionID: string
  chunk?: number
  snippet?: string
}

/**
 * 知识库检索工具行。
 *
 * 除了常规的工具行，额外把引用列成可点击的芯片：
 * 点一下直接打开原文（Markdown 渲染），满足「回答里能看到来源、点进去看原文」。
 * 工具注册放在 app 层：UI 包拿不到 SDK 上下文。
 */
export function KnowledgeToolComponent(props: {
  input: Record<string, any>
  metadata: Record<string, any>
  output?: string
  status?: string
}) {
  const language = useLanguage()
  const sdk = useSDK()
  const dialog = useDialog()
  const [opening, setOpening] = createSignal<string>()
  const [view, setView] = createSignal<"doc" | "source">("doc")

  const citations = (): Citation[] => {
    const value = props.metadata?.citations
    return Array.isArray(value) ? (value as Citation[]) : []
  }
  const hits = (): KnowledgeHit[] => {
    const value = props.metadata?.hits
    return Array.isArray(value) ? (value as KnowledgeHit[]) : []
  }
  const query = () => (typeof props.input?.query === "string" ? props.input.query : "")
  const count = () => (typeof props.metadata?.count === "number" ? props.metadata.count : citations().length)

  const open = (citation: Citation) => {
    setOpening(citation.documentID)
    setView(citation.snippet ? "source" : "doc")
    void sdk.client.knowledge
      .document({ directory: sdk.directory, collectionID: citation.collectionID, documentID: citation.documentID })
      .then((result) => {
        const document = result.data
        if (!document) return
        dialog.show(() => (
          <Dialog
            title={document.title}
            transition
            class="w-[min(calc(100vw-40px),860px)] max-h-[calc(100vh-80px)] overflow-hidden"
          >
            <div class="flex max-h-[calc(100vh-160px)] flex-col gap-3 overflow-y-auto px-2.5 pb-3">
              <div class="flex flex-wrap items-center gap-3 text-12-regular text-foreground-subtle">
                <span>{language.t("knowledge.citation.index", { index: citation.index })}</span>
                <Show when={citation.chunk !== undefined}>
                  <span>{language.t("knowledge.citation.chunk", { chunk: (citation.chunk ?? 0) + 1 })}</span>
                </Show>
                <Show when={document.source}>
                  <span>{document.source}</span>
                </Show>
              </div>
              <Show when={citation.snippet}>
                {(snippet) => (
                  <div class="rounded-lg border border-[color-mix(in_srgb,#10b981_35%,var(--border))] bg-[color-mix(in_srgb,#10b981_8%,transparent)] p-3">
                    <div class="mb-1 text-11-medium text-[#059669]">{language.t("knowledge.citation.snippet")}</div>
                    <div class="text-12-regular leading-5 text-foreground">{snippet()}</div>
                  </div>
                )}
              </Show>
              <div class="flex items-center gap-1 self-start rounded-lg bg-surface p-0.5">
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1 text-11-medium transition-colors"
                  classList={{
                    "bg-background text-foreground shadow-sm": view() === "doc",
                    "text-foreground-subtle hover:text-foreground": view() !== "doc",
                  }}
                  onClick={() => setView("doc")}
                >
                  {language.t("knowledge.view.doc")}
                </button>
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1 text-11-medium transition-colors"
                  classList={{
                    "bg-background text-foreground shadow-sm": view() === "source",
                    "text-foreground-subtle hover:text-foreground": view() !== "source",
                  }}
                  onClick={() => setView("source")}
                >
                  {language.t("knowledge.view.source")}
                </button>
              </div>
              <Show
                when={view() === "source"}
                fallback={
                  <div class="rounded-lg border border-border bg-surface/60 p-4 text-13-regular leading-6 text-foreground">
                    <Markdown text={document.content} cacheKey={"kb:" + document.id + ":" + document.updatedAt} />
                  </div>
                }
              >
                <KnowledgeTextView text={document.content} snippet={citation.snippet} class="max-h-[min(52vh,30rem)]" />
              </Show>
              <div class="flex justify-end">
                <button
                  type="button"
                  class="rounded-md px-3 py-1.5 text-ui-base text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                  onClick={() => dialog.close()}
                >
                  {language.t("common.close")}
                </button>
              </div>
            </div>
          </Dialog>
        ))
      })
      .catch((error: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setOpening(undefined))
  }

  return (
    <BasicTool
      {...props}
      icon="review"
      trigger={{
        title: language.t("knowledge.tool.title"),
        subtitle: query(),
        args: [language.t("knowledge.tool.hits", { count: count() })],
      }}
    >
      <div class="flex flex-col gap-2 p-2">
        <Show
          when={citations().length > 0}
          fallback={<div class="text-12-regular text-foreground-subtle">{language.t("knowledge.tool.empty")}</div>}
        >
          <div class="flex flex-wrap gap-1.5">
            <For each={citations()}>
              {(citation) => (
                <button
                  type="button"
                  data-component="knowledge-citation"
                  class="group inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-12-regular text-foreground transition-colors hover:border-[color-mix(in_srgb,#10b981_45%,var(--border))] hover:bg-[color-mix(in_srgb,#10b981_10%,transparent)]"
                  title={citation.title}
                  onClick={() => open(citation)}
                >
                  <span class="shrink-0 rounded bg-[color-mix(in_srgb,#10b981_16%,transparent)] px-1 text-11-medium text-[#059669]">
                    [{citation.index}]
                  </span>
                  <span class="min-w-0 truncate">{citation.title}</span>
                  <Show when={citation.via === "graph"}>
                    <span class="shrink-0 rounded bg-surface px-1 text-[10px] text-foreground-subtle">
                      {language.t("knowledge.tool.related")}
                    </span>
                  </Show>
                  <Show when={opening() === citation.documentID}>
                    <span class="size-3 shrink-0 animate-spin rounded-full border border-current border-t-transparent" />
                  </Show>
                  <Icon
                    name="square-arrow-top-right"
                    size="small"
                    class="shrink-0 text-foreground-subtlest group-hover:text-foreground-subtle"
                  />
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={hits().length > 0}>
          <div class="flex flex-col gap-1.5">
            <For each={hits()}>
              {(hit, index) => (
                <div class="flex flex-col gap-0.5 rounded-md border border-border/60 px-2 py-1.5">
                  <div class="flex items-center gap-1.5 text-12-medium text-foreground">
                    <span class="text-foreground-subtlest">[{index() + 1}]</span>
                    <span class="min-w-0 truncate">{hit.title}</span>
                  </div>
                  <span class="line-clamp-2 text-12-regular text-foreground-subtle">{hit.snippet}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </BasicTool>
  )
}

ToolRegistry.register({ name: "knowledge_search", render: KnowledgeToolComponent })
