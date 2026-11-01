import { createMemo, createSignal, For } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import type { useDialog } from "@novaway/ui/context/dialog"
import { showToast } from "@novaway/ui/toast"
import { createCustomPptTemplate, type OfficePptTemplateChoice } from "./office-export"

type DialogApi = ReturnType<typeof useDialog>

export type PptTemplateHost = {
  selectPptTemplate: (template: OfficePptTemplateChoice) => void
}

/**
 * 「AI 自定义模板」对话框。
 *
 * 这里只做一件事：把用户的一句话描述翻成一套配色/排版参数（createCustomPptTemplate 是纯函数，
 * 所以下面的色块是真的实时预览，不是装饰）。文案描述的是风格而不是具体某页内容，
 * 因此同一个模板可以覆盖之后重新生成的任意一版 PPT。
 *
 * 对话输入框（生成前）和产物卡（生成后）共用这一个入口 —— 两处如果各写一份，
 * 迟早会出现「同一句提示词生成出两种配色」的漂移。
 */
export function openCustomPptTemplateDialog(input: {
  office: PptTemplateHost
  dialog: DialogApi
  /** 产物标题：只用来给中性底色挑一个合适的基线（教学/科技/金融…）。 */
  title?: string
}) {
  const [draft, setDraft] = createSignal("高端黑金商务风，深色封面，金色强调，页面简洁、有留白，适合正式汇报。")
  const preview = createMemo(() => createCustomPptTemplate(draft(), input.title))
  const apply = () => {
    const template = preview()
    input.office.selectPptTemplate(template)
    input.dialog.close()
    showToast({ title: "自定义模板已生成", description: template.name })
  }

  void input.dialog.show(() => (
    <Dialog title="自定义 PPT 模板" class="w-full max-w-[680px] mx-auto">
      <div class="flex flex-col gap-4 px-6 pb-5">
        <div class="rounded-[8px] border border-cyan-300/20 bg-cyan-300/[0.06] p-3">
          <div class="text-13-medium text-foreground">模板设计提示词</div>
          <div class="mt-1 text-12-regular leading-relaxed text-foreground-subtle">
            请描述你想要的 PPT 风格、主题、配色、行业气质和页面感觉，例如“科技蓝、赛博霓虹、适合 AI 产品发布”。
          </div>
        </div>
        <textarea
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          class="min-h-[128px] w-full resize-y rounded-[8px] border border-border bg-background p-3 text-13-regular leading-relaxed text-foreground outline-none transition-colors focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/25"
        />
        <div class="grid gap-3 rounded-[8px] border border-border bg-surface/70 p-3">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-13-medium text-foreground">{preview().name}</div>
              <div class="mt-1 line-clamp-2 text-12-regular text-foreground-subtle">{preview().description}</div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <For
                each={[
                  preview().visual.coverBg,
                  preview().visual.accent,
                  preview().visual.accent2,
                  preview().visual.pageBg,
                ]}
              >
                {(color) => (
                  <span class="size-5 rounded-[6px] border border-border" style={{ "background-color": `#${color}` }} />
                )}
              </For>
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => input.dialog.close()}>
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
