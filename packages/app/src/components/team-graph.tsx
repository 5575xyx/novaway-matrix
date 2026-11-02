import { For, Show, createMemo, type JSX } from "solid-js"
import { Tag } from "@novaway/ui/tag"
import { useLanguage } from "@/context/language"
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  layoutRun,
  type GraphEdge,
  type GraphLane,
  type GraphLaneInput,
  type GraphNode,
} from "./team-graph.layout"

/**
 * 工作线图（§4.3）。
 *
 * 一条工作线说的是「队长把活派给谁、谁做完了什么、产物怎么交回去」。任务板能列出来，
 * 但列不出形状；图能。这里只画结构与状态：节点的文字来自任务标题与名册人名，
 * 不展开成员的输出、命令或路径 —— 与事件流、回放同一条约束。
 */

const truncate = (value: string, max: number) => (value.length > max ? value.slice(0, max - 1) + "…" : value)

const NODE_TONE: Record<string, string> = {
  active: "stroke-primary fill-primary/8",
  done: "stroke-success fill-success/8",
  idle: "stroke-border fill-surface",
  pending: "stroke-border fill-surface",
  in_progress: "stroke-primary fill-primary/8",
  completed: "stroke-success fill-success/8",
  failed: "stroke-destructive fill-destructive/8",
  cancelled: "stroke-border fill-surface",
}

const EDGE_TONE: Record<GraphEdge["kind"], string> = {
  assign: "stroke-border",
  work: "stroke-primary/60",
  deliver: "stroke-success/70",
}

const ROUND_TONE = [
  "text-primary border-primary/40 bg-primary/10",
  "text-warning border-warning/40 bg-warning/10",
  "text-success border-success/40 bg-success/10",
]

const nodeTone = (node: GraphNode) => {
  if (node.kind === "captain") return node.status === "active" ? NODE_TONE.active : "stroke-primary/50 fill-primary/5"
  return NODE_TONE[node.status] ?? NODE_TONE.idle
}

/** 节点中心到节点中心的一条弧线；交付回边绕到下面，表示「交回去」。 */
function edgePath(edge: GraphEdge, byID: Map<string, GraphNode>): string | undefined {
  const from = byID.get(edge.from)
  const to = byID.get(edge.to)
  if (!from || !to) return undefined
  const fromY = from.y + NODE_HEIGHT / 2
  const toY = to.y + NODE_HEIGHT / 2
  if (edge.kind === "deliver") {
    const x1 = from.x
    const x2 = to.x + NODE_WIDTH
    const dip = Math.max(fromY, toY) + 46
    return `M ${x1} ${fromY} C ${x1 - 60} ${dip}, ${x2 + 60} ${dip}, ${x2} ${toY}`
  }
  const x1 = from.x + NODE_WIDTH
  const x2 = to.x
  const dx = Math.max(36, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${fromY} C ${x1 + dx} ${fromY}, ${x2 - dx} ${toY}, ${x2} ${toY}`
}

export function TeamGraph(props: {
  teams: readonly GraphLaneInput[]
  /** 团队名来自模板；找不到模板时上层给出可辨认的占位。 */
  nameOf: (lane: { id: string; name: string }) => string
}): JSX.Element {
  const language = useLanguage()
  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)
  const lanes = createMemo(() => layoutRun({ teams: props.teams }))

  return (
    <div class="flex flex-col gap-3">
      <For each={lanes()}>
        {(lane) => (
          <div class="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-3 py-2">
            <div class="flex flex-wrap items-center gap-1.5 text-ui-xs">
              <span class="text-foreground">{props.nameOf(lane)}</span>
              <span
                classList={{
                  "rounded-full border px-1.5 py-0.5": true,
                  [ROUND_TONE[(lane.round - 1 + ROUND_TONE.length) % ROUND_TONE.length] ?? ROUND_TONE[0]]: true,
                }}
              >
                {t("team.graph.round", { round: String(lane.round) })}
              </span>
              <Tag>{t(`run.team.phase.${lane.phase}`)}</Tag>
              <span class="text-foreground-subtle">
                {lane.participants === 0
                  ? t("team.graph.participantsPending")
                  : t("team.graph.participants", {
                      count: String(lane.participants),
                      names: lane.nodes
                        .filter((node) => node.kind === "member" && node.status !== "idle")
                        .map((node) => node.label)
                        .join("、"),
                    })}
              </span>
              <Show when={lane.unassigned > 0}>
                <span class="text-warning">{t("team.graph.unassigned", { count: String(lane.unassigned) })}</span>
              </Show>
            </div>
            <div class="overflow-x-auto">
              <LaneGraph lane={lane} />
            </div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-ui-xs text-foreground-subtlest">
              <span>{t("team.graph.legend.assign")}</span>
              <span>{t("team.graph.legend.work")}</span>
              <span>{t("team.graph.legend.deliver")}</span>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

/**
 * 一条泳道的图。
 *
 * 节点索引只算一次：每条边都去重建一次 Map，边一多就是平方级的浪费，
 * 而且没有任何理由让「同一个节点的坐标」在两次查找里不同。
 */
function LaneGraph(props: { lane: GraphLane }): JSX.Element {
  const language = useLanguage()
  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)
  const statusLabel = (status: string) =>
    ["pending", "in_progress", "completed", "failed", "cancelled"].includes(status)
      ? t(`team.graph.status.${status}`)
      : status
  const byID = createMemo(() => new Map(props.lane.nodes.map((node) => [node.id, node])))

  return (
    <svg
      class="block"
      viewBox={`0 0 ${props.lane.width} ${props.lane.height}`}
      width={props.lane.width}
      height={props.lane.height}
      role="img"
      aria-label={t("team.graph.aria", { name: props.lane.name })}
    >
      <defs>
        <marker
          id={"arrow-" + props.lane.id}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          {/* context-stroke 让箭头跟它所在的边同色，不必为每种颜色各建一个 marker。 */}
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
      </defs>
      <For each={props.lane.edges}>
        {(edge) => (
          <path
            d={edgePath(edge, byID())}
            fill="none"
            class={EDGE_TONE[edge.kind]}
            classList={{ "animate-pulse": edge.active, "opacity-60": edge.kind === "deliver" }}
            stroke-width={edge.kind === "deliver" ? 1.2 : 1.4}
            stroke-dasharray={edge.kind === "deliver" ? "5 4" : undefined}
            marker-end={"url(#arrow-" + props.lane.id + ")"}
          />
        )}
      </For>
      <For each={props.lane.nodes}>
        {(node) => (
          <g class={node.status === "in_progress" ? "animate-pulse" : undefined}>
            <rect
              x={node.x}
              y={node.y}
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx="8"
              stroke-width={node.kind === "captain" ? 1.6 : 1.2}
              class={nodeTone(node)}
            />
            <text x={node.x + 10} y={node.y + 19} class="fill-foreground text-[12px]">
              {truncate(node.label, node.kind === "task" ? 18 : 14)}
            </text>
            <text x={node.x + 10} y={node.y + 35} class="fill-foreground-subtle text-[10px]">
              {node.kind === "task"
                ? statusLabel(node.status)
                : node.kind === "captain"
                  ? t(node.sublabel === "busy" ? "team.graph.captainBusy" : "team.graph.captainIdle")
                  : truncate(node.sublabel || (node.status === "idle" ? t("team.graph.idle") : ""), 22)}
            </text>
          </g>
        )}
      </For>
    </svg>
  )
}
