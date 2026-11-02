import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import type { GuideStepState } from "./run-guide.steps"

/**
 * 团队编排的使用引导（§4.3）。
 *
 * 看板此前只有「现在该做什么」一句话：它解决的是「卡住了」，但没解决「这件事一共几步、
 * 我走到哪了、后面还要做什么」。新用户最常见的两个误解都在这里：
 *
 * 1. **创建 ≠ 开始跑。** 填完表单只是建了运行，批准和执行是后面两步；
 * 2. **跑完 ≠ 已合并。** 交付成立说的是验收通过，合进自己的分支是单独的第五步。
 *
 * 所以这里把整条路摊开成一条可点击的步骤条：做完的打勾，当前的高亮，还没轮到的是灰的。
 * 点任意一步能看到这一步到底在做什么 —— 说明是静态的（不随状态变），状态只影响高亮。
 */

export type GuideStep = {
  id: string
  /** 步骤名，尽量短：横向排得下才看得清全局。 */
  title: string
  /** 这一步要做什么；点开才显示，不挤占看板空间。 */
  hint: string
  state: GuideStepState
}

export function RunGuide(props: { steps: GuideStep[] }): JSX.Element {
  const language = useLanguage()
  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)
  // 默认收起：只显示步骤条本身；点开某一步才展开它的说明。
  const [selected, setSelected] = createSignal<string>()
  const active = createMemo(() => props.steps.find((step) => step.id === selected()))
  // 当前步可能不存在：全部做完、停在「需要你处理」那一步，或者还在等计划生成。
  const position = createMemo(() => {
    const current = props.steps.findIndex((step) => step.state === "current")
    if (current !== -1) return current + 1
    const attention = props.steps.findIndex((step) => step.state === "attention")
    return attention === -1 ? 0 : attention + 1
  })
  const finished = createMemo(() => props.steps.length > 0 && props.steps.every((step) => step.state === "done"))

  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex flex-wrap items-center gap-1.5 text-ui-xs">
        <Icon name="checklist" size="small" class="text-foreground-subtle" />
        <span class="text-foreground-subtle">{t("run.guide.title")}</span>
        <span class="text-foreground-subtlest">
          {finished()
            ? t("run.guide.finished")
            : position() === 0
              ? t("run.guide.waiting")
              : t("run.guide.position", { current: String(position()), total: String(props.steps.length) })}
        </span>
      </div>
      <div class="flex flex-wrap items-center gap-1">
        <For each={props.steps}>
          {(step, index) => (
            <>
              <span class="inline-flex">
                <button
                  type="button"
                  class="flex items-center gap-1 rounded-full border px-2 py-0.5 text-ui-xs transition-colors"
                  classList={{
                    "border-success/40 bg-success/10 text-success": step.state === "done",
                    "border-primary/50 bg-primary/10 text-primary": step.state === "current",
                    "border-border text-foreground-subtle hover:bg-hover": step.state === "todo",
                    "border-warning/40 bg-warning/10 text-warning": step.state === "attention",
                    "ring-1 ring-primary/40": selected() === step.id,
                  }}
                  title={step.hint}
                  aria-current={step.state === "current" ? "step" : undefined}
                  onClick={() => setSelected((current) => (current === step.id ? undefined : step.id))}
                >
                  <Show
                    when={step.state === "done"}
                    fallback={
                      <span
                        class="grid size-4 shrink-0 place-items-center rounded-full text-[10px]"
                        classList={{
                          "bg-primary/15 text-primary": step.state === "current",
                          "bg-border text-foreground-subtle": step.state === "todo",
                          "bg-warning/15 text-warning": step.state === "attention",
                        }}
                      >
                        {index() + 1}
                      </span>
                    }
                  >
                    <Icon name="circle-check" size="small" />
                  </Show>
                  <span class="truncate">{step.title}</span>
                </button>
              </span>
              <Show when={index() < props.steps.length - 1}>
                <span aria-hidden="true" class="h-px w-3 shrink-0 bg-border" />
              </Show>
            </>
          )}
        </For>
      </div>
      <Show when={active()}>
        {(step) => (
          <div class="rounded-md border border-border bg-background px-2 py-1.5 text-ui-xs leading-relaxed">
            <div class="flex items-center gap-1.5">
              <span class="text-foreground">{step().title}</span>
              <span
                classList={{
                  "text-success": step().state === "done",
                  "text-primary": step().state === "current",
                  "text-foreground-subtlest": step().state === "todo",
                  "text-warning": step().state === "attention",
                }}
              >
                {t(`run.guide.state.${step().state}`)}
              </span>
              <button
                type="button"
                class="ml-auto text-foreground-subtlest hover:text-foreground"
                title={t("run.guide.close")}
                onClick={() => setSelected(undefined)}
              >
                <Icon name="close" size="small" />
              </button>
            </div>
            <div class="mt-0.5 text-foreground-subtle">{step().hint}</div>
          </div>
        )}
      </Show>
    </div>
  )
}
