import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { useDialog } from "@novaway/ui/context/dialog"
import { Dialog } from "@novaway/ui/dialog"
import { Icon } from "@novaway/ui/icon"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { buildGitGraph, classifyRef, type GraphCommit, type GraphRow } from "./git-graph-model"

const LANE_WIDTH = 16
const ROW_HEIGHT = 36

const laneX = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2
const laneColor = (color: number) => "hsl(" + ((color * 57 + 12) % 360) + " 68% 55%)"

const lanePath = (from: number, to: number) =>
  "M " +
  laneX(from) +
  " " +
  ROW_HEIGHT / 2 +
  " C " +
  laneX(from) +
  " " +
  ROW_HEIGHT * 0.78 +
  ", " +
  laneX(to) +
  " " +
  ROW_HEIGHT * 0.78 +
  ", " +
  laneX(to) +
  " " +
  ROW_HEIGHT

function refStyle(kind: ReturnType<typeof classifyRef>["kind"]) {
  if (kind === "head") return "border-primary/40 bg-primary/10 text-primary"
  if (kind === "tag") return "border-warning/40 bg-warning/10 text-warning"
  return "border-border bg-surface text-foreground-subtle"
}

type RowProps = {
  row: GraphRow
  active: boolean
  dim: boolean
  onHover: (row: GraphRow | undefined) => void
  onSelect: (row: GraphRow) => void
}

function Row(props: RowProps): JSX.Element {
  const width = () => props.row.laneCount * LANE_WIDTH
  const opacity = () => (props.dim ? 0.28 : 1)

  return (
    <button
      type="button"
      data-graph-row={props.row.hash}
      data-active={props.active ? "true" : undefined}
      class="flex w-full min-w-0 items-stretch border-t border-border/60 text-left transition-colors first:border-t-0"
      classList={{ "bg-hover": props.active, "hover:bg-hover/60": !props.active }}
      onMouseEnter={() => props.onHover(props.row)}
      onMouseLeave={() => props.onHover(undefined)}
      onFocus={() => props.onHover(props.row)}
      onBlur={() => props.onHover(undefined)}
      onClick={() => props.onSelect(props.row)}
    >
      <div class="relative shrink-0" style={{ width: width() + "px", height: ROW_HEIGHT + "px" }}>
        <svg width={width()} height={ROW_HEIGHT} class="block overflow-visible">
          <For each={props.row.through}>
            {(item) => (
              <line
                x1={laneX(item.lane)}
                y1={0}
                x2={laneX(item.lane)}
                y2={ROW_HEIGHT}
                stroke={laneColor(item.color)}
                stroke-width={props.active ? 3 : 2}
                stroke-linecap="round"
                opacity={opacity()}
              />
            )}
          </For>
          <Show when={props.row.fromTop}>
            <line
              x1={laneX(props.row.lane)}
              y1={0}
              x2={laneX(props.row.lane)}
              y2={ROW_HEIGHT / 2}
              stroke={laneColor(props.row.color)}
              stroke-width={props.active ? 3 : 2}
              stroke-linecap="round"
              opacity={opacity()}
            />
          </Show>
          <For each={props.row.down}>
            {(edge) => (
              <Show
                when={edge.from !== edge.to}
                fallback={
                  <line
                    x1={laneX(edge.from)}
                    y1={ROW_HEIGHT / 2}
                    x2={laneX(edge.to)}
                    y2={ROW_HEIGHT}
                    stroke={laneColor(edge.color)}
                    stroke-width={props.active ? 3 : 2}
                    stroke-linecap="round"
                    opacity={opacity()}
                  />
                }
              >
                <path
                  d={lanePath(edge.from, edge.to)}
                  fill="none"
                  stroke={laneColor(edge.color)}
                  stroke-width={props.active ? 3 : 2}
                  stroke-linecap="round"
                  opacity={opacity()}
                />
              </Show>
            )}
          </For>
          <circle
            cx={laneX(props.row.lane)}
            cy={ROW_HEIGHT / 2}
            r={props.active ? 5.5 : 4}
            fill={laneColor(props.row.color)}
            stroke="var(--background)"
            stroke-width={2}
            opacity={opacity()}
          />
        </svg>
      </div>

      <div class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1">
        <div class="flex min-w-0 flex-1 items-center gap-1.5">
          <span class="min-w-0 truncate text-ui-base text-foreground">{props.row.subject || props.row.hash}</span>
          <For each={props.row.refs ?? []}>
            {(ref) => {
              const item = classifyRef(ref)
              const label = item.kind === "head" ? item.label.replace(/^HEAD -> /, "") : item.label
              return (
                <span class={"shrink-0 rounded border px-1.5 py-0.5 text-ui-xs " + refStyle(item.kind)}>{label}</span>
              )
            }}
          </For>
        </div>
        <span class="shrink-0 font-mono text-ui-xs text-foreground-subtlest">{props.row.hash}</span>
        <span class="hidden shrink-0 text-ui-xs text-foreground-subtle sm:inline">{props.row.author}</span>
        <span class="shrink-0 text-ui-xs tabular-nums text-foreground-subtlest">{props.row.date}</span>
      </div>
    </button>
  )
}

export function GitGraph(props: {
  commits: readonly GraphCommit[]
  empty?: string
  onSelect?: (row: GraphRow) => void
}) {
  const rows = createMemo(() => buildGitGraph(props.commits ?? []))
  const [hover, setHover] = createSignal<GraphRow>()

  // 悬停某一行时，同一泳道（同列）的连线与节点一起高亮，其余淡化：
  // 这样一眼就能看出这条分支从哪来、并到哪去。
  const activeLane = () => hover()?.lane

  return (
    <Show
      when={rows().length > 0}
      fallback={<div class="px-2 py-6 text-center text-ui-base text-foreground-subtle">{props.empty}</div>}
    >
      <div class="flex min-w-0 flex-col overflow-x-auto py-1">
        <For each={rows()}>
          {(row) => (
            <Row
              row={row}
              active={hover()?.hash === row.hash}
              dim={activeLane() !== undefined && activeLane() !== row.lane}
              onHover={setHover}
              onSelect={(item) => props.onSelect?.(item)}
            />
          )}
        </For>
      </div>
    </Show>
  )
}

type Detail = {
  hash: string
  subject: string
  body: string
  author: string
  authorEmail: string
  date: string
  parents: string[]
  refs: string[]
  files: Array<{ file: string; additions: number; deletions: number; binary: boolean }>
}

function CommitDetail(props: { hash: string }) {
  const sdk = useSDK()
  const language = useLanguage()
  const [detail, setDetail] = createSignal<Detail>()
  const [loading, setLoading] = createSignal(true)

  createEffect(() => {
    const hash = props.hash
    setLoading(true)
    setDetail(undefined)
    void sdk.client.git.commit2
      .detail({ hash, directory: sdk.directory })
      .then((result) => {
        const data = result.data
        if (!data) return setDetail(undefined)
        setDetail({
          ...data,
          files: data.files.map((file) => ({
            file: file.file,
            additions: Number(file.additions) || 0,
            deletions: Number(file.deletions) || 0,
            binary: file.binary,
          })),
        })
      })
      .catch((error: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setLoading(false))
  })

  return (
    <div class="flex flex-col gap-3">
      <Show
        when={!loading()}
        fallback={<div class="text-12-regular text-foreground-subtle">{language.t("common.loading")}</div>}
      >
        <Show when={detail()}>
          {(value) => (
            <>
              <div class="flex flex-col gap-1">
                <div class="text-14-medium text-foreground">{value().subject}</div>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-12-regular text-foreground-subtle">
                  <span>{value().author}</span>
                  <span>{value().date}</span>
                  <span class="font-mono">{value().hash.slice(0, 10)}</span>
                </div>
              </div>
              <Show when={value().body.trim()}>
                <pre class="whitespace-pre-wrap break-words rounded-lg border border-border bg-surface/60 p-3 font-sans text-12-regular leading-5 text-foreground">
                  {value().body}
                </pre>
              </Show>
              <Show when={value().refs.length > 0}>
                <div class="flex flex-wrap items-center gap-1.5">
                  <For each={value().refs}>
                    {(ref) => {
                      const item = classifyRef(ref)
                      const label = item.kind === "head" ? item.label.replace(/^HEAD -> /, "") : item.label
                      return (
                        <span class={"rounded border px-1.5 py-0.5 text-ui-xs " + refStyle(item.kind)}>{label}</span>
                      )
                    }}
                  </For>
                </div>
              </Show>
              <div class="flex min-h-0 flex-col gap-1">
                <div class="text-12-medium text-foreground-subtle">
                  {language.t("git.graph.files", { count: value().files.length })}
                </div>
                <div class="flex flex-col rounded-lg border border-border">
                  <For each={value().files}>
                    {(file) => (
                      <div class="flex items-center gap-2 border-t border-border px-2.5 py-1.5 text-12-regular first:border-t-0">
                        <Icon name="code-lines" size="small" class="shrink-0 text-foreground-subtle" />
                        <span class="min-w-0 flex-1 truncate text-foreground">{file.file}</span>
                        <Show
                          when={!file.binary}
                          fallback={<span class="text-foreground-subtlest">{language.t("git.binary")}</span>}
                        >
                          <span class="shrink-0 tabular-nums">
                            <span class="text-[var(--diff-added)]">+{file.additions}</span>{" "}
                            <span class="text-[var(--diff-removed)]">-{file.deletions}</span>
                          </span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </>
          )}
        </Show>
      </Show>
    </div>
  )
}

export function GitGraphDialog(props: { commits: readonly GraphCommit[]; title?: string }) {
  const dialog = useDialog()
  const language = useLanguage()
  const [selected, setSelected] = createSignal<GraphRow>()

  return (
    <Dialog
      title={props.title ?? language.t("git.graph.title")}
      transition
      class="w-[min(calc(100vw-40px),1040px)] overflow-hidden"
    >
      <div class="flex min-h-0 gap-3 px-2.5 pb-3" style={{ height: "min(calc(100vh - 220px), 640px)" }}>
        <div class="min-w-0 flex-1 overflow-y-auto rounded-lg border border-border">
          <GitGraph
            commits={props.commits}
            empty={language.t("git.graph.empty")}
            onSelect={(row) => setSelected(row)}
          />
        </div>
        <aside class="flex w-[20rem] shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface/40 p-3">
          <Show
            when={selected()}
            fallback={
              <div class="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <Icon name="branch" size="normal" class="text-foreground-subtlest" />
                <span class="text-12-regular text-foreground-subtle">{language.t("git.graph.selectHint")}</span>
              </div>
            }
          >
            {(row) => (
              <>
                <div class="sticky top-0 z-10 -mx-3 -mt-3 mb-1 flex items-center justify-between gap-2 border-b border-border bg-surface/95 px-3 py-2 backdrop-blur">
                  <span class="text-12-medium text-foreground-subtle">{language.t("git.graph.detail")}</span>
                  <span class="font-mono text-ui-xs text-foreground-subtlest">{row().hash}</span>
                </div>
                <CommitDetail hash={row().hash} />
              </>
            )}
          </Show>
        </aside>
      </div>
      <div class="flex justify-end px-2.5 pb-2">
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-ui-base text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
          onClick={() => dialog.close()}
        >
          {language.t("common.close")}
        </button>
      </div>
    </Dialog>
  )
}
