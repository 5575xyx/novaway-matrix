import { createMemo, createSignal, For, Show } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { usePrompt } from "@/context/prompt"
import { useLocal } from "@/context/local"
import { useFile } from "@/context/file"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { zenActions } from "@/pages/home/zen-office"
import { createOpenSessionFileTab } from "@/pages/session/helpers"
import { useOfficeAgent } from "@/pages/session/office-agent-context"
import { officeAgentPromptDraft, officeAgentScenario } from "@/pages/session/office-agent-scenarios"
import {
  createCustomPptTemplate,
  officePptTemplateDescription,
  officePptTemplateName,
  officePptTemplates,
  officePptTemplateVisual,
  type OfficePptTemplateChoice,
  type PptVisualTemplate,
} from "@/pages/session/office-export"
import { useSessionLayout } from "@/pages/session/session-layout"

export const OFFICE_AGENT_SIDEBAR_WIDTH = 292
export const OFFICE_PPT_TEMPLATE_SIDEBAR_WIDTH = 336
type OfficeArtifactKind = "document" | "ppt"
type OfficeArtifactItem = {
  kind: OfficeArtifactKind
  path: string
  filename: string
  bytes: number | string
  modified: number | string
}

const artifactKindByAction: Record<(typeof zenActions)[number]["id"], OfficeArtifactKind> = {
  document: "document",
  ppt: "ppt",
}

export function OfficeAgentSidebar() {
  const office = useOfficeAgent()
  const local = useLocal()
  const prompt = usePrompt()
  const sdk = useSDK()
  const file = useFile()
  const platform = usePlatform()
  const { tabs, view } = useSessionLayout()
  const scenario = () => officeAgentScenario(office.activeID())
  const artifactQuery = createQuery(() => ({
    queryKey: ["office-artifacts", sdk.directory],
    queryFn: () => sdk.client.office.artifact.list({ directory: sdk.directory }).then((x) => x.data ?? []),
  }))
  const artifacts = createMemo(() => (artifactQuery.data ?? []) as OfficeArtifactItem[])
  const sceneArtifacts = createMemo(() =>
    artifacts()
      .filter((artifact) => artifact.kind === artifactKindByAction[office.activeID()])
      .slice(0, 8),
  )
  const openTab = createOpenSessionFileTab({
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel: () => {
      if (!view().reviewPanel.opened()) view().reviewPanel.open()
    },
    setActive: tabs().setActive,
  })
  const openOfficeArtifact = (artifact: OfficeArtifactItem) => {
    if (platform.openPath) {
      void platform
        .openPath(`${sdk.directory.replace(/[\\/]+$/, "")}/${artifact.path}`)
        .catch(() => openTab(file.tab(artifact.path)))
      return
    }
    openTab(file.tab(artifact.path))
  }
  const reviseOfficeArtifact = (artifact: OfficeArtifactItem) => {
    const content = officeArtifactRevisionPrompt(artifact, office.activeAction().title, scenario())
    prompt.set([{ type: "text", content, start: 0, end: content.length }], content.length)
  }
  const selectScenario = (id: (typeof zenActions)[number]["id"]) => {
    office.select(id)
    const next = officeAgentScenario(id)
    if (local.agent.list().some((agent) => agent.name === next.agentName)) local.agent.set(next.agentName)
  }

  const useQuickPrompt = (text: string) => {
    const content = officeAgentPromptDraft(office.activeID(), text)
    prompt.set([{ type: "text", content, start: 0, end: content.length }], content.length)
  }
  return (
    <aside
      class="hidden h-full shrink-0 border-r border-border-weaker-base bg-background-base/96 px-3 py-3 md:flex md:flex-col"
      style={{ width: `${OFFICE_AGENT_SIDEBAR_WIDTH}px` }}
      aria-label="办公场景操作台"
    >
      <div class="mb-3 px-1">
        <div class="text-13-medium text-text-strong">办公场景</div>
        <div class="mt-1 text-11-regular leading-relaxed text-text-weak">
          每个场景有独立工作流；Skill 仍可跨智能体复用。
        </div>
      </div>
      <div class="flex shrink-0 flex-col gap-1">
        <For each={zenActions}>
          {(action) => (
            <button
              type="button"
              class="group flex w-full items-center gap-2 rounded-[8px] border px-2.5 py-2 text-left transition-colors"
              classList={{
                "border-emerald-300/35 bg-emerald-300/10 text-emerald-100": office.activeID() === action.id,
                "border-transparent text-text-weak hover:border-border-weak-base hover:bg-surface-raised-base hover:text-text-strong":
                  office.activeID() !== action.id,
              }}
              onClick={() => selectScenario(action.id)}
            >
              <span class="grid size-8 shrink-0 place-items-center rounded-[8px] border border-border-weaker-base bg-background-base/60">
                <Icon name={action.icon} size="small" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-13-medium">{action.title}</span>
                <span class="mt-0.5 block truncate text-11-regular opacity-70">{action.meta}</span>
              </span>
            </button>
          )}
        </For>
      </div>
      <div class="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-border-weaker-base pt-3 no-scrollbar">
        <div class="mb-2 px-1 text-11-medium text-text-weak">场景操作台</div>
        <div class="flex flex-col gap-2.5">
          <div class="rounded-[8px] border border-border-weaker-base bg-surface-raised-base/55 p-3">
            <div class="text-11-medium text-emerald-200">当前目标</div>
            <div class="mt-1 text-12-regular leading-relaxed text-text-base">{scenario().intent}</div>
            <div class="mt-2 inline-flex w-fit rounded-[6px] border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-10-medium text-emerald-100">
              Agent: {scenario().agentName}
            </div>
            <div class="mt-1 inline-flex w-fit rounded-[6px] border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-10-medium text-emerald-100">
              Skill: {scenario().skillName}
            </div>
          </div>

          <OfficeArtifactLibrary
            artifacts={sceneArtifacts()}
            loading={artifactQuery.isLoading}
            total={artifacts().length}
            onOpen={openOfficeArtifact}
            onRevise={reviseOfficeArtifact}
          />
          <Show when={office.activeID() !== "ppt"}>
            <Show when={scenario().quickPrompts.length > 0}>
              <div class="rounded-[8px] border border-border-weaker-base bg-surface-raised-base/55 p-3">
                <div class="text-11-medium text-text-weak">快捷模板</div>
                <div class="mt-2 flex flex-col gap-1.5">
                  <For each={scenario().quickPrompts}>
                    {(item) => (
                      <button
                        type="button"
                        class="rounded-[6px] border border-border-weaker-base px-2 py-1.5 text-left text-12-regular text-text-base transition-colors hover:border-emerald-300/35 hover:bg-emerald-300/10 hover:text-emerald-100"
                        onClick={() => useQuickPrompt(item)}
                      >
                        {item}
                      </button>
                    )}
                  </For>
                </div>
                <div class="mt-2 text-10-regular leading-relaxed text-text-weak">
                  点击后只填入对话框，不会自动发送。
                </div>
              </div>
            </Show>
            <ScenarioList title="需要资料" items={scenario().inputFocus} />
            <ScenarioList title="交付产物" items={scenario().deliverables} />
            <div class="rounded-[8px] border border-border-weaker-base bg-surface-raised-base/55 p-3">
              <div class="text-11-medium text-text-weak">处理流程</div>
              <div class="mt-2 flex flex-col gap-2">
                <For each={scenario().workflow}>
                  {(item, index) => (
                    <div class="flex items-start gap-2 text-12-regular leading-relaxed text-text-base">
                      <span class="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-emerald-300/10 text-[10px] text-emerald-200">
                        {index() + 1}
                      </span>
                      <span>{item}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </aside>
  )
}

export function OfficePptTemplateSidebar() {
  const office = useOfficeAgent()
  const dialog = useDialog()
  const openCustomPptTemplateDialog = () => {
    const [draft, setDraft] = createSignal("科技蓝、清爽教学感、适合课堂演示，页面有重点框、流程箭头和清晰留白。")
    const preview = createMemo(() => createCustomPptTemplate(draft(), office.activeAction().title))
    const apply = () => {
      office.selectPptTemplate(preview())
      dialog.close()
      showToast({ title: "自定义 PPT 模板已启用", description: preview().name })
    }

    dialog.show(() => (
      <Dialog title="自定义 PPT 模板" class="w-full max-w-[680px] mx-auto">
        <div class="flex flex-col gap-4 px-6 pb-5">
          <div class="rounded-[8px] border border-cyan-300/25 bg-cyan-300/[0.07] p-3">
            <div class="text-13-medium text-text-strong">模板风格描述</div>
            <div class="mt-1 text-12-regular leading-relaxed text-text-weak">
              输入行业、主题、颜色和页面气质后，系统会自动匹配基础版式并生成配色方案。
            </div>
          </div>
          <textarea
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
            class="min-h-[128px] w-full resize-y rounded-[8px] border border-border-weak-base bg-background-base p-3 text-13-regular leading-relaxed text-text-strong outline-none transition-colors focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/25"
          />
          <div class="grid gap-3 rounded-[8px] border border-border-weak-base bg-surface-raised-base/70 p-3">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-13-medium text-text-strong">{preview().name}</div>
                <div class="mt-1 line-clamp-2 text-12-regular text-text-weak">{preview().description}</div>
              </div>
              <div class="flex shrink-0 items-center gap-1.5" title="自动匹配出的封面、强调色和页面底色">
                <For
                  each={[
                    preview().visual.coverBg,
                    preview().visual.accent,
                    preview().visual.accent2,
                    preview().visual.pageBg,
                  ]}
                >
                  {(color) => (
                    <span
                      class="size-5 rounded-[6px] border border-border-weak-base"
                      style={{ "background-color": `#${color}` }}
                    />
                  )}
                </For>
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              取消
            </Button>
            <button
              type="button"
              class="rounded-[8px] border border-emerald-300/45 bg-emerald-300 px-4 py-2 text-13-medium text-black shadow-[0_10px_26px_rgba(16,185,129,0.18)] transition-all hover:-translate-y-px hover:bg-emerald-200 active:translate-y-0 active:scale-[0.98]"
              onClick={apply}
            >
              生成并使用
            </button>
          </div>
        </div>
      </Dialog>
    ))
  }

  return (
    <aside
      class="hidden h-full shrink-0 border-l border-border-weaker-base bg-background-base/96 px-3 py-3 md:flex md:flex-col"
      style={{ width: `${OFFICE_PPT_TEMPLATE_SIDEBAR_WIDTH}px` }}
      aria-label="PPT 模板侧栏"
    >
      <div class="mb-3 px-1">
        <div class="text-13-medium text-text-strong">PPT 模板库</div>
        <div class="mt-1 text-11-regular leading-relaxed text-text-weak">
          选择模板会影响预览、默认版式和最终导出的 PPTX。
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        <PptTemplateLibrary onCustom={openCustomPptTemplateDialog} />
      </div>
    </aside>
  )
}

function PptTemplateLibrary(props: { onCustom: () => void }) {
  const office = useOfficeAgent()
  const dialog = useDialog()
  const templatePreview = (text: string) => createCustomPptTemplate(text).visual
  const previewPages: Array<{ type: PptTemplatePreviewType; label: string }> = [
    { type: "cover", label: "封面页" },
    { type: "toc", label: "目录页" },
    { type: "chapter", label: "章节页" },
    { type: "content", label: "内容页" },
    { type: "data", label: "数据页" },
    { type: "summary", label: "总结页" },
  ]
  const openTemplatePreview = (template: OfficePptTemplateChoice) => {
    const visual = officePptTemplateVisual(template)
    dialog.show(() => (
      <Dialog title={`${officePptTemplateName(template)} 预览`} class="w-full max-w-[1080px] mx-auto">
        <div class="max-h-[76vh] overflow-auto px-6 pb-6">
          <div class="mb-4 text-13-regular leading-relaxed text-text-weak">
            {officePptTemplateDescription(template)}
          </div>
          <div class="grid gap-4 md:grid-cols-3">
            <For each={previewPages}>
              {(page) => <PptTemplatePreviewSlide visual={visual} type={page.type} label={page.label} />}
            </For>
          </div>
        </div>
      </Dialog>
    ))
  }

  return (
    <div class="rounded-[8px] border border-cyan-300/20 bg-cyan-300/[0.055] p-3">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="text-12-medium text-text-strong">当前模板</div>
          <div
            class="mt-1 truncate text-11-regular text-text-weak"
            title={officePptTemplateDescription(office.pptTemplate())}
          >
            {officePptTemplateName(office.pptTemplate())}
          </div>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-[8px] border border-emerald-300/35 bg-emerald-300/12 px-2 py-1 text-11-medium text-emerald-100 transition-all hover:-translate-y-px hover:border-emerald-300/60 hover:bg-emerald-300/18 active:translate-y-0 active:scale-[0.98]"
          onClick={props.onCustom}
        >
          自定义模板
        </button>
      </div>
      <button
        type="button"
        class="mt-3 w-full rounded-[8px] border px-2.5 py-2 text-left transition-all hover:-translate-y-px active:translate-y-0 active:scale-[0.99]"
        classList={{
          "border-emerald-300/50 bg-emerald-300/12": office.pptTemplate() === "auto",
          "border-border-weaker-base bg-background-base/40 hover:border-emerald-300/35 hover:bg-emerald-300/8":
            office.pptTemplate() !== "auto",
        }}
        onClick={() => office.selectPptTemplate("auto")}
      >
        <div class="flex items-center gap-2">
          <Icon name="brain" size="small" class="shrink-0 text-cyan-200" />
          <div class="min-w-0 flex-1">
            <div class="text-12-medium text-text-strong">自动匹配</div>
            <div class="mt-0.5 truncate text-10-regular text-text-weak">根据主题自动选择最合适的内置模板</div>
          </div>
        </div>
      </button>
      <div class="mt-2 grid gap-2">
        <For each={officePptTemplates}>
          {(template) => {
            const visual = templatePreview(`${template.name} ${template.description}`)
            return (
              <div
                role="button"
                tabIndex={0}
                class="group rounded-[8px] border px-2.5 py-2 text-left transition-all hover:-translate-y-px active:translate-y-0 active:scale-[0.99]"
                classList={{
                  "border-emerald-300/50 bg-emerald-300/12": office.pptTemplate() === template.id,
                  "border-border-weaker-base bg-background-base/40 hover:border-emerald-300/35 hover:bg-emerald-300/8":
                    office.pptTemplate() !== template.id,
                }}
                onClick={() => office.selectPptTemplate(template.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    office.selectPptTemplate(template.id)
                  }
                }}
              >
                <div class="flex items-center gap-2">
                  <div class="flex shrink-0 overflow-hidden rounded-[6px] border border-border-weaker-base">
                    <span class="block h-8 w-2.5" style={{ "background-color": `#${visual.coverBg}` }} />
                    <span class="block h-8 w-2.5" style={{ "background-color": `#${visual.accent}` }} />
                    <span class="block h-8 w-2.5" style={{ "background-color": `#${visual.accent2}` }} />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-12-medium text-text-strong">{template.name}</div>
                    <div class="mt-0.5 line-clamp-2 text-10-regular leading-relaxed text-text-weak">
                      {template.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    class="grid size-7 shrink-0 place-items-center rounded-[7px] border border-border-weaker-base bg-background-base/60 text-icon-weak opacity-80 transition-colors hover:border-emerald-300/45 hover:bg-emerald-300/12 hover:text-emerald-100"
                    title="预览模板"
                    onClick={(event) => {
                      event.stopPropagation()
                      openTemplatePreview(template.id)
                    }}
                  >
                    <Icon name="eye" size="small" />
                  </button>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}

type PptTemplatePreviewType = "cover" | "toc" | "chapter" | "content" | "data" | "summary"

function PptTemplatePreviewSlide(props: { visual: PptVisualTemplate; type: PptTemplatePreviewType; label: string }) {
  const title = () =>
    ({
      cover: "年度汇报方案",
      toc: "演示结构",
      chapter: "第一章 核心问题",
      content: "核心页面版式",
      data: "数据洞察页面",
      summary: "结论与行动",
    })[props.type]
  const subtitle = () =>
    ({
      cover: "专业、清晰、可编辑",
      toc: "章节推进、重点明确",
      chapter: "建立节奏、突出阶段",
      content: "观点、结构、行动项",
      data: "指标、趋势、对比",
      summary: "收束观点、给出下一步",
    })[props.type]

  return (
    <div
      class="aspect-[16/9] overflow-hidden rounded-[8px] border border-border-weaker-base shadow-[0_18px_48px_rgba(0,0,0,0.22)]"
      style={{ "background-color": `#${props.type === "cover" ? props.visual.coverBg : props.visual.pageBg}` }}
    >
      <div class="relative h-full w-full p-4">
        <div
          class="absolute bottom-3 right-3 rounded-[5px] px-1.5 py-0.5 text-[9px] font-medium"
          style={{ color: `#${props.visual.coverTitle}`, "background-color": `#${props.visual.side}` }}
        >
          {props.label}
        </div>
        <div class="absolute left-0 top-0 h-full w-1.5" style={{ "background-color": `#${props.visual.accent}` }} />
        <div class="absolute right-4 top-4 grid grid-cols-2 gap-1 opacity-80">
          <span class="h-2.5 w-6 rounded-[3px]" style={{ "background-color": `#${props.visual.accent2}` }} />
          <span class="h-2.5 w-3 rounded-[3px]" style={{ "background-color": `#${props.visual.accent}` }} />
          <span class="h-2.5 w-3 rounded-[3px]" style={{ "background-color": `#${props.visual.cardLine}` }} />
          <span class="h-2.5 w-6 rounded-[3px]" style={{ "background-color": `#${props.visual.accentLight}` }} />
        </div>
        <Show
          when={props.type === "cover"}
          fallback={
            <div class="grid h-full grid-cols-[1fr_0.85fr] gap-3">
              <div class="flex min-w-0 flex-col justify-between">
                <div>
                  <div class="h-2 w-12 rounded-[3px]" style={{ "background-color": `#${props.visual.accent}` }} />
                  <div class="mt-4 text-[18px] font-semibold leading-tight" style={{ color: `#${props.visual.title}` }}>
                    {title()}
                  </div>
                  <div class="mt-2 text-[10px] leading-relaxed opacity-80" style={{ color: `#${props.visual.text}` }}>
                    {subtitle()}
                  </div>
                </div>
                <div class="grid gap-1.5">
                  <div
                    class="h-2.5 w-full rounded-[3px] opacity-70"
                    style={{ "background-color": `#${props.visual.side}` }}
                  />
                  <div
                    class="h-2.5 w-4/5 rounded-[3px] opacity-70"
                    style={{ "background-color": `#${props.visual.side}` }}
                  />
                  <div
                    class="h-2.5 w-2/3 rounded-[3px] opacity-70"
                    style={{ "background-color": `#${props.visual.side}` }}
                  />
                </div>
              </div>
              <PptTemplatePreviewPattern visual={props.visual} type={props.type} />
            </div>
          }
        >
          <div class="flex h-full flex-col justify-center pl-4">
            <div class="h-2 w-16 rounded-[3px]" style={{ "background-color": `#${props.visual.accent}` }} />
            <div
              class="mt-5 max-w-[72%] text-[24px] font-semibold leading-tight"
              style={{ color: `#${props.visual.coverTitle}` }}
            >
              {title()}
            </div>
            <div class="mt-3 text-[11px] leading-relaxed opacity-85" style={{ color: `#${props.visual.coverText}` }}>
              {subtitle()}
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}

function PptTemplatePreviewPattern(props: { visual: PptVisualTemplate; type: PptTemplatePreviewType }) {
  if (props.type === "toc")
    return (
      <div class="grid content-center gap-1.5">
        {[1, 2, 3, 4].map((item) => (
          <div
            class="flex items-center gap-2 rounded-[7px] p-2"
            style={{ "background-color": `#${props.visual.card}` }}
          >
            <span
              class="grid size-5 place-items-center rounded-[4px] text-[9px] font-semibold"
              style={{
                color: `#${props.visual.coverTitle}`,
                "background-color": `#${item % 2 ? props.visual.accent : props.visual.accent2}`,
              }}
            >
              {item}
            </span>
            <span
              class="h-2 flex-1 rounded-[3px] opacity-75"
              style={{ "background-color": `#${props.visual.cardLine}` }}
            />
          </div>
        ))}
      </div>
    )
  if (props.type === "chapter")
    return (
      <div
        class="grid h-full grid-cols-[0.55fr_1fr] overflow-hidden rounded-[8px]"
        style={{ "background-color": `#${props.visual.side}` }}
      >
        <div class="grid place-items-center" style={{ "background-color": `#${props.visual.accent}` }}>
          <div class="text-[24px] font-semibold leading-none" style={{ color: `#${props.visual.coverTitle}` }}>
            01
          </div>
        </div>
        <div class="flex flex-col justify-center gap-2 p-3">
          <div class="h-2 w-20 rounded-[3px]" style={{ "background-color": `#${props.visual.accent2}` }} />
          <div class="h-2 w-16 rounded-[3px]" style={{ "background-color": `#${props.visual.accentLight}` }} />
          <div class="mt-3 h-10 w-full rounded-[8px] border" style={{ "border-color": `#${props.visual.cardLine}` }} />
        </div>
      </div>
    )
  if (props.type === "data" || props.visual.motif === "dashboard")
    return (
      <div
        class="grid h-full grid-cols-4 items-end gap-2 rounded-[8px] p-3"
        style={{ "background-color": `#${props.visual.side}` }}
      >
        {[42, 70, 54, 88].map((height, index) => (
          <div
            class="rounded-t-[5px]"
            style={{
              height: `${height}%`,
              "background-color": `#${index % 2 ? props.visual.accent2 : props.visual.accent}`,
            }}
          />
        ))}
      </div>
    )
  if (props.type === "summary")
    return (
      <div class="grid content-center gap-2">
        <div class="rounded-[8px] p-3" style={{ "background-color": `#${props.visual.side}` }}>
          <div class="h-2 w-20 rounded-[3px]" style={{ "background-color": `#${props.visual.accent}` }} />
          <div class="mt-3 grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((item) => (
              <div
                class="h-10 rounded-[6px] opacity-90"
                style={{ "background-color": `#${item % 2 ? props.visual.accent2 : props.visual.accentLight}` }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  if (
    props.visual.motif === "circuit" ||
    props.visual.motif === "network" ||
    props.visual.motif === "ops-map" ||
    props.visual.motif === "autotech"
  )
    return (
      <div class="relative h-full rounded-[8px]" style={{ "background-color": `#${props.visual.side}` }}>
        {[0, 1, 2, 3].map((item) => (
          <span
            class="absolute size-4 rounded-[4px] border"
            style={{
              left: `${18 + item * 18}%`,
              top: `${22 + (item % 2) * 34}%`,
              "background-color": `#${item % 2 ? props.visual.accent2 : props.visual.accent}`,
              "border-color": `#${props.visual.accentLight}`,
            }}
          />
        ))}
        <span
          class="absolute left-[25%] top-[31%] h-1 w-[44%] rounded-[3px]"
          style={{ "background-color": `#${props.visual.cardLine}` }}
        />
        <span
          class="absolute left-[43%] top-[33%] h-[34%] w-1 rounded-[3px]"
          style={{ "background-color": `#${props.visual.cardLine}` }}
        />
        <span
          class="absolute bottom-5 right-5 h-2 w-14 rounded-[3px]"
          style={{ "background-color": `#${props.visual.accent2}` }}
        />
      </div>
    )
  if (props.visual.motif === "classroom")
    return (
      <div class="grid content-center gap-2">
        <div class="rounded-[8px] p-3" style={{ "background-color": `#${props.visual.side}` }}>
          <div class="h-2 w-16 rounded-[3px]" style={{ "background-color": `#${props.visual.accentLight}` }} />
          <div class="mt-3 grid grid-cols-2 gap-2">
            <div class="h-12 rounded-[6px]" style={{ "background-color": `#${props.visual.accent}` }} />
            <div class="h-12 rounded-[6px]" style={{ "background-color": `#${props.visual.accent2}` }} />
          </div>
        </div>
      </div>
    )
  if (props.visual.motif === "minimal-line")
    return (
      <div class="flex h-full flex-col justify-center gap-3">
        <div class="h-1 w-full" style={{ "background-color": `#${props.visual.side}` }} />
        <div class="h-1 w-2/3" style={{ "background-color": `#${props.visual.cardLine}` }} />
        <div class="mt-8 h-1 w-1/2 self-end" style={{ "background-color": `#${props.visual.accent}` }} />
      </div>
    )
  if (props.visual.motif === "roadmap" || props.visual.motif === "blueprint" || props.visual.motif === "infrastructure")
    return (
      <div class="grid content-center gap-2">
        {[0, 1, 2].map((item) => (
          <div class="flex items-center gap-2">
            <span
              class="size-5 rounded-[4px]"
              style={{ "background-color": `#${item % 2 ? props.visual.accent2 : props.visual.accent}` }}
            />
            <span
              class="h-3 flex-1 rounded-[4px]"
              style={{ "background-color": `#${item === 1 ? props.visual.accentLight : props.visual.side}` }}
            />
          </div>
        ))}
      </div>
    )
  if (props.visual.motif === "ledger" || props.visual.motif === "bank-ledger")
    return (
      <div class="grid content-center gap-1.5">
        {[0, 1, 2, 3, 4].map((item) => (
          <div class="grid grid-cols-[0.7fr_1fr_0.5fr] gap-1.5">
            <span class="h-3 rounded-[4px]" style={{ "background-color": `#${props.visual.cardLine}` }} />
            <span
              class="h-3 rounded-[4px]"
              style={{ "background-color": `#${item % 2 ? props.visual.accentLight : props.visual.card}` }}
            />
            <span
              class="h-3 rounded-[4px]"
              style={{ "background-color": `#${item % 2 ? props.visual.accent2 : props.visual.accent}` }}
            />
          </div>
        ))}
      </div>
    )
  if (props.visual.motif === "paper" || props.visual.motif === "university" || props.visual.motif === "clinical")
    return (
      <div class="grid h-full place-items-center">
        <div
          class="w-4/5 rounded-[8px] border p-3"
          style={{ "background-color": `#${props.visual.card}`, "border-color": `#${props.visual.cardLine}` }}
        >
          <div class="h-2 w-16 rounded-[3px]" style={{ "background-color": `#${props.visual.accent}` }} />
          <div class="mt-3 grid gap-1.5">
            {[0, 1, 2, 3].map((item) => (
              <div
                class="h-2 rounded-[3px]"
                style={{ "background-color": `#${item === 0 ? props.visual.accentLight : props.visual.cardLine}` }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  if (
    props.visual.motif === "collage" ||
    props.visual.motif === "spotlight" ||
    props.visual.motif === "story" ||
    props.visual.motif === "therapy"
  )
    return (
      <div class="relative h-full">
        <span
          class="absolute left-2 top-5 h-16 w-16 rounded-[12px]"
          style={{ "background-color": `#${props.visual.accent}` }}
        />
        <span
          class="absolute right-3 top-10 h-14 w-20 rounded-[14px]"
          style={{ "background-color": `#${props.visual.accent2}` }}
        />
        <span
          class="absolute bottom-4 left-10 h-12 w-24 rounded-full"
          style={{ "background-color": `#${props.visual.accentLight}` }}
        />
      </div>
    )
  if (
    props.visual.motif === "seal" ||
    props.visual.motif === "policy-blue" ||
    props.visual.motif === "policy-red" ||
    props.visual.motif === "certification"
  )
    return (
      <div class="grid h-full place-items-center">
        <div
          class="grid size-24 place-items-center rounded-full border-4"
          style={{ "border-color": `#${props.visual.accent}`, "background-color": `#${props.visual.accentLight}` }}
        >
          <div class="size-12 rounded-full" style={{ "background-color": `#${props.visual.accent2}` }} />
        </div>
      </div>
    )
  if (props.visual.motif === "vehicle-track")
    return (
      <div class="grid h-full place-items-center">
        <div class="relative h-16 w-32 rounded-full border-2" style={{ "border-color": `#${props.visual.cardLine}` }}>
          <span
            class="absolute left-5 top-5 size-5 rounded-full"
            style={{ "background-color": `#${props.visual.accent}` }}
          />
          <span
            class="absolute right-5 top-5 size-5 rounded-full"
            style={{ "background-color": `#${props.visual.accent2}` }}
          />
          <span
            class="absolute left-11 top-3 h-5 w-10 rounded-[6px]"
            style={{ "background-color": `#${props.visual.accentLight}` }}
          />
        </div>
      </div>
    )
  if (props.visual.motif === "pixel")
    return (
      <div class="grid h-full grid-cols-5 content-center gap-1.5">
        {Array.from({ length: 15 }, (_, item) => (
          <span
            class="aspect-square"
            style={{
              "background-color": `#${item % 3 === 0 ? props.visual.accent2 : item % 2 ? props.visual.accent : props.visual.cardLine}`,
            }}
          />
        ))}
      </div>
    )
  return (
    <div class="grid content-center gap-2">
      <div class="rounded-[8px] p-3" style={{ "background-color": `#${props.visual.side}` }}>
        <div class="h-2 w-14 rounded-[3px]" style={{ "background-color": `#${props.visual.accent}` }} />
        <div class="mt-3 h-12 rounded-[6px] opacity-70" style={{ "background-color": `#${props.visual.pageBg}` }} />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div class="h-12 rounded-[8px]" style={{ "background-color": `#${props.visual.side}` }} />
        <div class="h-12 rounded-[8px]" style={{ "background-color": `#${props.visual.side}` }} />
      </div>
    </div>
  )
}

function OfficeArtifactLibrary(props: {
  artifacts: OfficeArtifactItem[]
  loading: boolean
  total: number
  onOpen: (artifact: OfficeArtifactItem) => void
  onRevise: (artifact: OfficeArtifactItem) => void
}) {
  return (
    <div class="rounded-[8px] border border-border-weaker-base bg-surface-raised-base/55 p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-11-medium text-text-weak">办公文件库</div>
        <div class="text-10-regular text-text-weak">{props.total} 个文件</div>
      </div>
      <div class="mt-2 flex flex-col gap-1.5">
        <Show
          when={!props.loading}
          fallback={<div class="py-3 text-11-regular text-text-weak">正在读取办公文件...</div>}
        >
          <Show
            when={props.artifacts.length > 0}
            fallback={<div class="py-3 text-11-regular leading-relaxed text-text-weak">当前场景还没有保存文件。</div>}
          >
            <For each={props.artifacts}>
              {(artifact) => (
                <div class="rounded-[6px] border border-border-weaker-base px-2 py-1.5" title={artifact.path}>
                  <button
                    type="button"
                    class="group flex w-full items-center gap-1.5 text-left"
                    onClick={() => props.onOpen(artifact)}
                  >
                    <Icon
                      name={artifact.kind === "ppt" ? "layout-bottom" : "open-file"}
                      size="small"
                      class="shrink-0 text-icon-weak group-hover:text-emerald-200"
                    />
                    <span class="min-w-0 flex-1 truncate text-12-medium text-text-base group-hover:text-emerald-100">
                      {artifact.filename}
                    </span>
                  </button>
                  <span class="mt-0.5 block truncate pl-5 text-10-regular text-text-weak">
                    {formatArtifactBytes(artifact.bytes)} · {formatArtifactDate(artifact.modified)}
                  </span>
                  <div class="mt-2 grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      class="rounded-[6px] border border-border-weaker-base px-2 py-1 text-10-medium text-text-weak transition-colors hover:border-emerald-300/35 hover:bg-emerald-300/10 hover:text-emerald-100"
                      onClick={() => props.onOpen(artifact)}
                    >
                      打开
                    </button>
                    <button
                      type="button"
                      class="rounded-[6px] border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-10-medium text-emerald-100 transition-colors hover:border-emerald-300/50 hover:bg-emerald-300/15"
                      onClick={() => props.onRevise(artifact)}
                    >
                      继续修改
                    </button>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  )
}

function officeArtifactRevisionPrompt(
  artifact: OfficeArtifactItem,
  actionTitle: string,
  scenario: ReturnType<typeof officeAgentScenario>,
) {
  return [
    `继续修改办公文件：${artifact.filename}`,
    "",
    `办公场景：${actionTitle}`,
    `调用 Agent：${scenario.agentName}`,
    `绑定 Skill：${scenario.skillName}`,
    `目标文件：${artifact.path}`,
    "",
    "请先读取目标文件，识别当前内容结构，再根据下面的修改目标输出新的办公产物。",
    "",
    "修改目标：",
    "请在这里写明要补充、润色、改写、扩展、压缩或调整的内容。",
    "",
    "输出要求：",
    "- 正文仍然使用「# 办公产物」作为一级标题。",
    "- 如果是 PPT，请保持页级结构，每页包含标题、核心观点、页面文案、视觉建议和备注。",
    "- 如果有长期可复用偏好，放到「# 可沉淀记忆/可进化建议」，不要混入正文。",
    "- 明确标出需要用户确认的信息。",
  ].join("\n")
}

function formatArtifactBytes(value: number | string) {
  const bytes = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(bytes)) return "未知大小"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`
}

function formatArtifactDate(value: number | string) {
  const timestamp = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(timestamp)) return "未知时间"
  return new Date(timestamp).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })
}

function ScenarioList(props: { title: string; items: string[] }) {
  return (
    <div class="rounded-[8px] border border-border-weaker-base bg-surface-raised-base/55 p-3">
      <div class="text-11-medium text-text-weak">{props.title}</div>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <For each={props.items}>
          {(item) => (
            <span class="rounded-[6px] border border-border-weaker-base px-2 py-1 text-11-regular text-text-base">
              {item}
            </span>
          )}
        </For>
      </div>
    </div>
  )
}
