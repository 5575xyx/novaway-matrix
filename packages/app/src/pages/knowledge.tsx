import type {
  KnowledgeCollection,
  KnowledgeCollectionTemplate,
  KnowledgeImportJob,
  KnowledgeOverview,
  KnowledgeRecentQuery,
  KnowledgeOcrStatus,
  KnowledgeCollectionStats,
  KnowledgeDocument,
  KnowledgeDocumentMeta,
  KnowledgeGraph,
  KnowledgeHit,
} from "@novaway/sdk/v2"
import { Button } from "@novaway/ui/button"
import { useDialog } from "@novaway/ui/context/dialog"
import { Dialog } from "@novaway/ui/dialog"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Markdown } from "@novaway/ui/markdown"
import { KnowledgeTextView } from "@/components/session/knowledge-text-view"
import { KnowledgeEvalPanel } from "@/components/knowledge/eval-panel"
import { OcrInstallDialog } from "@/components/knowledge/ocr-install-dialog"
import { aiFixLabels, buildAiFixDetails, type AiFixContext } from "@/utils/ai-fix"
import { Switch } from "@novaway/ui/switch"
import { TextField } from "@novaway/ui/text-field"
import { showToast } from "@novaway/ui/toast"
import { formatRelativeTime } from "@/utils/relative-time"
import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { FILE_TONE, isBinaryDocument, knowledgeFileKind } from "@/utils/knowledge-file"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"

// 生成的 SDK 把 JSON number 标成 `number | "NaN" | "Infinity" | ...`，
// 这里统一归一成有限数字，避免每一处调用都写类型收窄。
const num = (input: unknown): number => {
  if (typeof input === "number" && Number.isFinite(input)) return input
  const parsed = Number(input)
  return Number.isFinite(parsed) ? parsed : 0
}

const formatSize = (input: unknown) => {
  const bytes = num(input)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const formatTime = (input: unknown) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(
    new Date(num(input)),
  )

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** 把查询词在结果里标出来：按出现位置切段，避免正则转义问题。 */
function highlight(text: string, query: string) {
  const terms = Array.from(new Set(query.toLowerCase().split(String.fromCharCode(32)).filter(Boolean))).sort(
    (a, b) => b.length - a.length,
  )
  if (terms.length === 0) return [{ text, hit: false }]
  const out: Array<{ text: string; hit: boolean }> = []
  let rest = text
  while (rest) {
    let at = -1
    let found = ""
    for (const term of terms) {
      const index = rest.toLowerCase().indexOf(term)
      if (index !== -1 && (at === -1 || index < at)) {
        at = index
        found = term
      }
    }
    if (at === -1) {
      out.push({ text: rest, hit: false })
      break
    }
    if (at > 0) out.push({ text: rest.slice(0, at), hit: false })
    out.push({ text: rest.slice(at, at + found.length), hit: true })
    rest = rest.slice(at + found.length)
  }
  return out
}

/**
 * 知识库页。
 *
 * 本地优先：集合与文档都存在 `~/.novaway/knowledge`，不依赖远端服务。
 * 目录结构见 `packages/novaway/src/knowledge/store.ts`。
 * AI 侧通过 `knowledge_search` 工具检索（见 tool/knowledge.ts）。
 */
export const KnowledgePage: Component<{ onBack: () => void }> = (props) => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const params = useParams()
  const navigate = useNavigate()
  const dialog = useDialog()
  const directory = createMemo(() => decode64(params.dir) ?? "")

  const [collections, setCollections] = createSignal<KnowledgeCollection[]>([])
  const [selected, setSelected] = createSignal<string>()
  const [documents, setDocuments] = createSignal<KnowledgeDocumentMeta[]>([])
  const [docTotal, setDocTotal] = createSignal(0)
  const [docFilter, setDocFilter] = createSignal("")
  const [docSort, setDocSort] = createSignal<"updated" | "created" | "title">("updated")
  const [selectedDocs, setSelectedDocs] = createSignal<string[]>([])
  const [loading, setLoading] = createSignal(true)
  const [busy, setBusy] = createSignal(false)
  const sessionID = createMemo(() => params.id ?? "")
  const [mounted, setMounted] = createSignal<string[]>([])
  const [tab, setTab] = createSignal<"docs" | "graph" | "eval">("docs")
  const [graph, setGraph] = createSignal<KnowledgeGraph>()
  const [graphLoading, setGraphLoading] = createSignal(false)
  const [stats, setStats] = createSignal<KnowledgeCollectionStats>()
  const [ocr, setOcr] = createSignal<KnowledgeOcrStatus>()
  const [templates, setTemplates] = createSignal<KnowledgeCollectionTemplate[]>([])
  const [overview, setOverview] = createSignal<KnowledgeOverview>()
  const [recent, setRecent] = createSignal<KnowledgeRecentQuery[]>([])
  const [importJob, setImportJob] = createSignal<KnowledgeImportJob>()
  const [query, setQuery] = createSignal("")
  const [hits, setHits] = createSignal<KnowledgeHit[]>([])
  const [searching, setSearching] = createSignal(false)

  const current = createMemo(() => collections().find((item) => item.id === selected()))

  const loadOverview = () =>
    globalSDK.client.knowledge
      .overview({ directory: directory() })
      .then((result) => setOverview(result.data ?? undefined))
      .catch(() => setOverview(undefined))

  const loadRecent = (collectionID: string | undefined) => {
    if (!collectionID) {
      setRecent([])
      return
    }
    void globalSDK.client.knowledge
      .recentQueries({ directory: directory(), collectionID })
      .then((result) => setRecent(result.data ?? []))
      .catch(() => setRecent([]))
  }

  const loadCollections = async (keep?: string) => {
    void loadOverview()
    const result = await globalSDK.client.knowledge.collections({ directory: directory() })
    const list = result.data ?? []
    setCollections(list)
    const next = keep ?? selected() ?? list[0]?.id
    setSelected(list.some((item) => item.id === next) ? next : list[0]?.id)
    return list
  }

  const loadStats = (collectionID: string) =>
    globalSDK.client.knowledge
      .stats({ directory: directory(), collectionID })
      .then((result) => setStats(result.data ?? undefined))
      .catch(() => setStats(undefined))

  const DOC_PAGE_SIZE = 100

  const loadDocuments = async (collectionID: string, offset = 0) => {
    const result = await globalSDK.client.knowledge.documentsPage({
      directory: directory(),
      collectionID,
      q: docFilter().trim() || undefined,
      sort: docSort(),
      limit: String(DOC_PAGE_SIZE),
      offset: String(offset),
    })
    const page = result.data
    setDocTotal(num(page?.total))
    setDocuments(offset === 0 ? (page?.items ?? []) : [...documents(), ...(page?.items ?? [])])
    setSelectedDocs([])
  }

  const loadMoreDocuments = () => {
    const id = selected()
    if (!id) return
    void loadDocuments(id, documents().length)
  }

  onMount(() => {
    void globalSDK.client.knowledge
      .templates({ directory: directory() })
      .then((result) => setTemplates(result.data ?? []))
      .catch(() => setTemplates([]))
    void globalSDK.client.knowledge
      .ocr({ directory: directory() })
      .then((result) => setOcr(result.data ?? undefined))
      .catch(() => undefined)
    if (sessionID()) {
      void globalSDK.client.knowledge
        .sessionMount({ directory: directory(), sessionID: sessionID() })
        .then((result) => setMounted(result.data ?? []))
        .catch(() => undefined)
    }
    void loadCollections()
      .catch((error) => showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }))
      .finally(() => setLoading(false))
  })

  createEffect(() => {
    const id = selected()
    if (!id) {
      setDocuments([])
      return
    }
    void loadDocuments(id).catch((error) =>
      showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }),
    )
    void loadStats(id)
    loadRecent(id)
  })

  // 搜索防抖：输入停顿 250ms 再请求，避免每个字符打一次 HTTP。
  let searchTimer: number | undefined
  createEffect(() => {
    const text = query().trim()
    if (!text) {
      setHits([])
      setSearching(false)
      return
    }
    setSearching(true)
    if (searchTimer !== undefined) window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
      void globalSDK.client.knowledge
        .search({ directory: directory(), q: text, collectionID: selected(), limit: "20" })
        .then((result) => setHits(result.data ?? []))
        .catch((error) => showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }))
        .finally(() => setSearching(false))
    }, 250)
  })
  onCleanup(() => {
    if (searchTimer !== undefined) window.clearTimeout(searchTimer)
  })

  // 返回的兜底入口：桌面壳里顶行可能和窗口拖拽区重叠，Esc 永远可用。
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      props.onBack()
    }
    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown))
  })

  const createCollection = () => {
    const [form, setForm] = createStore({
      name: "",
      description: "",
      scope: "global" as "global" | "project",
      readOnly: false,
    })
    const [template, setTemplate] = createSignal<string>()
    const [sample, setSample] = createSignal(false)
    const applyTemplate = (id: string | undefined) => {
      setTemplate(id)
      const item = templates().find((entry) => entry.id === id)
      if (!item) return
      // 模板只填默认值，用户仍可改。
      setForm({ name: item.name, description: item.hint })
    }
    dialog.show(() => (
      <Dialog
        title={language.t("knowledge.collection.create.title")}
        transition
        class="w-[min(calc(100vw-40px),520px)]"
      >
        <form
          class="flex flex-col gap-4 px-2.5 pb-3"
          onSubmit={(event) => {
            event.preventDefault()
            const name = form.name.trim()
            if (!name) return
            setBusy(true)
            void globalSDK.client.knowledge
              .createCollection({
                directory: directory(),
                name,
                description: form.description.trim() || undefined,
                scope: form.scope,
                readOnly: form.readOnly,
                template: template(),
                sample: sample(),
              })
              .then(async (result) => {
                dialog.close()
                await loadCollections(result.data?.id)
                showToast({
                  variant: "success",
                  icon: "circle-check",
                  title: language.t("knowledge.collection.create.toast"),
                })
              })
              .catch((error) =>
                showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }),
              )
              .finally(() => setBusy(false))
          }}
        >
          <Show when={templates().length > 0}>
            <div class="flex flex-col gap-1.5">
              <span class="text-12-medium text-foreground-subtle">{language.t("knowledge.template.label")}</span>
              <div class="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  class="rounded-md border px-2 py-1 text-11-regular transition-colors"
                  classList={{
                    "border-[color-mix(in_srgb,#10b981_45%,var(--border))] bg-[color-mix(in_srgb,#10b981_12%,transparent)] text-foreground":
                      !template(),
                    "border-border bg-surface text-foreground-subtle hover:bg-hover": !!template(),
                  }}
                  onClick={() => applyTemplate(undefined)}
                >
                  {language.t("knowledge.template.blank")}
                </button>
                <For each={templates()}>
                  {(item) => (
                    <button
                      type="button"
                      class="max-w-40 truncate rounded-md border px-2 py-1 text-11-regular transition-colors"
                      classList={{
                        "border-[color-mix(in_srgb,#10b981_45%,var(--border))] bg-[color-mix(in_srgb,#10b981_12%,transparent)] text-foreground":
                          template() === item.id,
                        "border-border bg-surface text-foreground-subtle hover:bg-hover": template() !== item.id,
                      }}
                      title={item.description}
                      onClick={() => applyTemplate(item.id)}
                    >
                      {item.name}
                    </button>
                  )}
                </For>
              </div>
              <span class="text-11-regular text-foreground-subtlest">
                {templates().find((item) => item.id === template())?.description ??
                  language.t("knowledge.template.hint")}
              </span>
            </div>
          </Show>

          <Show when={template()}>
            <div class="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <span class="text-12-regular text-foreground">{language.t("knowledge.template.sample")}</span>
              <Switch checked={sample()} onChange={setSample} hideLabel>
                {language.t("knowledge.template.sample")}
              </Switch>
            </div>
          </Show>
          <TextField
            label={language.t("knowledge.collection.field.name")}
            placeholder={language.t("knowledge.collection.field.name.placeholder")}
            value={form.name}
            onChange={(value) => setForm("name", value)}
            autofocus
          />
          <TextField
            label={language.t("knowledge.collection.field.description")}
            placeholder={language.t("knowledge.collection.field.description.placeholder")}
            value={form.description}
            onChange={(value) => setForm("description", value)}
          />
          <div class="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5">
            <div class="flex items-center justify-between gap-3">
              <span class="text-12-regular text-foreground">{language.t("knowledge.collection.field.scope")}</span>
              <div class="flex items-center gap-1 rounded-lg bg-surface p-0.5">
                <For each={["global", "project"] as const}>
                  {(value) => (
                    <button
                      type="button"
                      class="rounded-md px-2 py-1 text-11-medium transition-colors"
                      classList={{
                        "bg-background text-foreground shadow-sm": form.scope === value,
                        "text-foreground-subtle hover:text-foreground": form.scope !== value,
                      }}
                      onClick={() => setForm("scope", value)}
                    >
                      {language.t(value === "global" ? "knowledge.scope.global" : "knowledge.scope.project")}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-12-regular text-foreground">{language.t("knowledge.collection.field.readOnly")}</span>
              <Switch checked={form.readOnly} onChange={(value) => setForm("readOnly", value)} hideLabel>
                {language.t("knowledge.collection.field.readOnly")}
              </Switch>
            </div>
          </div>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!form.name.trim() || busy()}>
              {language.t("knowledge.collection.create.action")}
            </Button>
            <input
              ref={(el) => (packageInput = el)}
              type="file"
              accept=".json,application/json"
              class="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ""
                if (file) void importPackage(file)
              }}
            />
            <Button
              variant="ghost"
              size="small"
              icon="cloud-upload"
              class="mt-1 w-full justify-start"
              disabled={busy()}
              onClick={() => packageInput?.click()}
            >
              {language.t("knowledge.package.import")}
            </Button>
            <Button
              variant="ghost"
              size="small"
              icon="download"
              class="mt-1 w-full justify-start"
              disabled={busy()}
              onClick={exportLibraryBackup}
            >
              {language.t("knowledge.library.export")}
            </Button>
            <input
              ref={(el) => (libraryInput = el)}
              type="file"
              accept=".json,application/json"
              class="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ""
                if (file) void importLibraryBackup(file)
              }}
            />
            <Button
              variant="ghost"
              size="small"
              icon="cloud-upload"
              class="mt-1 w-full justify-start"
              disabled={busy()}
              onClick={() => libraryInput?.click()}
            >
              {language.t("knowledge.library.import")}
            </Button>
          </div>
        </form>
      </Dialog>
    ))
  }

  const confirm = (input: { title: string; description: string; onConfirm: () => Promise<void> }) => {
    dialog.show(() => (
      <Dialog title={input.title} transition class="w-[min(calc(100vw-40px),480px)]">
        <div class="flex flex-col gap-4 px-2.5 pb-3">
          <p class="text-13-regular leading-5 text-foreground-subtle">{input.description}</p>
          <div class="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="secondary"
              class="text-destructive"
              onClick={() => {
                setBusy(true)
                void input
                  .onConfirm()
                  .then(() => dialog.close())
                  .catch((error) =>
                    showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }),
                  )
                  .finally(() => setBusy(false))
              }}
            >
              {language.t("knowledge.delete.action")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const toggleCollection = (collection: KnowledgeCollection, enabled: boolean) => {
    void globalSDK.client.knowledge
      .updateCollection({ directory: directory(), collectionID: collection.id, enabled })
      .then(async () => {
        await loadCollections(collection.id)
      })
      .catch((error) => showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }))
  }

  const editCollection = (collection: KnowledgeCollection) => {
    const [form, setForm] = createStore({
      name: collection.name,
      description: collection.description ?? "",
      scope: (collection.scope ?? "global") as "global" | "project",
      readOnly: collection.readOnly ?? false,
    })
    dialog.show(() => (
      <Dialog title={language.t("knowledge.collection.edit.title")} transition class="w-[min(calc(100vw-40px),520px)]">
        <form
          class="flex flex-col gap-4 px-2.5 pb-3"
          onSubmit={(event) => {
            event.preventDefault()
            const name = form.name.trim()
            if (!name) return
            setBusy(true)
            void globalSDK.client.knowledge
              .updateCollection({
                directory: directory(),
                collectionID: collection.id,
                name,
                description: form.description.trim(),
                scope: form.scope,
                readOnly: form.readOnly,
              })
              .then(async () => {
                dialog.close()
                await loadCollections(collection.id)
              })
              .catch((error) =>
                showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }),
              )
              .finally(() => setBusy(false))
          }}
        >
          <TextField
            label={language.t("knowledge.collection.field.name")}
            value={form.name}
            onChange={(value) => setForm("name", value)}
            autofocus
          />
          <TextField
            label={language.t("knowledge.collection.field.description")}
            value={form.description}
            onChange={(value) => setForm("description", value)}
          />
          <div class="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5">
            <div class="flex items-center justify-between gap-3">
              <span class="text-12-regular text-foreground">{language.t("knowledge.collection.field.scope")}</span>
              <div class="flex items-center gap-1 rounded-lg bg-surface p-0.5">
                <For each={["global", "project"] as const}>
                  {(value) => (
                    <button
                      type="button"
                      class="rounded-md px-2 py-1 text-11-medium transition-colors"
                      classList={{
                        "bg-background text-foreground shadow-sm": form.scope === value,
                        "text-foreground-subtle hover:text-foreground": form.scope !== value,
                      }}
                      onClick={() => setForm("scope", value)}
                    >
                      {language.t(value === "global" ? "knowledge.scope.global" : "knowledge.scope.project")}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-12-regular text-foreground">{language.t("knowledge.collection.field.readOnly")}</span>
              <Switch checked={form.readOnly} onChange={(value) => setForm("readOnly", value)} hideLabel>
                {language.t("knowledge.collection.field.readOnly")}
              </Switch>
            </div>
          </div>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!form.name.trim() || busy()}>
              {language.t("common.save")}
            </Button>
          </div>
        </form>
      </Dialog>
    ))
  }

  const removeCollection = (collection: KnowledgeCollection) => {
    confirm({
      title: language.t("knowledge.collection.delete.title"),
      description: language.t("knowledge.collection.delete.description", { name: collection.name }),
      onConfirm: async () => {
        await globalSDK.client.knowledge.removeCollection({ directory: directory(), collectionID: collection.id })
        await loadCollections()
      },
    })
  }

  // 拖拽/多选导入：逐个写入并汇总结果，失败时提示具体文件名。
  const toBase64 = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ""
    const size = 0x8000
    for (let index = 0; index < bytes.length; index += size) {
      binary += String.fromCharCode(...bytes.subarray(index, index + size))
    }
    return btoa(binary)
  }

  // 后台导入：轮询任务进度，完成/失败后刷新列表。
  let importTimer: number | undefined
  const stopImportPolling = () => {
    if (importTimer !== undefined) window.clearInterval(importTimer)
    importTimer = undefined
  }
  onCleanup(stopImportPolling)

  const trackImport = (jobID: string, collectionID: string) => {
    stopImportPolling()
    const tick = () => {
      void globalSDK.client.knowledge
        .importJob({ directory: directory(), jobID })
        .then((result) => {
          const job = result.data ?? undefined
          setImportJob(job)
          if (!job) return stopImportPolling()
          if (job.status === "running") return
          stopImportPolling()
          void loadDocuments(collectionID)
          void loadCollections(collectionID)
          void loadStats(collectionID)
          const failed = job.progress.failed
          // 队列里有失败且本机没有 OCR 时，顺手给出一键安装入口。
          const needsOcr = Number(failed) > 0 && ocr()?.kind === "none"
          showToast({
            variant: job.status === "completed" && failed === 0 ? "success" : undefined,
            icon: job.status === "completed" && failed === 0 ? "circle-check" : undefined,
            title:
              job.status === "cancelled"
                ? language.t("knowledge.import.cancelled")
                : language.t("knowledge.import.finished"),
            description: language.t("knowledge.import.progress", {
              imported: job.progress.imported,
              updated: job.progress.updated,
              duplicates: job.progress.duplicates,
              failed,
            }),
            actions: needsOcr
              ? [
                  { label: language.t("knowledge.ocr.install.action"), onClick: () => openOcrInstall() },
                  {
                    label: language.t("knowledge.ocr.install.askAi"),
                    onClick: () => askAiToInstall({}),
                  },
                ]
              : undefined,
          })
        })
        .catch(() => stopImportPolling())
        .finally(() => setBusy(false))
    }
    tick()
    importTimer = window.setInterval(tick, 1200)
  }

  const runningImport = () => {
    const job = importJob()
    return job && job.status === "running" ? job : undefined
  }

  const cancelImport = () => {
    const job = importJob()
    if (!job) return
    void globalSDK.client.knowledge
      .cancelImportJob({ directory: directory(), jobID: job.id })
      .then((result) => setImportJob(result.data ?? undefined))
      .catch(() => undefined)
  }

  /**
   * 「让 AI 帮我装」：新建一个会话并把当前状态、失败原因和日志交给 Agent，
   * 由它用终端工具在真实环境里排查（代理、自建 Python、权限受限等场景下比固定流程更灵活）。
   */
  const askAiToInstall = (context: AiFixContext) => {
    const details = buildAiFixDetails(context, aiFixLabels(language.t as never))
    const prompt = language.t("knowledge.ocr.install.askAiPrompt", {
      label: ocr()?.label ?? language.t("knowledge.ocr.install.intro"),
      details,
    })
    dialog.close()
    navigate(`/${params.dir}/session?prompt=${encodeURIComponent(prompt)}&submit=1`)
  }

  /** 单个二进制文件走服务端导入（抽取 PDF/DOCX/PPTX/XLSX/图片正文）。 */
  const importSingleFile = async (file: File, collectionID: string) => {
    setBusy(true)
    try {
      const payload = [{ name: file.name, data: await toBase64(file) }]
      const background = file.size > 2 * 1024 * 1024
      const result = await globalSDK.client.knowledge.import({
        directory: directory(),
        collectionID,
        files: payload,
        background,
      })
      if (result.data?.jobID) {
        // 交给顶部进度条：解析大文件期间界面保持可交互。
        trackImport(result.data.jobID, collectionID)
        return true
      }
      const failed = result.data?.failed ?? []
      await loadDocuments(collectionID)
      await loadCollections(collectionID)
      void loadStats(collectionID)
      if (failed.length > 0) {
        showToast({
          title: language.t("knowledge.document.add.failed"),
          description: failed.map((item) => item.name + ": " + item.error).join(String.fromCharCode(10)),
          persistent: true,
        })
        return false
      }
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("knowledge.document.add.toast"),
        description: file.name,
      })
      return true
    } catch (error) {
      showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) })
      return false
    } finally {
      setBusy(false)
    }
  }

  /** 缺少运行环境时，统一引导到「一键安装」，用户不需要自己去装 Python。 */
  const openOcrInstall = () => {
    dialog.show(() => (
      <OcrInstallDialog
        directory={directory}
        status={ocr}
        onInstalled={() => {
          void globalSDK.client.knowledge
            .ocr({ directory: directory() })
            .then((result) => setOcr(result.data ?? undefined))
            .catch(() => undefined)
        }}
      />
    ))
  }

  // 批量导入：一次请求提交全部文件，服务端逐个抽取并返回汇总（重复自动跳过）。
  const importFiles = async (files: File[]) => {
    const collection = current()
    if (!collection || files.length === 0) return
    setBusy(true)
    try {
      const payload = await Promise.all(files.map(async (file) => ({ name: file.name, data: await toBase64(file) })))
      // 文件多、或单个文件很大时走后台导入：立即返回 jobID，顶部显示进度并可中止。
      // 之前只按数量判断，一个 50MB 的 PDF 会同步解析几十秒，界面像卡死。
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
      const background = files.length > 3 || totalBytes > 2 * 1024 * 1024
      const result = await globalSDK.client.knowledge.import({
        directory: directory(),
        collectionID: collection.id,
        files: payload,
        background,
      })
      if (result.data?.jobID) {
        trackImport(result.data.jobID, collection.id)
        return
      }
      const summary = result.data ?? { imported: 0, updated: 0, duplicates: 0, failed: [] }
      await loadDocuments(collection.id)
      await loadCollections(collection.id)
      void loadStats(collection.id)
      if (summary.failed.length > 0) {
        // 失败原因是缺少 OCR 时，直接给一个「一键安装」动作，而不是让用户自己折腾环境。
        const needsOcr = ocr()?.kind === "none" && summary.failed.some((item) => /OCR/i.test(item.error))
        showToast({
          title: language.t("knowledge.document.add.failed"),
          description: summary.failed.map((item) => item.name + ": " + item.error).join(String.fromCharCode(10)),
          persistent: needsOcr,
          actions: needsOcr
            ? [
                {
                  label: language.t("knowledge.ocr.install.action"),
                  onClick: () => openOcrInstall(),
                },
                {
                  label: language.t("knowledge.ocr.install.askAi"),
                  onClick: () =>
                    askAiToInstall({
                      error: summary.failed.map((item) => item.name + ": " + item.error).join("; "),
                    }),
                },
              ]
            : undefined,
        })
        return
      }
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("knowledge.document.add.toast"),
        description: language.t("knowledge.document.import.summary", {
          imported: summary.imported,
          updated: summary.updated,
          duplicates: summary.duplicates,
        }),
      })
    } catch (error) {
      showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const exportCollection = (collection: KnowledgeCollection) => {
    void globalSDK.client.knowledge
      .export({ directory: directory(), collectionID: collection.id })
      .then((result) => {
        const payload = result.data
        if (!payload) return
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = (collection.name || "knowledge").replace(/[^w.-]+/g, "-") + ".knowledge.json"
        anchor.click()
        URL.revokeObjectURL(url)
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("knowledge.export.toast"),
          description: language.t("knowledge.export.count", { count: payload.documents.length }),
        })
      })
      .catch((error) => showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }))
  }

  const restoreBackup = async (collection: KnowledgeCollection, file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as {
        documents?: Array<{ title?: string; source?: string; content?: string }>
        signature?: { algorithm?: string; value?: string; documents?: number }
      }
      const documents = (parsed.documents ?? []).map((item) => ({
        title: item.title || item.source || "Untitled",
        source: item.source,
        content: item.content ?? "",
      }))
      if (documents.length === 0) {
        showToast({ title: language.t("knowledge.restore.empty") })
        return
      }
      setBusy(true)
      const result = await globalSDK.client.knowledge.restore({
        directory: directory(),
        collectionID: collection.id,
        documents,
        signature: parsed.signature,
      })
      const summary = result.data ?? { imported: 0, updated: 0, skipped: 0 }
      await loadDocuments(collection.id)
      await loadCollections(collection.id)
      void loadStats(collection.id)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("knowledge.restore.toast"),
        description: language.t("knowledge.restore.summary", {
          imported: summary.imported,
          updated: summary.updated,
          skipped: summary.skipped,
        }),
      })
    } catch (error) {
      showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  /**
   * 导入知识包（团队共享 / 迁移）：
   * 读取导出的 .knowledge.json，新建一个集合再恢复文档。
   * 同名集合不覆盖——追加序号，避免误伤本地已有资料。
   */
  const importPackage = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as {
        format?: string
        collection?: { name?: string; description?: string }
        documents?: Array<{ title?: string; source?: string; content?: string }>
        signature?: { algorithm?: string; value?: string; documents?: number }
      }
      if (parsed.format !== "novaway.knowledge.v1" || !Array.isArray(parsed.documents)) {
        showToast({ title: language.t("knowledge.package.invalid") })
        return
      }
      setBusy(true)
      const baseName = (parsed.collection?.name || file.name.replace(/.json$/i, "")).trim() || "Imported"
      const taken = new Set(collections().map((item) => item.name))
      let name = baseName
      let index = 2
      while (taken.has(name)) name = baseName + " " + index++
      const created = await globalSDK.client.knowledge.createCollection({
        directory: directory(),
        name,
        description: parsed.collection?.description,
      })
      const collectionID = created.data?.id
      if (!collectionID) throw new Error("Collection creation failed")
      const result = await globalSDK.client.knowledge.restore({
        directory: directory(),
        collectionID,
        documents: parsed.documents.map((item) => ({
          title: item.title || item.source || "Untitled",
          source: item.source,
          content: item.content ?? "",
        })),
        signature: parsed.signature,
      })
      const summary = result.data ?? { imported: 0, updated: 0, skipped: 0 }
      await loadCollections(collectionID)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("knowledge.package.toast", { name }),
        description: language.t("knowledge.restore.summary", {
          imported: summary.imported,
          updated: summary.updated,
          skipped: summary.skipped,
        }),
      })
    } catch (error) {
      showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  let packageInput: HTMLInputElement | undefined

  const toggleSelected = (id: string) =>
    setSelectedDocs((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  const allSelected = () => documents().length > 0 && selectedDocs().length === documents().length

  const bulkRemove = () => {
    const collection = current()
    const ids = selectedDocs()
    if (!collection || ids.length === 0) return
    confirm({
      title: language.t("knowledge.bulk.delete.title"),
      description: language.t("knowledge.bulk.delete.description", { count: ids.length }),
      onConfirm: async () => {
        await globalSDK.client.knowledge.bulkRemoveDocuments({
          directory: directory(),
          collectionID: collection.id,
          ids,
        })
        await loadDocuments(collection.id)
        await loadCollections(collection.id)
        void loadStats(collection.id)
      },
    })
  }

  const bulkMove = () => {
    const collection = current()
    const ids = selectedDocs()
    if (!collection || ids.length === 0) return
    const targets = collections().filter((item) => item.id !== collection.id && !item.readOnly)
    dialog.show(() => (
      <Dialog title={language.t("knowledge.bulk.move.title")} transition class="w-[min(calc(100vw-40px),480px)]">
        <div class="flex flex-col gap-3 px-2.5 pb-3">
          <p class="text-12-regular text-foreground-subtle">
            {language.t("knowledge.bulk.move.description", { count: ids.length })}
          </p>
          <Show
            when={targets.length > 0}
            fallback={
              <div class="rounded-lg border border-dashed border-border px-3 py-6 text-center text-12-regular text-foreground-subtle">
                {language.t("knowledge.bulk.move.empty")}
              </div>
            }
          >
            <div class="flex max-h-64 flex-col gap-1 overflow-y-auto">
              <For each={targets}>
                {(target) => (
                  <button
                    type="button"
                    class="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-13-regular text-foreground transition-colors hover:bg-hover"
                    onClick={() => {
                      setBusy(true)
                      void globalSDK.client.knowledge
                        .moveDocuments({ directory: directory(), from: collection.id, to: target.id, ids })
                        .then(async (result) => {
                          dialog.close()
                          await loadDocuments(collection.id)
                          await loadCollections(collection.id)
                          void loadStats(collection.id)
                          const data = result.data
                          showToast({
                            variant: "success",
                            icon: "circle-check",
                            title: language.t("knowledge.bulk.move.toast", { name: target.name }),
                            description: language.t("knowledge.bulk.move.summary", {
                              moved: data?.moved.length ?? 0,
                              duplicates: data?.duplicates.length ?? 0,
                            }),
                          })
                        })
                        .catch((error) =>
                          showToast({
                            title: language.t("common.requestFailed"),
                            description: errorMessage(error),
                          }),
                        )
                        .finally(() => setBusy(false))
                    }}
                  >
                    <Icon name="review" size="small" class="text-foreground-subtle" />
                    <span class="min-w-0 flex-1 truncate">{target.name}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <div class="flex justify-end">
            <Button variant="secondary" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  // 完整性检查：只读扫描，孤儿缓存可以一键修复；其余问题只报告，不自动删数据。
  const checkIntegrity = () => {
    setBusy(true)
    void globalSDK.client.knowledge
      .integrity({ directory: directory() })
      .then((result) => {
        const report = result.data
        if (!report) return
        dialog.show(() => (
          <Dialog title={language.t("knowledge.integrity.title")} transition class="w-[min(calc(100vw-40px),560px)]">
            <div class="flex flex-col gap-3 px-2.5 pb-3">
              <div class="flex flex-wrap gap-x-4 gap-y-1 text-12-regular text-foreground-subtle">
                <span>{language.t("knowledge.integrity.collections", { count: report.collections })}</span>
                <span>{language.t("knowledge.integrity.documents", { count: report.documents })}</span>
                <span>{language.t("knowledge.integrity.issues", { count: report.issues.length })}</span>
              </div>
              <Show
                when={report.issues.length > 0}
                fallback={
                  <div class="rounded-lg border border-dashed border-border px-3 py-6 text-center text-12-regular text-foreground-subtle">
                    {language.t("knowledge.integrity.clean")}
                  </div>
                }
              >
                <div class="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
                  <For each={report.issues}>
                    {(issue) => (
                      <div class="flex min-w-0 items-start gap-2 text-12-regular">
                        <Icon name="warning" size="small" class="mt-0.5 shrink-0 text-warning" />
                        <span class="min-w-0 flex-1 break-words text-foreground">
                          {issue.kind}
                          <span class="text-foreground-subtlest"> · {issue.detail}</span>
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <div class="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => dialog.close()}>
                  {language.t("common.close")}
                </Button>
                <Show when={report.issues.some((issue) => issue.kind === "orphan-sidecar")}>
                  <Button
                    onClick={() => {
                      setBusy(true)
                      void globalSDK.client.knowledge
                        .repairIntegrity({ directory: directory() })
                        .then((fixed) => {
                          dialog.close()
                          showToast({
                            variant: "success",
                            icon: "circle-check",
                            title: language.t("knowledge.integrity.repaired", {
                              count: fixed.data?.removed ?? 0,
                            }),
                          })
                        })
                        .catch((error) =>
                          showToast({
                            title: language.t("common.requestFailed"),
                            description: errorMessage(error),
                          }),
                        )
                        .finally(() => setBusy(false))
                    }}
                  >
                    {language.t("knowledge.integrity.repair")}
                  </Button>
                </Show>
              </div>
            </div>
          </Dialog>
        ))
      })
      .catch((error) => showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }))
      .finally(() => setBusy(false))
  }

  let libraryInput: HTMLInputElement | undefined

  const exportLibraryBackup = () => {
    setBusy(true)
    void globalSDK.client.knowledge
      .exportLibrary({ directory: directory() })
      .then((result) => {
        if (!result.data) return
        const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = "knowledge-library-" + Date.now() + ".json"
        anchor.click()
        URL.revokeObjectURL(url)
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("knowledge.library.exported", { count: result.data.collections.length }),
        })
      })
      .catch((error) => showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }))
      .finally(() => setBusy(false))
  }

  const importLibraryBackup = async (file: File) => {
    setBusy(true)
    try {
      const parsed = JSON.parse(await file.text()) as {
        format?: string
        exportedAt?: number
        collections?: Array<{
          name: string
          description?: string
          enabled?: boolean
          documents: Array<{
            title: string
            source?: string
            content: string
            version: number
            createdAt: number
            updatedAt: number
          }>
        }>
      }
      if (parsed.format !== "novaway.knowledge.library.v1" || !Array.isArray(parsed.collections)) {
        showToast({ title: language.t("knowledge.library.invalid") })
        return
      }
      const result = await globalSDK.client.knowledge.importLibrary({
        directory: directory(),
        knowledgeLibraryExport: {
          format: "novaway.knowledge.library.v1",
          exportedAt: num(parsed.exportedAt ?? Date.now()),
          collections: parsed.collections,
        },
      })
      await loadCollections()
      const summary = result.data
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("knowledge.library.imported"),
        description: language.t("knowledge.library.summary", {
          collections: summary?.collections ?? 0,
          imported: summary?.imported ?? 0,
          updated: summary?.updated ?? 0,
          skipped: summary?.skipped ?? 0,
        }),
      })
    } catch (error) {
      showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const toggleMount = (collection: KnowledgeCollection) => {
    if (!sessionID()) return
    const next = mounted().includes(collection.id)
      ? mounted().filter((id) => id !== collection.id)
      : [...mounted(), collection.id]
    void globalSDK.client.knowledge.session
      .mount({ directory: directory(), sessionID: sessionID(), collectionIDs: next })
      .then((result) => setMounted(result.data ?? []))
      .catch((error) => showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }))
  }

  const loadGraph = () => {
    setGraphLoading(true)
    void globalSDK.client.knowledge
      .graph({ directory: directory(), collectionID: selected(), limit: "48" })
      .then((result) => setGraph(result.data ?? undefined))
      .catch((error) => showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }))
      .finally(() => setGraphLoading(false))
  }

  createEffect(() => {
    if (tab() !== "graph") return
    if (!selected()) return
    loadGraph()
  })

  let importInput: HTMLInputElement | undefined
  let restoreInput: HTMLInputElement | undefined
  const pickFiles = () => importInput?.click()

  const addDocument = () => {
    const collection = current()
    if (!collection) return
    const [form, setForm] = createStore({ title: "", content: "", source: "" })
    const [reading, setReading] = createSignal(false)
    let file: HTMLInputElement | undefined

    /**
     * 选文件后分两条路：
     * - 文本类（md/txt/csv/json…）：读进 textarea，用户还能改；
     * - 二进制文档（pdf/docx/pptx/xlsx/图片）：**直接走导入接口**，由服务端抽取正文。
     *   之前这里是 `File.text()` 通吃，把 zip/pdf 字节当 UTF-8 解码，
     *   入库后就是满屏乱码（还检索不到）。
     */
    const readFile = async (selectedFile: File) => {
      if (isBinaryDocument(selectedFile.name)) {
        setReading(true)
        try {
          const imported = await importSingleFile(selectedFile, collection.id)
          if (!imported) return
          dialog.close()
        } finally {
          setReading(false)
        }
        return
      }
      setReading(true)
      try {
        const text = await selectedFile.text()
        setForm({ content: text, source: selectedFile.name, title: form.title || selectedFile.name })
      } catch (error) {
        showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) })
      } finally {
        setReading(false)
      }
    }

    dialog.show(() => (
      <Dialog title={language.t("knowledge.document.add.title")} transition class="w-[min(calc(100vw-40px),720px)]">
        <form
          class="flex max-h-[calc(100vh-160px)] flex-col gap-4 overflow-y-auto px-2.5 pb-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!form.content.trim()) return
            setBusy(true)
            void globalSDK.client.knowledge
              .addDocument({
                directory: directory(),
                collectionID: collection.id,
                title: form.title.trim() || language.t("knowledge.document.untitled"),
                content: form.content,
                source: form.source.trim() || undefined,
              })
              .then(async () => {
                dialog.close()
                await loadDocuments(collection.id)
                await loadCollections(collection.id)
                showToast({
                  variant: "success",
                  icon: "circle-check",
                  title: language.t("knowledge.document.add.toast"),
                })
              })
              .catch((error) =>
                showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }),
              )
              .finally(() => setBusy(false))
          }}
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-12-regular text-foreground-subtle">{collection.name}</span>
            <div class="flex items-center gap-2">
              <input
                ref={file}
                type="file"
                accept=".md,.markdown,.txt,.json,.csv,.tsv,.log,.html,.htm,.xml,.yaml,.yml,.pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
                class="hidden"
                onChange={(event) => {
                  const picked = event.currentTarget.files?.[0]
                  event.currentTarget.value = ""
                  if (picked) void readFile(picked)
                }}
              />
              <Button
                type="button"
                size="small"
                variant="secondary"
                icon="cloud-upload"
                disabled={reading()}
                onClick={() => file?.click()}
              >
                {reading() ? language.t("common.loading") : language.t("knowledge.document.add.file")}
              </Button>
            </div>
          </div>
          <TextField
            label={language.t("knowledge.document.field.title")}
            placeholder={language.t("knowledge.document.field.title.placeholder")}
            value={form.title}
            onChange={(value) => setForm("title", value)}
          />
          <TextField
            label={language.t("knowledge.document.field.content")}
            placeholder={language.t("knowledge.document.field.content.placeholder")}
            multiline
            value={form.content}
            onChange={(value) => setForm("content", value)}
            class="min-h-56 max-h-[min(48vh,26rem)] overflow-y-auto"
          />
          <Show when={form.source}>
            <div class="text-12-regular text-foreground-subtle">
              {language.t("knowledge.document.field.source")}: {form.source}
            </div>
          </Show>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!form.content.trim() || busy()}>
              {language.t("knowledge.document.add.action")}
            </Button>
          </div>
        </form>
      </Dialog>
    ))
  }

  const [relatedDocs, setRelatedDocs] = createSignal<Array<{ id: string; title: string; shared: string[] }>>([])
  const [viewMode, setViewMode] = createSignal<"doc" | "source" | "chunks">("doc")
  const [docChunks, setDocChunks] = createSignal<Array<{ index: number; text: string; length: number }>>([])

  const loadRelated = (collectionID: string, documentID: string) => {
    setRelatedDocs([])
    void globalSDK.client.knowledge
      .related({ directory: directory(), collectionID, documentID, limit: "6" })
      .then((result) => setRelatedDocs(result.data ?? []))
      .catch(() => setRelatedDocs([]))
  }

  const viewDocument = (meta: KnowledgeDocumentMeta) => {
    setBusy(true)
    void globalSDK.client.knowledge
      .document({ directory: directory(), collectionID: meta.collectionID, documentID: meta.id })
      .then((result) => {
        const document = result.data
        if (!document) return
        dialog.show(() => (
          <Dialog
            title={document.title}
            transition
            class="w-[min(calc(100vw-40px),820px)] max-h-[calc(100vh-80px)] overflow-hidden"
          >
            <div class="flex max-h-[calc(100vh-160px)] flex-col gap-3 overflow-y-auto px-2.5 pb-3">
              <div class="flex flex-wrap items-center gap-3 text-12-regular text-foreground-subtle">
                <span>{formatSize(new TextEncoder().encode(document.content).length)}</span>
                <span>{formatTime(document.updatedAt)}</span>
                <Show when={document.source}>
                  <span>{document.source}</span>
                </Show>
              </div>
              <div class="flex items-center gap-1 self-start rounded-lg bg-surface p-0.5">
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1 text-11-medium transition-colors"
                  classList={{
                    "bg-background text-foreground shadow-sm": viewMode() === "doc",
                    "text-foreground-subtle hover:text-foreground": viewMode() !== "doc",
                  }}
                  onClick={() => setViewMode("doc")}
                >
                  {language.t("knowledge.view.doc")}
                </button>
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1 text-11-medium transition-colors"
                  classList={{
                    "bg-background text-foreground shadow-sm": viewMode() === "source",
                    "text-foreground-subtle hover:text-foreground": viewMode() !== "source",
                  }}
                  onClick={() => setViewMode("source")}
                >
                  {language.t("knowledge.view.source")}
                </button>
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1 text-11-medium transition-colors"
                  classList={{
                    "bg-background text-foreground shadow-sm": viewMode() === "chunks",
                    "text-foreground-subtle hover:text-foreground": viewMode() !== "chunks",
                  }}
                  onClick={() => {
                    setViewMode("chunks")
                    if (docChunks().length > 0) return
                    void globalSDK.client.knowledge
                      .documentChunks({
                        directory: directory(),
                        collectionID: document.collectionID,
                        documentID: document.id,
                      })
                      .then((result) =>
                        setDocChunks(
                          (result.data ?? []).map((chunk) => ({
                            index: num(chunk.index),
                            text: String(chunk.text),
                            length: num(chunk.length),
                          })),
                        ),
                      )
                      .catch(() => setDocChunks([]))
                  }}
                >
                  {language.t("knowledge.view.chunks")}
                </button>
              </div>
              <Show when={viewMode() === "chunks"}>
                <div class="flex flex-col gap-2">
                  <span class="text-11-regular text-foreground-subtle">
                    {language.t("knowledge.chunks.count", { count: docChunks().length })}
                  </span>
                  <div class="flex max-h-[min(48vh,26rem)] flex-col gap-2 overflow-y-auto">
                    <For each={docChunks()}>
                      {(chunk) => (
                        <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/40 p-3">
                          <span class="text-11-regular tabular-nums text-foreground-subtlest">
                            #{chunk.index + 1} · {chunk.length}
                          </span>
                          <span class="whitespace-pre-wrap break-words text-12-regular leading-5 text-foreground">
                            {chunk.text}
                          </span>
                        </div>
                      )}
                    </For>
                    <Show when={docChunks().length === 0}>
                      <div class="rounded-lg border border-dashed border-border px-3 py-6 text-center text-12-regular text-foreground-subtle">
                        {language.t("knowledge.chunks.empty")}
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>
              <Show
                when={viewMode() === "source"}
                fallback={
                  <Show when={viewMode() === "doc"}>
                    <div class="rounded-lg border border-border bg-surface/60 p-4 text-13-regular leading-6 text-foreground">
                      <Markdown text={document.content} cacheKey={`kb:${document.id}:${document.updatedAt}`} />
                    </div>
                  </Show>
                }
              >
                <KnowledgeTextView text={document.content} class="max-h-[min(56vh,32rem)]" />
              </Show>
              <Show when={relatedDocs().length > 0}>
                <div class="flex flex-col gap-1.5">
                  <span class="text-12-medium text-foreground-subtle">{language.t("knowledge.related.title")}</span>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={relatedDocs()}>
                      {(item) => (
                        <button
                          type="button"
                          class="max-w-full truncate rounded-md border border-border bg-surface px-2 py-1 text-12-regular text-foreground transition-colors hover:border-border-hover hover:bg-hover"
                          title={item.shared.join(", ")}
                          onClick={() => {
                            dialog.close()
                            const target = documents().find((entry) => entry.id === item.id)
                            if (target) viewDocument(target)
                          }}
                        >
                          {item.title}
                          <span class="ml-1 text-11-regular text-foreground-subtlest">{item.shared.length}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
              <div class="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  icon="pencil-line"
                  onClick={() => {
                    dialog.close()
                    editDocument(meta)
                  }}
                >
                  {language.t("knowledge.document.edit.action")}
                </Button>
                <Button variant="secondary" onClick={() => dialog.close()}>
                  {language.t("common.close")}
                </Button>
              </div>
            </div>
          </Dialog>
        ))
      })
      .catch((error) => showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }))
      .finally(() => setBusy(false))
    loadRelated(meta.collectionID, meta.id)
  }

  const editDocument = (meta: KnowledgeDocumentMeta) => {
    setBusy(true)
    void globalSDK.client.knowledge
      .document({ directory: directory(), collectionID: meta.collectionID, documentID: meta.id })
      .then((result) => {
        const document = result.data
        if (!document) return
        const [form, setForm] = createStore({
          title: document.title,
          content: document.content,
          source: document.source ?? "",
        })
        dialog.show(() => (
          <Dialog
            title={language.t("knowledge.document.edit.title")}
            transition
            class="w-[min(calc(100vw-40px),720px)]"
          >
            <form
              class="flex max-h-[calc(100vh-160px)] flex-col gap-4 overflow-y-auto px-2.5 pb-3"
              onSubmit={(event) => {
                event.preventDefault()
                if (!form.content.trim()) return
                setBusy(true)
                void globalSDK.client.knowledge
                  .updateDocument({
                    directory: directory(),
                    collectionID: document.collectionID,
                    documentID: document.id,
                    title: form.title.trim(),
                    content: form.content,
                    source: form.source.trim(),
                  })
                  .then(async () => {
                    dialog.close()
                    await loadDocuments(document.collectionID)
                    await loadCollections(document.collectionID)
                    showToast({
                      variant: "success",
                      icon: "circle-check",
                      title: language.t("knowledge.document.edit.toast"),
                    })
                  })
                  .catch((error) =>
                    showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }),
                  )
                  .finally(() => setBusy(false))
              }}
            >
              <TextField
                label={language.t("knowledge.document.field.title")}
                value={form.title}
                onChange={(value) => setForm("title", value)}
              />
              <TextField
                label={language.t("knowledge.document.field.content")}
                multiline
                value={form.content}
                onChange={(value) => setForm("content", value)}
                class="min-h-56 max-h-[min(48vh,26rem)] overflow-y-auto"
              />
              <TextField
                label={language.t("knowledge.document.field.source")}
                value={form.source}
                onChange={(value) => setForm("source", value)}
              />
              <div class="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => dialog.close()}>
                  {language.t("common.cancel")}
                </Button>
                <Button type="submit" disabled={!form.content.trim() || busy()}>
                  {language.t("common.save")}
                </Button>
              </div>
            </form>
          </Dialog>
        ))
      })
      .catch((error) => showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }))
      .finally(() => setBusy(false))
  }

  const removeDocument = (meta: KnowledgeDocumentMeta) => {
    confirm({
      title: language.t("knowledge.document.delete.title"),
      description: language.t("knowledge.document.delete.toTrash", { name: meta.title }),
      onConfirm: async () => {
        await globalSDK.client.knowledge.removeDocument({
          directory: directory(),
          collectionID: meta.collectionID,
          documentID: meta.id,
        })
        await loadDocuments(meta.collectionID)
        await loadCollections(meta.collectionID)
      },
    })
  }

  /**
   * 打开检索命中：默认「原文定位」视图。
   *
   * Markdown 渲染会重排文本，无法可靠映射源文偏移，所以定位视图必须用原始文本；
   * 想看排版效果可以切到 Markdown 标签。
   */
  const openHit = (document: KnowledgeDocument, hit: KnowledgeHit) => {
    const [view, setView] = createSignal<"text" | "markdown">("text")
    dialog.show(() => (
      <Dialog
        title={document.title}
        transition
        class="w-[min(calc(100vw-40px),860px)] max-h-[calc(100vh-80px)] overflow-hidden"
      >
        <div class="flex min-h-0 flex-col gap-3 px-2.5 pb-3">
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-1 rounded-lg bg-surface p-0.5">
              <button
                type="button"
                class="rounded-md px-2.5 py-1 text-12-medium transition-colors"
                classList={{
                  "bg-background text-foreground shadow-sm": view() === "text",
                  "text-foreground-subtle hover:text-foreground": view() !== "text",
                }}
                onClick={() => setView("text")}
              >
                {language.t("knowledge.hit.view.text")}
              </button>
              <button
                type="button"
                class="rounded-md px-2.5 py-1 text-12-medium transition-colors"
                classList={{
                  "bg-background text-foreground shadow-sm": view() === "markdown",
                  "text-foreground-subtle hover:text-foreground": view() !== "markdown",
                }}
                onClick={() => setView("markdown")}
              >
                {language.t("knowledge.hit.view.markdown")}
              </button>
            </div>
            <div class="flex-1" />
            <span class="text-11-regular text-foreground-subtlest">
              {language.t("knowledge.hit.score", { score: Number(hit.score).toFixed(3) })}
            </span>
          </div>

          <div class="flex max-h-[calc(100vh-220px)] min-h-0 flex-col overflow-y-auto">
            <Show
              when={view() === "text"}
              fallback={
                <div class="rounded-lg border border-border bg-surface/60 p-4 text-13-regular leading-6 text-foreground">
                  <Markdown text={document.content} cacheKey={`kb:${document.id}:${document.updatedAt}`} />
                </div>
              }
            >
              <KnowledgeTextView
                text={document.content}
                snippet={hit.snippet}
                // schema 把 number 序列化成 number | "NaN" | "Infinity"…，这里只接受有限值。
                offset={Number.isFinite(Number(hit.offset)) ? Number(hit.offset) : undefined}
                class="max-h-[calc(100vh-260px)]"
              />
            </Show>
          </div>

          <div class="flex justify-end">
            <Button variant="secondary" onClick={() => dialog.close()}>
              {language.t("common.close")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  /** 回收站：列出已删除文档，可恢复或清空。 */
  const openTrash = () => {
    const collection = current()
    if (!collection) return
    const [items, setItems] = createSignal<Array<{ document: KnowledgeDocumentMeta; deletedAt: number }>>([])
    const [loading, setLoading] = createSignal(true)

    const load = () => {
      setLoading(true)
      void globalSDK.client.knowledge
        .listTrash({ directory: directory(), collectionID: collection.id })
        .then((result) => setItems((result.data ?? []) as never))
        .catch(() => setItems([]))
        .finally(() => setLoading(false))
    }
    load()

    const restore = (documentID: string) => {
      void globalSDK.client.knowledge
        .restoreTrash({ directory: directory(), collectionID: collection.id, documentID })
        .then(async () => {
          load()
          await loadDocuments(collection.id)
          await loadCollections(collection.id)
          showToast({ variant: "success", icon: "circle-check", title: language.t("knowledge.trash.restored") })
        })
        .catch((error) => showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }))
    }

    const empty = () => {
      void globalSDK.client.knowledge
        .emptyTrash({ directory: directory(), collectionID: collection.id })
        .then((result) => {
          load()
          showToast({
            title: language.t("knowledge.trash.emptied", { count: result.data?.removed ?? 0 }),
          })
        })
        .catch((error) => showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }))
    }

    dialog.show(() => (
      <Dialog
        title={language.t("knowledge.trash.title", { name: collection.name })}
        transition
        class="w-[min(calc(100vw-40px),560px)]"
      >
        <div class="flex flex-col gap-3 px-2.5 pb-3">
          <span class="text-12-regular text-foreground-subtle">{language.t("knowledge.trash.hint")}</span>
          <Show
            when={!loading()}
            fallback={
              <div class="py-6 text-center text-12-regular text-foreground-subtle">{language.t("common.loading")}</div>
            }
          >
            <Show
              when={items().length > 0}
              fallback={
                <div class="rounded-lg border border-dashed border-border px-3 py-8 text-center text-12-regular text-foreground-subtle">
                  {language.t("knowledge.trash.empty")}
                </div>
              }
            >
              <div class="flex max-h-72 flex-col overflow-y-auto rounded-lg border border-border">
                <For each={items()}>
                  {(item) => (
                    <div class="flex items-center gap-2 border-t border-border px-3 py-2 first:border-t-0">
                      <Icon name="trash" size="small" class="shrink-0 text-foreground-subtle" />
                      <span class="min-w-0 flex-1 truncate text-12-regular text-foreground">{item.document.title}</span>
                      <span class="shrink-0 text-11-regular text-foreground-subtlest">
                        {formatRelativeTime(item.deletedAt, Date.now(), language.t)}
                      </span>
                      <Button size="small" variant="secondary" onClick={() => restore(item.document.id)}>
                        {language.t("knowledge.trash.restore")}
                      </Button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
          <div class="flex justify-end gap-2">
            <Show when={items().length > 0}>
              <Button variant="ghost" onClick={empty}>
                {language.t("knowledge.trash.emptyAction")}
              </Button>
            </Show>
            <Button variant="secondary" onClick={() => dialog.close()}>
              {language.t("common.close")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const collectionName = (id: string) => collections().find((item) => item.id === id)?.name ?? id

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      {/* 顶行右侧 108px 是覆盖层补的窗控条：筛选器放在标题后面（靠左），
          并用 PageHeader 的同一套内边距保证不会压到窗控上。 */}
      <div class="flex h-14 shrink-0 items-center gap-3 border-b border-border pl-3 pr-[108px]">
        <IconButton icon="arrow-left" variant="ghost" aria-label={language.t("common.goBack")} onClick={props.onBack} />
        <span
          class="grid size-8 shrink-0 place-items-center rounded-lg"
          style={{ color: "#10b981", background: "color-mix(in srgb, #10b981 16%, transparent)" }}
        >
          <Icon name="review" size="normal" />
        </span>
        <div class="flex min-w-0 flex-col">
          <span class="truncate text-15-medium text-foreground">{language.t("knowledge.title")}</span>
          <span class="truncate text-11-regular text-foreground-subtle">{language.t("knowledge.subtitle")}</span>
        </div>
        <div class="flex-1" />
        <Show when={ocr()}>
          {(status) => (
            <button
              type="button"
              class="flex h-7 items-center gap-1.5 rounded-md border px-2 text-11-regular transition-colors"
              classList={{
                "border-[color-mix(in_srgb,#f59e0b_35%,var(--border))] bg-[color-mix(in_srgb,#f59e0b_10%,transparent)] text-[#b45309] hover:bg-[color-mix(in_srgb,#f59e0b_16%,transparent)]":
                  status().kind === "none",
                "border-border bg-surface text-foreground-subtle hover:bg-hover": status().kind !== "none",
              }}
              title={status().hint}
              onClick={openOcrInstall}
            >
              <Icon name={status().kind === "none" ? "circle-ban-sign" : "eye"} size="small" />
              {status().kind === "none" ? language.t("knowledge.ocr.missing") : status().label}
            </button>
          )}
        </Show>
        <div class="flex items-center gap-1 rounded-lg bg-surface p-0.5">
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-12-medium transition-colors"
            classList={{
              "bg-background text-foreground shadow-sm": tab() === "docs",
              "text-foreground-subtle hover:text-foreground": tab() !== "docs",
            }}
            onClick={() => setTab("docs")}
          >
            {language.t("knowledge.tab.docs")}
          </button>
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-12-medium transition-colors"
            classList={{
              "bg-background text-foreground shadow-sm": tab() === "graph",
              "text-foreground-subtle hover:text-foreground": tab() !== "graph",
            }}
            onClick={() => setTab("graph")}
          >
            {language.t("knowledge.tab.graph")}
          </button>
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-12-medium transition-colors"
            classList={{
              "bg-background text-foreground shadow-sm": tab() === "eval",
              "text-foreground-subtle hover:text-foreground": tab() !== "eval",
            }}
            onClick={() => setTab("eval")}
          >
            {language.t("knowledge.tab.eval")}
          </button>
        </div>
        <div class="flex h-8 w-64 min-w-0 items-center gap-2 rounded-lg bg-surface px-2.5">
          <Icon name="magnifying-glass" size="small" class="shrink-0 text-foreground-subtlest" />
          <input
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder={language.t("knowledge.search.placeholder")}
            class="min-w-0 flex-1 bg-transparent text-13-regular text-foreground outline-none placeholder:text-foreground-subtlest"
          />
          <Show when={query()}>
            <button
              type="button"
              class="shrink-0 text-foreground-subtlest hover:text-foreground"
              onClick={() => setQuery("")}
              aria-label={language.t("knowledge.search.clear")}
            >
              <Icon name="close-small" size="small" />
            </button>
          </Show>
        </div>
      </div>

      <Show when={overview()}>
        {(value) => (
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-1.5 text-11-regular text-foreground-subtle">
            <span>{language.t("knowledge.overview.collections", { count: num(value().collections) })}</span>
            <span>{language.t("knowledge.overview.documents", { count: num(value().documents) })}</span>
            <span>{language.t("knowledge.overview.chunks", { count: num(value().chunks) })}</span>
            <span class="ml-auto tabular-nums">
              {language.t("knowledge.overview.characters", { count: num(value().characters) })}
            </span>
          </div>
        )}
      </Show>

      <Show when={runningImport()}>
        {(job) => (
          <div class="flex items-center gap-2 border-b border-border bg-[color-mix(in_srgb,#3b82f6_8%,transparent)] px-3 py-1.5">
            <span class="size-3 shrink-0 animate-spin rounded-full border-2 border-[var(--icon-blue)] border-t-transparent" />
            <span class="min-w-0 flex-1 truncate text-11-regular text-foreground">
              {language.t("knowledge.import.running", {
                processed: num(job().progress.processed),
                total: num(job().progress.total),
              })}
              <Show when={job().progress.current}>
                {(name) => <span class="text-foreground-subtle"> · {name()}</span>}
              </Show>
            </span>
            <div class="h-1 w-32 shrink-0 overflow-hidden rounded-full bg-surface">
              <Show
                when={num(job().progress.processed) > 0}
                fallback={
                  /* 第一个文件还在解析：宽度未知，用流动动画表示「在做事」。 */
                  <div class="knowledge-import-indeterminate h-full w-1/3 rounded-full bg-[var(--icon-blue)]" />
                }
              >
                <div
                  class="h-full rounded-full bg-[var(--icon-blue)] transition-[width] duration-300"
                  style={{
                    width:
                      Math.round((num(job().progress.processed) / Math.max(num(job().progress.total), 1)) * 100) + "%",
                  }}
                />
              </Show>
            </div>
            <Button size="small" variant="ghost" icon="stop" onClick={cancelImport}>
              {language.t("knowledge.import.cancel")}
            </Button>
          </div>
        )}
      </Show>

      <div class="flex min-h-0 flex-1">
        <aside class="flex w-64 shrink-0 flex-col border-r border-border">
          <div class="p-2 pb-0">
            <Button
              variant="primary"
              size="small"
              icon="plus-small"
              class="w-full justify-start"
              onClick={createCollection}
            >
              {language.t("knowledge.collection.create.action")}
            </Button>
          </div>
          <div class="flex-1 overflow-y-auto p-2">
            <Show
              when={!loading()}
              fallback={
                <div class="px-2 py-3 text-12-regular text-foreground-subtle">{language.t("common.loading")}</div>
              }
            >
              <Show
                when={collections().length > 0}
                fallback={
                  <div class="px-2 py-6 text-center text-12-regular text-foreground-subtle">
                    {language.t("knowledge.collection.empty")}
                  </div>
                }
              >
                <For each={collections()}>
                  {(collection) => (
                    <div
                      class="group flex items-center gap-2 rounded-md px-2 py-2 transition-colors"
                      classList={{
                        "bg-selected": selected() === collection.id,
                        "hover:bg-hover": selected() !== collection.id,
                      }}
                    >
                      <button
                        type="button"
                        class="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => setSelected(collection.id)}
                      >
                        <span
                          class="grid size-6 shrink-0 place-items-center rounded-md"
                          style={{ color: "#10b981", background: "color-mix(in srgb, #10b981 14%, transparent)" }}
                        >
                          <Icon name="review" size="small" />
                        </span>
                        <span class="min-w-0 flex-1 flex-col">
                          <span class="block truncate text-13-regular text-foreground">{collection.name}</span>
                          <span class="flex items-center gap-1 text-11-regular text-foreground-subtlest">
                            <span class="tabular-nums">
                              {num(collection.documentCount)} {language.t("knowledge.documentsShort")}
                            </span>
                            <Show when={mounted().includes(collection.id)}>
                              <span class="rounded bg-[color-mix(in_srgb,#10b981_16%,transparent)] px-1 text-[10px] text-[#059669]">
                                {language.t("knowledge.mounted")}
                              </span>
                            </Show>
                            <Show when={collection.scope === "project"}>
                              <span class="rounded bg-[color-mix(in_srgb,#3b82f6_16%,transparent)] px-1 text-[10px] text-[#2563eb]">
                                {language.t("knowledge.scope.project")}
                              </span>
                            </Show>
                            <Show when={collection.readOnly}>
                              <span class="rounded bg-surface px-1 text-[10px] text-foreground-subtle">
                                {language.t("knowledge.readOnly")}
                              </span>
                            </Show>
                          </span>
                        </span>
                      </button>
                      <IconButton
                        icon={mounted().includes(collection.id) ? "pin" : "plus-small"}
                        variant="ghost"
                        size="small"
                        class="h-5 w-5 shrink-0"
                        classList={{ "text-[#059669]": mounted().includes(collection.id) }}
                        title={language.t("knowledge.mount.toggle")}
                        aria-label={language.t("knowledge.mount.toggle")}
                        disabled={!sessionID()}
                        onClick={() => toggleMount(collection)}
                      />
                      <Switch
                        checked={collection.enabled !== false}
                        onChange={(checked) => toggleCollection(collection, checked)}
                        hideLabel
                        title={language.t("knowledge.collection.enabled")}
                      >
                        {collection.name}
                      </Switch>
                      <IconButton
                        icon="pencil-line"
                        variant="ghost"
                        size="small"
                        class="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
                        aria-label={language.t("knowledge.collection.edit.action")}
                        onClick={() => editCollection(collection)}
                      />
                      <IconButton
                        icon="trash"
                        variant="ghost"
                        size="small"
                        class="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
                        aria-label={language.t("knowledge.collection.delete.action")}
                        onClick={() => removeCollection(collection)}
                      />
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </aside>

        <main
          class="min-w-0 flex-1 overflow-y-auto transition-colors data-[dragging=true]:bg-primary/5"
          onDragOver={(event) => {
            if (!current()) return
            event.preventDefault()
            event.currentTarget.dataset.dragging = "true"
          }}
          onDragLeave={(event) => {
            delete event.currentTarget.dataset.dragging
          }}
          onDrop={(event) => {
            event.preventDefault()
            delete event.currentTarget.dataset.dragging
            const files = Array.from(event.dataTransfer?.files ?? [])
            if (files.length > 0) void importFiles(files)
          }}
        >
          <Show when={!query().trim() && recent().length > 0}>
            <div class="flex flex-wrap items-center gap-1.5 px-4 pt-3">
              <span class="text-11-regular text-foreground-subtlest">{language.t("knowledge.recent.title")}</span>
              <For each={recent().slice(0, 8)}>
                {(item) => (
                  <button
                    type="button"
                    class="max-w-44 truncate rounded-md border border-border bg-surface px-2 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                    title={item.query}
                    onClick={() => setQuery(item.query)}
                  >
                    {item.query}
                  </button>
                )}
              </For>
              <button
                type="button"
                class="rounded-md px-1.5 py-0.5 text-11-regular text-foreground-subtlest transition-colors hover:text-foreground"
                onClick={() => {
                  const id = selected()
                  if (!id) return
                  void globalSDK.client.knowledge
                    .clearQueries({ directory: directory(), collectionID: id })
                    .then(() => setRecent([]))
                    .catch(() => undefined)
                }}
              >
                {language.t("knowledge.recent.clear")}
              </button>
            </div>
          </Show>
          <Show
            when={query().trim()}
            fallback={
              <Show
                when={current()}
                fallback={
                  <div class="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
                    <div class="grid size-20 place-items-center rounded-2xl border border-border bg-surface text-foreground-subtle shadow-sm">
                      <Icon name="review" size="large" />
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <span class="text-16-medium text-foreground">{language.t("knowledge.empty.title")}</span>
                      <span class="text-13-regular text-foreground-subtle">
                        {language.t("knowledge.empty.description")}
                      </span>
                    </div>
                    <Button size="large" icon="plus-small" onClick={createCollection}>
                      {language.t("knowledge.collection.create.action")}
                    </Button>
                  </div>
                }
              >
                {(collection) => (
                  <div class="flex flex-col gap-4 p-4">
                    <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/40 p-3">
                      <div class="flex min-w-0 items-center gap-3">
                        <span
                          class="grid size-10 shrink-0 place-items-center rounded-xl"
                          style={{ color: "#10b981", background: "color-mix(in srgb, #10b981 16%, transparent)" }}
                        >
                          <Icon name="review" size="normal" />
                        </span>
                        <div class="flex min-w-0 flex-col">
                          <div class="flex min-w-0 items-center gap-2">
                            <span class="truncate text-15-medium text-foreground">{collection().name}</span>
                            <Show when={mounted().includes(collection().id)}>
                              <span class="shrink-0 rounded bg-[color-mix(in_srgb,#10b981_16%,transparent)] px-1.5 py-0.5 text-11-regular text-[#059669]">
                                {language.t("knowledge.mount.current")}
                              </span>
                            </Show>
                          </div>
                          <span class="truncate text-12-regular text-foreground-subtle">
                            {collection().description || language.t("knowledge.collection.defaultDescription")}
                          </span>
                          <Show when={stats()}>
                            {(value) => (
                              <span class="truncate text-11-regular text-foreground-subtlest">
                                {language.t("knowledge.stats", {
                                  documents: num(value().documents),
                                  chunks: num(value().chunks),
                                  characters: num(value().characters),
                                })}
                              </span>
                            )}
                          </Show>
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <Button
                          size="small"
                          variant="secondary"
                          icon="pin"
                          disabled={!sessionID()}
                          onClick={() => toggleMount(collection())}
                        >
                          {mounted().includes(collection().id)
                            ? language.t("knowledge.mount.remove")
                            : language.t("knowledge.mount.add")}
                        </Button>
                        <input
                          ref={importInput}
                          type="file"
                          multiple
                          class="hidden"
                          accept=".md,.markdown,.txt,.json,.csv,.tsv,.log,.html,.htm,.xml,.yaml,.yml,.pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
                          onChange={(event) => {
                            const files = Array.from(event.currentTarget.files ?? [])
                            event.currentTarget.value = ""
                            if (files.length > 0) void importFiles(files)
                          }}
                        />
                        <Button size="small" variant="secondary" icon="cloud-upload" onClick={pickFiles}>
                          {language.t("knowledge.document.import")}
                        </Button>
                        <input
                          ref={(el) => (restoreInput = el)}
                          type="file"
                          accept=".json,application/json"
                          class="hidden"
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0]
                            event.currentTarget.value = ""
                            if (file) void restoreBackup(collection(), file)
                          }}
                        />
                        <Button
                          size="small"
                          variant="ghost"
                          icon="cloud-upload"
                          disabled={busy()}
                          onClick={() => restoreInput?.click()}
                        >
                          {language.t("knowledge.restore")}
                        </Button>
                        <Button
                          size="small"
                          variant="ghost"
                          icon="download"
                          disabled={busy()}
                          onClick={() => exportCollection(collection())}
                        >
                          {language.t("knowledge.export")}
                        </Button>
                        <Button size="small" variant="ghost" icon="shield" disabled={busy()} onClick={checkIntegrity}>
                          {language.t("knowledge.integrity.action")}
                        </Button>
                        <Button
                          size="small"
                          variant="ghost"
                          icon="refresh"
                          disabled={busy()}
                          onClick={() => {
                            const id = collection().id
                            setBusy(true)
                            void globalSDK.client.knowledge
                              .reindex({ directory: directory(), collectionID: id })
                              .then((result) => {
                                setStats(result.data ?? undefined)
                                showToast({
                                  variant: "success",
                                  icon: "circle-check",
                                  title: language.t("knowledge.reindex.toast"),
                                })
                              })
                              .catch((error) =>
                                showToast({
                                  title: language.t("common.requestFailed"),
                                  description: errorMessage(error),
                                }),
                              )
                              .finally(() => setBusy(false))
                          }}
                        >
                          {language.t("knowledge.reindex")}
                        </Button>
                        <Button size="small" variant="ghost" icon="trash" onClick={openTrash}>
                          {language.t("knowledge.trash.action")}
                        </Button>
                        <Button size="small" icon="plus-small" onClick={addDocument}>
                          {language.t("knowledge.document.add.action")}
                        </Button>
                      </div>
                    </div>

                    <Show when={tab() === "graph"}>
                      <div class="flex flex-col gap-2">
                        <div class="flex items-center justify-between gap-2">
                          <span class="text-13-medium text-foreground">{language.t("knowledge.graph.title")}</span>
                          <div class="flex items-center gap-2">
                            <span class="text-12-regular text-foreground-subtle">
                              {language.t("knowledge.graph.summary", {
                                nodes: graph()?.nodes.length ?? 0,
                                edges: graph()?.edges.length ?? 0,
                              })}
                            </span>
                            <Button size="small" variant="ghost" icon="refresh" onClick={loadGraph}>
                              {language.t("common.refresh")}
                            </Button>
                          </div>
                        </div>
                        <Show
                          when={!graphLoading()}
                          fallback={
                            <div class="rounded-xl border border-dashed border-border px-6 py-16 text-center text-13-regular text-foreground-subtle">
                              {language.t("common.loading")}
                            </div>
                          }
                        >
                          <Show
                            when={(graph()?.nodes.length ?? 0) > 0}
                            fallback={
                              <div class="rounded-xl border border-dashed border-border px-6 py-16 text-center text-13-regular text-foreground-subtle">
                                {language.t("knowledge.graph.empty")}
                              </div>
                            }
                          >
                            <KnowledgeGraphView
                              graph={graph()!}
                              onSelect={(label) => {
                                setQuery(label)
                                setTab("docs")
                              }}
                            />
                          </Show>
                        </Show>
                      </div>
                    </Show>

                    <Show when={tab() === "eval"}>
                      <KnowledgeEvalPanel
                        directory={directory}
                        collectionID={() => collection().id}
                        documents={documents}
                      />
                    </Show>

                    <Show when={tab() === "docs"}>
                      <div class="flex flex-wrap items-center gap-2">
                        <div class="flex h-8 min-w-40 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2.5">
                          <Icon name="magnifying-glass" size="small" class="shrink-0 text-foreground-subtlest" />
                          <input
                            value={docFilter()}
                            onInput={(event) => setDocFilter(event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter") return
                              void loadDocuments(collection().id)
                            }}
                            placeholder={language.t("knowledge.documents.filter")}
                            class="min-w-0 flex-1 bg-transparent text-12-regular text-foreground outline-none placeholder:text-foreground-subtlest"
                          />
                        </div>
                        <Show when={selectedDocs().length > 0}>
                          <Button size="small" variant="secondary" icon="folder" disabled={busy()} onClick={bulkMove}>
                            {language.t("knowledge.bulk.move.action", { count: selectedDocs().length })}
                          </Button>
                          <Button
                            size="small"
                            variant="ghost"
                            icon="trash"
                            class="text-destructive"
                            disabled={busy()}
                            onClick={bulkRemove}
                          >
                            {language.t("knowledge.bulk.delete.action", { count: selectedDocs().length })}
                          </Button>
                        </Show>
                        <span class="shrink-0 text-11-regular tabular-nums text-foreground-subtlest">
                          {language.t("knowledge.documents.count", { shown: documents().length, total: docTotal() })}
                        </span>
                      </div>

                      <Show
                        when={documents().length > 0}
                        fallback={
                          <div class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center">
                            <Icon name="review" size="normal" class="text-foreground-subtlest" />
                            <span class="text-13-regular text-foreground-subtle">
                              {language.t("knowledge.document.empty")}
                            </span>
                            <Button size="small" variant="secondary" icon="plus-small" onClick={addDocument}>
                              {language.t("knowledge.document.add.action")}
                            </Button>
                          </div>
                        }
                      >
                        <div class="flex flex-col overflow-hidden rounded-xl border border-border">
                          <div class="flex items-center gap-2 border-b border-border bg-surface/40 px-3 py-1.5">
                            <button
                              type="button"
                              class="flex items-center gap-1.5 text-11-regular text-foreground-subtle transition-colors hover:text-foreground"
                              onClick={() => setSelectedDocs(allSelected() ? [] : documents().map((item) => item.id))}
                            >
                              <span
                                class="grid size-3.5 place-items-center rounded border"
                                classList={{
                                  "border-[var(--icon-blue)] bg-[var(--icon-blue)]": allSelected(),
                                  "border-border": !allSelected(),
                                }}
                              >
                                <Show when={allSelected()}>
                                  <Icon name="check-small" size="small" class="text-background" />
                                </Show>
                              </span>
                              {language.t("knowledge.documents.selectAll")}
                            </button>
                          </div>
                          <For each={documents()}>
                            {(document) => (
                              <div class="group flex min-w-0 items-center gap-2 border-t border-border px-3 py-3 transition-colors first:border-t-0 hover:bg-hover">
                                <button
                                  type="button"
                                  class="grid size-4 shrink-0 place-items-center rounded border"
                                  classList={{
                                    "border-[var(--icon-blue)] bg-[var(--icon-blue)]": selectedDocs().includes(
                                      document.id,
                                    ),
                                    "border-border": !selectedDocs().includes(document.id),
                                  }}
                                  aria-label={language.t("knowledge.documents.select")}
                                  onClick={() => toggleSelected(document.id)}
                                >
                                  <Show when={selectedDocs().includes(document.id)}>
                                    <Icon name="check-small" size="small" class="text-background" />
                                  </Show>
                                </button>
                                <button
                                  type="button"
                                  class="flex min-w-0 flex-1 items-center gap-3 text-left"
                                  onClick={() => viewDocument(document)}
                                >
                                  <span
                                    class="grid size-9 shrink-0 place-items-center rounded-lg"
                                    style={{
                                      color: FILE_TONE[knowledgeFileKind(document.title)].color,
                                      background: FILE_TONE[knowledgeFileKind(document.title)].background,
                                    }}
                                  >
                                    <Icon name={FILE_TONE[knowledgeFileKind(document.title)].icon} size="small" />
                                  </span>
                                  <span class="flex min-w-0 flex-1 flex-col">
                                    <span class="truncate text-13-regular text-foreground">{document.title}</span>
                                    <span class="truncate text-11-regular text-foreground-subtlest">
                                      <Show when={num(document.version ?? 1) > 1}>
                                        <span class="mr-1 rounded bg-surface px-1 text-10-medium text-foreground-subtle">
                                          v{document.version}
                                        </span>
                                      </Show>
                                      {formatSize(document.size)}
                                      {" · "}
                                      {formatTime(document.updatedAt)}
                                      {document.source ? ` · ${document.source}` : ""}
                                    </span>
                                  </span>
                                </button>
                                <IconButton
                                  icon="pencil-line"
                                  variant="ghost"
                                  size="small"
                                  class="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                                  aria-label={language.t("knowledge.document.edit.action")}
                                  onClick={() => editDocument(document)}
                                />
                                <IconButton
                                  icon="trash"
                                  variant="ghost"
                                  size="small"
                                  class="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                                  aria-label={language.t("knowledge.document.delete.action")}
                                  onClick={() => removeDocument(document)}
                                />
                              </div>
                            )}
                          </For>
                          <Show when={documents().length < docTotal()}>
                            <button
                              type="button"
                              class="border-t border-border py-2 text-12-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                              onClick={loadMoreDocuments}
                            >
                              {language.t("knowledge.documents.loadMore", {
                                remaining: docTotal() - documents().length,
                              })}
                            </button>
                          </Show>
                        </div>
                      </Show>
                    </Show>
                  </div>
                )}
              </Show>
            }
          >
            <div class="flex flex-col gap-3 p-4">
              <div class="flex items-center gap-2">
                <span class="text-13-medium text-foreground">{language.t("knowledge.search.results")}</span>
                <span class="text-12-regular text-foreground-subtle">{hits().length}</span>
                <Show when={searching()}>
                  <span class="text-12-regular text-foreground-subtlest">{language.t("common.loading")}</span>
                </Show>
              </div>
              <Show
                when={hits().length > 0}
                fallback={
                  <div class="rounded-xl border border-dashed border-border px-6 py-16 text-center text-13-regular text-foreground-subtle">
                    {language.t("knowledge.search.empty")}
                  </div>
                }
              >
                <div class="flex flex-col gap-2">
                  <For each={hits()}>
                    {(hit) => (
                      <button
                        type="button"
                        class="flex flex-col gap-1 rounded-xl border border-border bg-surface/40 p-3 text-left transition-colors hover:bg-surface"
                        onClick={() => {
                          setSelected(hit.collectionID)
                          void globalSDK.client.knowledge
                            .document({
                              directory: directory(),
                              collectionID: hit.collectionID,
                              documentID: hit.documentID,
                            })
                            .then((result) => {
                              const document: KnowledgeDocument | undefined = result.data
                              if (!document) return
                              openHit(document, hit)
                            })
                            .catch((error) =>
                              showToast({
                                title: language.t("common.requestFailed"),
                                description: errorMessage(error),
                              }),
                            )
                        }}
                      >
                        <div class="flex min-w-0 items-center gap-2">
                          <span class="min-w-0 flex-1 truncate text-13-medium text-foreground">
                            <For each={highlight(hit.title, query())}>
                              {(part) => (
                                <Show when={part.hit} fallback={<>{part.text}</>}>
                                  <mark class="rounded bg-[color-mix(in_srgb,#f59e0b_30%,transparent)] px-0.5 text-foreground">
                                    {part.text}
                                  </mark>
                                </Show>
                              )}
                            </For>
                          </span>
                          <span class="shrink-0 text-11-regular text-foreground-subtlest">
                            {collectionName(hit.collectionID)}
                          </span>
                        </div>
                        <span class="line-clamp-3 text-12-regular leading-5 text-foreground-subtle">
                          <For each={highlight(hit.snippet, query())}>
                            {(part) => (
                              <Show when={part.hit} fallback={<>{part.text}</>}>
                                <mark class="rounded bg-[color-mix(in_srgb,#f59e0b_28%,transparent)] px-0.5 text-foreground">
                                  {part.text}
                                </mark>
                              </Show>
                            )}
                          </For>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </main>
      </div>
    </div>
  )
}

/** 知识图谱：圆形布局 + 悬停高亮邻居。不引第三方图库，保持轻量。 */
function KnowledgeGraphView(props: { graph: KnowledgeGraph; onSelect?: (label: string) => void }) {
  const language = useLanguage()
  const [hover, setHover] = createSignal<string>()
  const size = 560
  const radius = 210

  const points = createMemo(() => {
    const nodes = props.graph.nodes
    return nodes.map((node, index) => {
      const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2
      return {
        ...node,
        x: size / 2 + Math.cos(angle) * radius,
        y: size / 2 + Math.sin(angle) * radius,
      }
    })
  })

  const position = createMemo(() => new Map(points().map((node) => [node.id, node])))
  const neighbors = createMemo(() => {
    const active = hover()
    if (!active) return undefined
    const set = new Set<string>([active])
    for (const edge of props.graph.edges) {
      if (edge.source === active) set.add(edge.target)
      if (edge.target === active) set.add(edge.source)
    }
    return set
  })

  return (
    <div class="flex flex-col gap-2 rounded-xl border border-border bg-surface/30 p-2">
      <div class="flex items-center justify-center overflow-auto">
        <svg width={size} height={size} viewBox={"0 0 " + size + " " + size} class="max-w-full">
          <For each={props.graph.edges}>
            {(edge) => {
              const from = () => position().get(edge.source)
              const to = () => position().get(edge.target)
              return (
                <Show when={from() && to()}>
                  <line
                    x1={from()!.x}
                    y1={from()!.y}
                    x2={to()!.x}
                    y2={to()!.y}
                    stroke="var(--border-hover)"
                    stroke-width={Math.min(1 + num(edge.weight) / 3, 3)}
                    opacity={
                      hover() ? (neighbors()?.has(edge.source) && neighbors()?.has(edge.target) ? 0.9 : 0.12) : 0.45
                    }
                  />
                </Show>
              )
            }}
          </For>
          <For each={points()}>
            {(node) => (
              <g
                class={props.onSelect ? "cursor-pointer" : "cursor-default"}
                onMouseEnter={() => setHover(node.id)}
                onMouseLeave={() => setHover(undefined)}
                onClick={() => props.onSelect?.(node.label)}
                opacity={hover() ? (neighbors()?.has(node.id) ? 1 : 0.25) : 1}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={Math.min(7 + Math.log2(num(node.weight) + 1) * 1.6, 15)}
                  fill={hover() === node.id ? "#059669" : "#10b981"}
                  fill-opacity={0.85}
                  stroke="var(--background)"
                  stroke-width={1.5}
                />
                <text
                  x={node.x}
                  y={node.y + 22}
                  text-anchor="middle"
                  class="select-none"
                  style={{ "font-size": "11px", fill: "var(--foreground-subtle)" }}
                >
                  {node.label.length > 12 ? node.label.slice(0, 12) + "…" : node.label}
                </text>
              </g>
            )}
          </For>
        </svg>
      </div>
      <div class="px-2 pb-1 text-11-regular text-foreground-subtlest">
        {language.t(props.onSelect ? "knowledge.graph.clickHint" : "knowledge.graph.hint")}
      </div>
    </div>
  )
}
