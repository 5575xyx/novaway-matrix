import type { KnowledgeEvalHistoryEntry } from "@novaway/sdk/v2"
import { For, Show, createMemo, type Component } from "solid-js"
import { useLanguage } from "@/context/language"

type Point = {
  id: string
  ranAt: number
  hitRate: number
  mrr: number
  avgLatencyMs: number
}

const num = (input: unknown): number => {
  if (typeof input === "number" && Number.isFinite(input)) return input
  const parsed = Number(input)
  return Number.isFinite(parsed) ? parsed : 0
}

const WIDTH = 320
const HEIGHT = 72

function path(points: readonly Point[], pick: (point: Point) => number) {
  if (points.length === 0) return ""
  const step = points.length > 1 ? WIDTH / (points.length - 1) : WIDTH
  return points
    .map((point, index) => {
      const x = points.length > 1 ? index * step : WIDTH / 2
      const y = HEIGHT - Math.max(0, Math.min(1, pick(point))) * HEIGHT
      return (index === 0 ? "M " : "L ") + x.toFixed(1) + " " + y.toFixed(1)
    })
    .join(" ")
}

/**
 * 评测趋势。
 *
 * 只有单次分数时无法判断「改检索参数到底有没有变好」；
 * 这里把同 k 的历史画成折线，并标出与上次的差值。
 */
export const EvalTrendChart: Component<{ history: () => KnowledgeEvalHistoryEntry[]; k: number }> = (props) => {
  const language = useLanguage()

  const points = createMemo<Point[]>(() =>
    props
      .history()
      .filter((item) => item.k === props.k)
      .sort((a, b) => num(a.ranAt) - num(b.ranAt))
      .map((item) => ({
        id: item.id,
        ranAt: num(item.ranAt),
        hitRate: num(item.metrics.hitRate),
        mrr: num(item.metrics.mrr),
        avgLatencyMs: num(item.metrics.avgLatencyMs),
      })),
  )

  const latest = createMemo(() => points()[points().length - 1])
  const previous = createMemo(() => points()[points().length - 2])
  const delta = (pick: (point: Point) => number) => {
    const current = latest()
    const before = previous()
    if (!current || !before) return undefined
    return pick(current) - pick(before)
  }

  return (
    <div class="flex flex-col gap-2 rounded-xl border border-border p-3">
      <div class="flex items-center justify-between gap-2">
        <span class="text-12-medium text-foreground-subtle">
          {language.t("knowledge.eval.trend", { k: props.k, count: points().length })}
        </span>
        <Show when={latest()}>
          {(value) => (
            <span class="text-11-regular tabular-nums text-foreground-subtlest">
              {language.t("knowledge.eval.latest", { time: formatTime(value().ranAt) })}
            </span>
          )}
        </Show>
      </div>

      <Show
        when={points().length > 0}
        fallback={
          <div class="flex h-16 items-center justify-center text-11-regular text-foreground-subtlest">
            {language.t("knowledge.eval.trendEmpty")}
          </div>
        }
      >
        <svg viewBox={"0 0 " + WIDTH + " " + HEIGHT} class="h-16 w-full overflow-visible">
          <line x1="0" y1={HEIGHT} x2={WIDTH} y2={HEIGHT} stroke="var(--border)" stroke-width="1" />
          <line
            x1="0"
            y1={HEIGHT / 2}
            x2={WIDTH}
            y2={HEIGHT / 2}
            stroke="var(--border)"
            stroke-width="1"
            stroke-dasharray="2 4"
          />
          <path
            d={path(points(), (point) => point.hitRate)}
            fill="none"
            stroke="var(--icon-blue)"
            stroke-width="2"
            stroke-linecap="round"
          />
          <path
            d={path(points(), (point) => point.mrr)}
            fill="none"
            stroke="var(--diff-added)"
            stroke-width="2"
            stroke-dasharray="4 3"
            stroke-linecap="round"
          />
          <For each={points()}>
            {(point, index) => {
              const step = points().length > 1 ? WIDTH / (points().length - 1) : WIDTH
              const x = points().length > 1 ? index() * step : WIDTH / 2
              return (
                <circle
                  cx={x}
                  cy={HEIGHT - point.hitRate * HEIGHT}
                  r={index() === points().length - 1 ? 3.5 : 2}
                  fill="var(--icon-blue)"
                />
              )
            }}
          </For>
        </svg>
      </Show>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-11-regular text-foreground-subtlest">
        <span class="flex items-center gap-1">
          <span class="inline-block size-2 rounded-full bg-[var(--icon-blue)]" />
          {language.t("knowledge.eval.hitRateLabel")}
          <Show when={delta((point) => point.hitRate)}>{(value) => <Delta value={value()} />}</Show>
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block size-2 rounded-full bg-[var(--diff-added)]" />
          {language.t("knowledge.eval.mrrLabel")}
          <Show when={delta((point) => point.mrr)}>{(value) => <Delta value={value()} />}</Show>
        </span>
        <Show when={latest()}>
          {(value) => (
            <span class="ml-auto tabular-nums">
              {language.t("knowledge.eval.latestLatency", { ms: value().avgLatencyMs })}
            </span>
          )}
        </Show>
      </div>
    </div>
  )
}

const Delta: Component<{ value: number }> = (props) => {
  const percent = () => Math.round(props.value * 1000) / 10
  const positive = () => props.value > 0
  const neutral = () => Math.abs(props.value) < 0.0005
  return (
    <span
      class="tabular-nums"
      classList={{
        "text-[#059669]": positive() && !neutral(),
        "text-[#b91c1c]": !positive() && !neutral(),
        "text-foreground-subtlest": neutral(),
      }}
    >
      {neutral() ? "+-0" : (positive() ? "+" : "") + percent() + "%"}
    </span>
  )
}

const formatTime = (time: number) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(
    new Date(time),
  )
