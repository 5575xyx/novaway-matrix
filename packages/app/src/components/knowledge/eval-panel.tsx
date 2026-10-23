import type {
  KnowledgeDocumentMeta,
  KnowledgeEvalCase,
  KnowledgeEvalDiff,
  KnowledgeEvalHistoryEntry,
  KnowledgeEvalRun,
} from "@novaway/sdk/v2"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { showToast } from "@novaway/ui/toast"
import { For, Show, createMemo, createSignal, onMount, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { EvalTrendChart } from "./eval-trend"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"

const K_OPTIONS = [3, 5, 10]
const num = (input: unknown): number => {
  if (typeof input === "number" && Number.isFinite(input)) return input
  const parsed = Number(input)
  return Number.isFinite(parsed) ? parsed : 0
}

const percent = (input: unknown) => Math.round(num(input) * 1000) / 10 + "%"

/**
 * 检索评测面板。
 *
 * 用例 = 「问题 + 期望命中的文档」。跑一次就能看到 hit rate / recall / MRR / 延迟，
 * 改切片大小、RRF 权重、图谱扩展前后各跑一遍，效果好坏有数字依据。
 */
export const KnowledgeEvalPanel: Component<{
  directory: () => string
  collectionID: () => string | undefined
  documents: () => KnowledgeDocumentMeta[]
}> = (props) => {
  const language = useLanguage()
  const sdk = useGlobalSDK()
  const [cases, setCases] = createSignal<KnowledgeEvalCase[]>([])
  const [run, setRun] = createSignal<KnowledgeEvalRun>()
  const [history, setHistory] = createSignal<KnowledgeEvalHistoryEntry[]>([])
  const [diff, setDiff] = createSignal<KnowledgeEvalDiff>()
  const changed = createMemo(() => {
    const value = diff()
    return value && hasChanges(value) ? value : undefined
  })
  const [busy, setBusy] = createSignal(false)
  const [k, setK] = createSignal(5)
  const [form, setForm] = createStore({ query: "", notes: "" })
  const [picked, setPicked] = createSignal<string[]>([])
  const [editing, setEditing] = createSignal<string>()

  const titleOf = (id: string) => props.documents().find((doc) => doc.id === id)?.title ?? id

  const load = () => {
    const id = props.collectionID()
    if (!id) return
    void sdk.client.knowledge
      .listEvalCases({ directory: props.directory(), collectionID: id })
      .then((result) => setCases(result.data ?? []))
      .catch(() => setCases([]))
    void sdk.client.knowledge.eval
      .history({ directory: props.directory(), collectionID: id })
      .then((result) => setHistory(result.data?.runs ?? []))
      .catch(() => setHistory([]))
    void sdk.client.knowledge.eval
      .diff({ directory: props.directory(), collectionID: id })
      .then((result) => setDiff(result.data ?? undefined))
      .catch(() => setDiff(undefined))
  }

  onMount(load)

  const reset = () => {
    setForm({ query: "", notes: "" })
    setPicked([])
    setEditing(undefined)
  }

  const save = () => {
    const id = props.collectionID()
    if (!id) return
    const query = form.query.trim()
    if (!query) return showToast({ title: language.t("knowledge.eval.needQuery") })
    if (picked().length === 0) return showToast({ title: language.t("knowledge.eval.needDocs") })
    setBusy(true)
    void sdk.client.knowledge
      .saveEvalCase({
        directory: props.directory(),
        collectionID: id,
        ...(editing() ? { id: editing() } : {}),
        query,
        expected: picked(),
        notes: form.notes.trim() || undefined,
      })
      .then(() => {
        reset()
        load()
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setBusy(false))
  }

  const remove = (item: KnowledgeEvalCase) => {
    const id = props.collectionID()
    if (!id) return
    void sdk.client.knowledge
      .removeEvalCase({ directory: props.directory(), collectionID: id, caseID: item.id })
      .then(load)
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
  }

  const edit = (item: KnowledgeEvalCase) => {
    setEditing(item.id)
    setForm({ query: item.query, notes: item.notes ?? "" })
    setPicked([...item.expected])
  }

  const toggle = (documentID: string) =>
    setPicked((current) =>
      current.includes(documentID) ? current.filter((item) => item !== documentID) : [...current, documentID],
    )

  // 从文档自动生成基线用例：导入完立刻就能跑一次评测。
  const suggest = () => {
    const id = props.collectionID()
    if (!id) return
    setBusy(true)
    void sdk.client.knowledge.eval
      .suggest({ directory: props.directory(), collectionID: id, apply: true, limit: 12 })
      .then((result) => {
        const saved = num(result.data?.saved)
        load()
        showToast({
          variant: saved > 0 ? "success" : undefined,
          icon: saved > 0 ? "circle-check" : undefined,
          title: language.t(saved > 0 ? "knowledge.eval.suggested" : "knowledge.eval.suggestedNone"),
          description: saved > 0 ? language.t("knowledge.eval.suggestedCount", { count: saved }) : undefined,
        })
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setBusy(false))
  }

  // 导出 Markdown 报告：指标 + 趋势 + 用例变化，可直接贴进评审。
  const exportReport = () => {
    const id = props.collectionID()
    if (!id) return
    setBusy(true)
    void sdk.client.knowledge.eval
      .report({ directory: props.directory(), collectionID: id, k: String(k()) })
      .then((result) => {
        const markdown = result.data?.markdown
        if (!markdown) return
        const blob = new Blob([markdown], { type: "text/markdown" })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = "retrieval-report-" + Date.now() + ".md"
        anchor.click()
        URL.revokeObjectURL(url)
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setBusy(false))
  }

  const evaluate = () => {
    const id = props.collectionID()
    if (!id) return
    if (cases().length === 0) return showToast({ title: language.t("knowledge.eval.noCases") })
    setBusy(true)
    void sdk.client.knowledge.eval
      .run({ directory: props.directory(), collectionID: id, k: k() })
      .then((result) => {
        setRun(result.data ?? undefined)
        load()
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setBusy(false))
  }

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-13-medium text-foreground">{language.t("knowledge.eval.title")}</span>
          <span class="text-11-regular text-foreground-subtle">{language.t("knowledge.eval.description")}</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1 rounded-lg bg-surface p-0.5">
            <For each={K_OPTIONS}>
              {(value) => (
                <button
                  type="button"
                  class="rounded-md px-2 py-1 text-11-medium transition-colors"
                  classList={{
                    "bg-background text-foreground shadow-sm": k() === value,
                    "text-foreground-subtle hover:text-foreground": k() !== value,
                  }}
                  onClick={() => setK(value)}
                >
                  {language.t("knowledge.eval.topK", { k: value })}
                </button>
              )}
            </For>
          </div>
          <Button
            size="small"
            variant="ghost"
            icon="download"
            disabled={busy() || history().length === 0}
            onClick={exportReport}
          >
            {language.t("knowledge.eval.exportReport")}
          </Button>
          <Button size="small" variant="secondary" icon="prompt" disabled={busy()} onClick={suggest}>
            {language.t("knowledge.eval.suggest")}
          </Button>
          <Button size="small" icon="play" disabled={busy()} onClick={evaluate}>
            {language.t("knowledge.eval.run")}
          </Button>
        </div>
      </div>

      <Show when={changed()}>
        {(value) => (
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface/40 px-3 py-2 text-11-regular">
            <span class="text-foreground-subtle">{language.t("knowledge.eval.diffTitle")}</span>
            <span class="text-[#059669]">+{num(value().summary.improved)}</span>
            <span class="text-[#b91c1c]">-{num(value().summary.regressed)}</span>
            <Show when={num(value().summary.new) > 0}>
              <span class="text-foreground-subtle">
                {language.t("knowledge.eval.diffNew", { count: num(value().summary.new) })}
              </span>
            </Show>
            <Show when={num(value().summary.removed) > 0}>
              <span class="text-foreground-subtle">
                {language.t("knowledge.eval.diffRemoved", { count: num(value().summary.removed) })}
              </span>
            </Show>
          </div>
        )}
      </Show>

      <Show when={run()}>
        {(value) => (
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              label={language.t("knowledge.eval.hitRate", { k: num(value().k) })}
              value={percent(value().metrics.hitRate)}
            />
            <Metric label={language.t("knowledge.eval.recall")} value={percent(value().metrics.recall)} />
            <Metric label={language.t("knowledge.eval.mrr")} value={num(value().metrics.mrr).toFixed(3)} />
            <Metric label={language.t("knowledge.eval.latency")} value={num(value().metrics.avgLatencyMs) + "ms"} />
          </div>
        )}
      </Show>

      <div class="flex flex-col gap-2 rounded-xl border border-border p-3">
        <div class="flex flex-wrap items-center gap-2">
          <input
            value={form.query}
            onInput={(event) => setForm("query", event.currentTarget.value)}
            placeholder={language.t("knowledge.eval.queryPlaceholder")}
            class="h-8 min-w-48 flex-1 rounded-md border border-border bg-background px-2.5 text-13-regular text-foreground outline-none placeholder:text-foreground-subtlest focus:border-border-hover"
          />
          <input
            value={form.notes}
            onInput={(event) => setForm("notes", event.currentTarget.value)}
            placeholder={language.t("knowledge.eval.notesPlaceholder")}
            class="h-8 min-w-40 flex-1 rounded-md border border-border bg-background px-2.5 text-13-regular text-foreground outline-none placeholder:text-foreground-subtlest focus:border-border-hover"
          />
          <Button size="small" icon="plus-small" disabled={busy()} onClick={save}>
            {editing() ? language.t("common.save") : language.t("knowledge.eval.add")}
          </Button>
          <Show when={editing()}>
            <Button size="small" variant="ghost" onClick={reset}>
              {language.t("common.cancel")}
            </Button>
          </Show>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-11-regular text-foreground-subtle">
            {language.t("knowledge.eval.pickDocs", { count: picked().length })}
          </span>
          <div class="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
            <For each={props.documents()}>
              {(document) => (
                <button
                  type="button"
                  class="max-w-56 truncate rounded-md border px-2 py-1 text-11-regular transition-colors"
                  classList={{
                    "border-[color-mix(in_srgb,#10b981_45%,var(--border))] bg-[color-mix(in_srgb,#10b981_12%,transparent)] text-foreground":
                      picked().includes(document.id),
                    "border-border bg-surface text-foreground-subtle hover:bg-hover": !picked().includes(document.id),
                  }}
                  title={document.title}
                  onClick={() => toggle(document.id)}
                >
                  {document.title}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>

      <div class="flex flex-col overflow-hidden rounded-xl border border-border">
        <Show when={history().length > 0}>
          <EvalTrendChart history={history} k={k()} />
        </Show>

        <Show
          when={cases().length > 0}
          fallback={
            <div class="px-4 py-10 text-center text-12-regular text-foreground-subtle">
              {language.t("knowledge.eval.empty")}
            </div>
          }
        >
          <For each={cases()}>
            {(item) => {
              const result = () => run()?.results.find((entry) => entry.id === item.id)
              return (
                <div class="flex min-w-0 items-start gap-3 border-t border-border px-3 py-2.5 first:border-t-0 hover:bg-hover">
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <div class="flex min-w-0 flex-wrap items-center gap-2">
                      <span class="min-w-0 truncate text-13-regular text-foreground">{item.query}</span>
                      <Show when={result()}>
                        {(value) => (
                          <span
                            class="shrink-0 rounded px-1.5 py-0.5 text-11-medium"
                            classList={{
                              "bg-[color-mix(in_srgb,#10b981_16%,transparent)] text-[#059669]": num(value().rank) > 0,
                              "bg-[color-mix(in_srgb,#ef4444_14%,transparent)] text-[#b91c1c]": value().rank === 0,
                            }}
                          >
                            {num(value().rank) > 0
                              ? language.t("knowledge.eval.hit", { rank: num(value().rank) })
                              : language.t("knowledge.eval.miss")}
                          </span>
                        )}
                      </Show>
                      <Show when={diff()?.cases.find((entry) => entry.id === item.id)}>
                        {(change) => <DiffBadge status={change().status} />}
                      </Show>
                    </div>
                    <span class="flex flex-wrap items-center gap-1 text-11-regular text-foreground-subtlest">
                      {language.t("knowledge.eval.expected")}
                      <For each={item.expected}>
                        {(id) => <span class="rounded bg-surface px-1">{titleOf(id)}</span>}
                      </For>
                    </span>
                    <Show when={item.notes}>
                      <span class="text-11-regular text-foreground-subtle">{item.notes}</span>
                    </Show>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <IconButton
                      icon="pencil-line"
                      variant="ghost"
                      size="small"
                      aria-label={language.t("common.edit")}
                      onClick={() => edit(item)}
                    />
                    <IconButton
                      icon="trash"
                      variant="ghost"
                      size="small"
                      aria-label={language.t("common.delete")}
                      onClick={() => remove(item)}
                    />
                  </div>
                </div>
              )
            }}
          </For>
        </Show>
      </div>

      <Show when={run() && run()!.results.length > 0}>
        <div class="flex flex-col gap-2">
          <span class="text-12-medium text-foreground-subtle">{language.t("knowledge.eval.results")}</span>
          <div class="flex flex-col overflow-hidden rounded-xl border border-border">
            <For each={run()!.results}>
              {(item) => (
                <div class="flex min-w-0 items-center gap-3 border-t border-border px-3 py-2 first:border-t-0">
                  <Icon
                    name={num(item.rank) > 0 ? "circle-check" : "circle-ban-sign"}
                    size="small"
                    class={num(item.rank) > 0 ? "text-success" : "text-destructive"}
                  />
                  <span class="min-w-0 flex-1 truncate text-12-regular text-foreground">{item.query}</span>
                  <span class="shrink-0 text-11-regular text-foreground-subtle">
                    {language.t("knowledge.eval.recallValue", { value: Math.round(num(item.recall) * 100) })}
                  </span>
                  <span class="w-14 shrink-0 text-right text-11-regular tabular-nums text-foreground-subtlest">
                    {num(item.latencyMs)}ms
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

const hasChanges = (value: KnowledgeEvalDiff) =>
  num(value.summary.improved) + num(value.summary.regressed) + num(value.summary.new) + num(value.summary.removed) > 0

const DiffBadge: Component<{ status: KnowledgeEvalDiff["cases"][number]["status"] }> = (props) => {
  const language = useLanguage()
  const meta = () => {
    if (props.status === "improved")
      return {
        label: language.t("knowledge.eval.diffImproved"),
        cls: "bg-[color-mix(in_srgb,#10b981_16%,transparent)] text-[#059669]",
      }
    if (props.status === "regressed")
      return {
        label: language.t("knowledge.eval.diffRegressed"),
        cls: "bg-[color-mix(in_srgb,#ef4444_14%,transparent)] text-[#b91c1c]",
      }
    if (props.status === "new")
      return {
        label: language.t("knowledge.eval.diffNewCase"),
        cls: "bg-[color-mix(in_srgb,#3b82f6_14%,transparent)] text-[#2563eb]",
      }
    if (props.status === "removed")
      return { label: language.t("knowledge.eval.diffRemovedCase"), cls: "bg-surface text-foreground-subtle" }
    return undefined
  }
  return (
    <Show when={meta()}>
      {(value) => <span class={"shrink-0 rounded px-1.5 py-0.5 text-[10px] " + value().cls}>{value().label}</span>}
    </Show>
  )
}

const Metric: Component<{ label: string; value: string }> = (props) => (
  <div class="flex flex-col gap-0.5 rounded-xl border border-border bg-surface/40 px-3 py-2">
    <span class="text-11-regular text-foreground-subtle">{props.label}</span>
    <span class="text-18-medium tabular-nums text-foreground">{props.value}</span>
  </div>
)

const text = (error: unknown) => (error instanceof Error ? error.message : String(error))
