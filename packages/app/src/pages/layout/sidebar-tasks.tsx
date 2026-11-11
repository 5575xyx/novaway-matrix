import { type Session } from "@novaway/sdk/v2/client"
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { Icon } from "@novaway/ui/icon"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useLayout, type LocalProject, type TaskRecency, type TaskSortBy, appModeConfig } from "@/context/layout"
import { usePermission } from "@/context/permission"
import { useNotification } from "@/context/notification"
import { base64Encode } from "@novaway/core/util/encode"
import { displaySessionTitle } from "@/utils/session-title"
import { pathKey } from "@/utils/path-key"
import { decode64 } from "@/utils/base64"
import { sessionStatusOf, sortedRootSessionsFrom, withinRecency, requestCloseFramePages } from "./helpers"
import { TaskRow } from "@/components/session/task-row"

export type TaskFilter = "all" | "running" | "waiting" | "archived"

export type TaskFilterBarId = TaskFilter | "projects"

export function useProjectSessions(project: LocalProject) {
  const globalSync = useGlobalSync()

  const dirs = createMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const dir of [project.worktree, ...(project.sandboxes ?? [])]) {
      const key = pathKey(dir)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(dir)
    }
    return result
  })
  const stores = createMemo(() => dirs().map((dir) => globalSync.child(dir)[0]))
  const sessions = createMemo(() => sortedRootSessionsFrom(stores(), 0))

  return { dirs, stores, sessions }
}

export function useProjectTaskList(props: {
  project: LocalProject
  filter: () => TaskFilter
  archived: () => Session[] | undefined
  sortNow: Accessor<number>
  /** sessionID → 置顶时间；置顶任务排在最前。 */
  pinned?: () => Record<string, number>
  /** 侧栏「视图 → 排序方式」。 */
  sort?: Accessor<TaskSortBy>
  /** 侧栏「视图 → 最近活动」时间窗。 */
  recency?: Accessor<TaskRecency>
  /**
   * 「按日期 / 自定义」分组用的小筛子：同一个合并项目要按桶拆成好几段渲染，
   * 每段只留自己那部分会话。不传就是整段都要。
   */
  where?: (session: Session) => boolean
}) {
  const globalSync = useGlobalSync()
  const permission = usePermission()
  const notification = useNotification()
  const { stores } = useProjectSessions(props.project)

  return createMemo(() => {
    const filter = props.filter()
    const where = props.where
    if (filter === "archived") {
      return (props.archived() ?? []).filter((s) => !!s.time?.archived && (!where || where(s)))
    }
    const roots = sortedRootSessionsFrom(stores(), props.sortNow(), props.pinned?.(), props.sort?.()).filter(
      (session) => withinRecency(session, props.recency?.() ?? "all", props.sortNow()) && (!where || where(session)),
    )
    if (filter === "all") return roots
    return roots.filter((session) => sessionStatusOf(globalSync, permission, notification, session) === filter)
  })
}

export type TaskCounts = Record<TaskFilter, number>

/**
 * 侧栏顶部分段（全部 / 运行中 / 待确认 / 已归档）各自的数量。
 *
 * 数字按「侧栏里所有已打开项目」聚合 —— 分段是侧栏级的筛选器，不是某个项目私有的。
 * 归档数量单算：归档会话不在 `globalSync` 的 store 里（那份列表只装非归档），
 * 而是 `useArchivedSessions` 单独拉的 `session.list({ archived: true })`。
 *
 * 状态口径与任务行一致（都走 `sessionStatusOf`），所以分段上的数字和列表里的
 * 状态点不会互相矛盾。"运行中"把失败也算进去 —— 两者的区别只是状态点颜色，
 * 而分段过滤本来就只有 running/waiting 两档（见 useProjectTaskList）。
 */
export function useTaskCounts(props: {
  projects: () => LocalProject[]
  /** `useArchivedSessions` 的产物：directory → 已归档会话列表。 */
  archived: () => Record<string, Session[] | undefined>
  sortNow: Accessor<number>
  pinned?: () => Record<string, number>
  /** 与下方列表同口径的时间窗；不传就按"全部"数。 */
  recency?: Accessor<TaskRecency>
}): Accessor<TaskCounts> {
  const globalSync = useGlobalSync()
  const permission = usePermission()
  const notification = useNotification()

  return createMemo<TaskCounts>(() => {
    const counts: TaskCounts = { all: 0, running: 0, waiting: 0, archived: 0 }
    const recency = props.recency?.() ?? "all"
    for (const project of props.projects()) {
      const dirs: string[] = []
      const seen = new Set<string>()
      for (const dir of [project.worktree, ...(project.sandboxes ?? [])]) {
        const key = pathKey(dir)
        if (seen.has(key)) continue
        seen.add(key)
        dirs.push(dir)
      }
      const stores = dirs.map((dir) => globalSync.child(dir)[0])
      for (const session of sortedRootSessionsFrom(stores, props.sortNow(), props.pinned?.())) {
        if (!withinRecency(session, recency, props.sortNow())) continue
        counts.all += 1
        const status = sessionStatusOf(globalSync, permission, notification, session)
        if (status === "waiting") counts.waiting += 1
        else if (status === "running" || status === "failed") counts.running += 1
      }
      // 归档数与下方各项目的归档列表同口径：只数**当前项目目录**里的归档。
      // 曾经直接累加整个归档记录，把已删除工作区/别的项目残留的目录也算进去，
      // 表现为顶部分段有数字、项目下面却显示「没有匹配的任务」。
      for (const dir of dirs) {
        counts.archived += (props.archived()[dir] ?? []).filter((session) => !!session.time?.archived).length
      }
    }
    return counts
  })
}

export function ProjectTaskList(props: {
  project: LocalProject
  sidebarExpanded: () => boolean
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
  filter: () => TaskFilter
  archived: () => Session[] | undefined
  sortNow: Accessor<number>
  /** sessionID → 置顶时间；置顶任务排在最前。 */
  pinned?: () => Record<string, number>
  sort?: Accessor<TaskSortBy>
  recency?: Accessor<TaskRecency>
  where?: (session: Session) => boolean
  /**
   * 「按日期 / 自定义」分组时由调用方给的一段头。
   *
   * 计数与"空桶不渲染"都放在组件内部做：这一段的数据本来就是这里算出来的，
   * 让外面再算一遍等于把同一份筛选跑两次，还会和列表口径对不上。
   */
  bucket?: { label: string; expanded: () => boolean; onToggle: () => void }
}) {
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const permission = usePermission()
  const notification = useNotification()
  const language = useLanguage()
  const layout = useLayout()
  const params = useParams()
  const navigate = useNavigate()

  const sessions = useProjectTaskList(props)

  // 任务行的三项操作（重命名 / 归档 / 删除）都写回 globalSync 的会话列表。
  // 直接用会话自己的 directory：任务行可能来自 worktree 的 sandbox，不是项目根。
  const renameSession = async (session: Session, title: string) => {
    await globalSDK.client.session.update({ sessionID: session.id, title, directory: session.directory })
    const [, setSessionStore] = globalSync.child(session.directory)
    setSessionStore(
      "session",
      produce((draft) => {
        for (const item of draft) {
          if (item.id === session.id) {
            item.title = title
            break
          }
        }
      }),
    )
  }

  const removeSessionFromStore = (session: Session) => {
    const [, setSessionStore] = globalSync.child(session.directory)
    setSessionStore(
      "session",
      produce((draft) => {
        const index = draft.findIndex((item) => item.id === session.id)
        if (index >= 0) draft.splice(index, 1)
      }),
    )
  }

  // 任务行还要能下钻到子会话（子智能体会话）。
  // 之前只渲染根会话，子会话永远不出现，用户看到的是一排平铺条目、分不出层级。
  const childrenByParent = createMemo(() => {
    const map = new Map<string, Session[]>()
    for (const session of sessions()) {
      const [store] = globalSync.child(session.directory, { bootstrap: false })
      for (const item of store.session ?? []) {
        if (!item.parentID) continue
        const list = map.get(item.parentID)
        if (list) {
          if (!list.some((x) => x.id === item.id)) list.push(item)
        } else {
          map.set(item.parentID, [item])
        }
      }
    }
    return map
  })

  const [collapsed, setCollapsed] = createStore<Record<string, boolean | undefined>>({})

  const rowFor = (session: Session, level: number) => {
    const status = () => sessionStatusOf(globalSync, permission, notification, session)
    const [child] = globalSync.child(session.directory, { bootstrap: false })
    const kids = () => childrenByParent().get(session.id) ?? []
    return (
      <TaskRow
        title={() => displaySessionTitle(session.title, language.t("workspace.header.untitled"))}
        status={status}
        branch={() => child.vcs?.branch}
        updated={() => session.time?.updated}
        additions={() => session.summary?.additions ?? 0}
        deletions={() => session.summary?.deletions ?? 0}
        waitingBadge={() => status() === "waiting"}
        level={level}
        selected={() => {
          if (!params.id || params.id !== session.id) return false
          const directory = decode64(params.dir)
          if (!directory) return false
          return pathKey(directory) === pathKey(session.directory)
        }}
        modeColor={() => appModeConfig(layout.mode.projectMode(session.directory))?.color}
        onClick={() => {
          // 数据库 / 设置等整帧页面开着时，点任务应当先退出去。
          requestCloseFramePages()
          // 辅助对话 / 子代理会话：点侧栏的树节点应在右侧面板里打开，
          // 而不是整页跳到那条会话（那样会把主线从眼前挪走）。
          const tab = Object.values(layout.sidePane.dynamicTabs()).find((item) => item.sessionID === session.id)
          if (tab) {
            layout.sidePane.openSession(tab)
            return
          }
          navigate(`/${base64Encode(session.directory)}/session/${session.id}`)
        }}
        sessionID={session.id}
        directory={session.directory}
        pinned={layout.pinned.session(session.id)}
        onTogglePin={() => layout.pinned.toggleSession(session.id)}
        expander={
          kids().length > 0
            ? {
                expanded: !collapsed[session.id],
                toggle: () => setCollapsed(session.id, (value) => !value),
              }
            : undefined
        }
        onRename={(title) => renameSession(session, title)}
        onArchive={() => void props.archiveSession(session)}
        // 「移动到组」只在自定义分组模式下给，且只给根任务：子会话跟着父行走，
        // 单独给它归类既不会改变渲染结果，只会让人以为归类丢了。
        group={
          level === 1 && layout.taskList.groupBy() === "custom"
            ? {
                items: layout.taskList.groups(),
                current: layout.taskList.groupOf(session.id),
                onMove: (groupId) => layout.taskList.assignGroup(session.id, groupId),
              }
            : undefined
        }
        // 删除走带确认的对话框（在 TaskRow 里弹），这里只负责把本地列表摘掉；
        // 删的是当前会话时还要退回会话空态，否则会停在一个不存在的 id 上。
        onDelete={() => {
          if (params.id === session.id) navigate(`/${base64Encode(session.directory)}/session`)
          removeSessionFromStore(session)
        }}
      />
    )
  }

  return (
    <>
      <Show when={props.filter() !== "all" && !props.bucket && sessions().length === 0}>
        <div class="px-2 py-1.5 text-ui-caption text-foreground-subtle">{language.t("sidebar.filter.empty")}</div>
      </Show>
      <Show when={sessions().length > 0}>
        <Show when={props.bucket}>
          {(bucket) => (
            <TaskBucketHeader
              label={bucket().label}
              count={() => sessions().length}
              expanded={bucket().expanded}
              onToggle={bucket().onToggle}
            />
          )}
        </Show>
        {/*
          树形层级：项目行是这一组的根，任务缩进一级挂在它下面；任务自己的子会话
          （子智能体会话）再缩进一级。三者之间用一条竖向导引线绑住 —— 只靠缩进
          在浅色/深色下都不够清楚，而且任务行与项目行同宽时会读成一排平铺条目。

          `level` 的语义因此是「相对项目根的深度」：`1` = 直接挂在项目下的任务，
          `2` = 任务的子会话（见 TaskRow 的 padding-left 计算）。
        */}
        <Show when={!props.bucket || props.bucket.expanded()}>
          <div class="relative flex flex-col gap-0.5 pt-0.5" data-component="task-tree">
            <span aria-hidden="true" class="pointer-events-none absolute top-0 bottom-1 left-[15px] w-px bg-border" />
            <For each={sessions()}>
              {(session) => (
                <>
                  {rowFor(session, 1)}
                  <Show when={!collapsed[session.id] && (childrenByParent().get(session.id) ?? []).length > 0}>
                    <For each={childrenByParent().get(session.id) ?? []}>{(child) => rowFor(child, 2)}</For>
                  </Show>
                </>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </>
  )
}

/**
 * 「按日期 / 自定义」分组的分组头：与项目分组头保持同一套节奏
 * （箭头控折叠、名字占满、右侧圆角计数），换分组方式时视觉不会跳。
 */
export function TaskBucketHeader(props: {
  label: string
  count: () => number
  expanded: () => boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      class="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
      aria-expanded={props.expanded()}
      aria-label={props.label}
      onClick={() => props.onToggle()}
    >
      <Icon name={props.expanded() ? "chevron-down" : "chevron-right"} size="small" class="shrink-0" />
      <span class="text-ui-caption text-foreground font-medium truncate min-w-0">{props.label}</span>
      <Show when={props.count() > 0}>
        <span class="ml-auto shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-ui-xs font-medium leading-none text-foreground-subtle tabular-nums">
          {props.count()}
        </span>
      </Show>
    </button>
  )
}

export function TaskFilterBar(props: {
  filter: TaskFilterBarId
  onChange: (id: TaskFilterBarId) => void
  variant?: "text" | "underline"
  tabs?: Array<{ id: TaskFilterBarId; labelKey: string }>
  /** 每段后面的数量（分组头与筛选器都显示条数）。 */
  counts?: Accessor<TaskCounts>
}) {
  const language = useLanguage()
  const variant = props.variant ?? "text"
  const defaults: Array<{ id: TaskFilter; labelKey: string }> = [
    { id: "all", labelKey: "sidebar.filter.all" },
    { id: "running", labelKey: "sidebar.filter.running" },
    { id: "waiting", labelKey: "sidebar.filter.waiting" },
    { id: "archived", labelKey: "sidebar.filter.archived" },
  ]
  const tabs = props.tabs ?? defaults
  const countOf = (id: TaskFilterBarId) => {
    if (id === "projects") return 0
    return props.counts?.()[id] ?? 0
  }

  return (
    <div
      role="tablist"
      classList={{
        "flex items-center px-3 gap-3 pb-1 text-ui-sm": variant === "text",
        "flex items-center px-3 gap-4 border-b border-border text-ui-caption": variant === "underline",
      }}
    >
      <For each={tabs}>
        {(tab) => (
          <button
            role="tab"
            aria-selected={props.filter === tab.id}
            classList={{
              "transition-colors": true,
              "border-b-2 -mb-px pb-1.5": variant === "underline",
              "border-icon-blue text-foreground font-medium": variant === "underline" && props.filter === tab.id,
              "border-transparent text-foreground-subtle hover:text-foreground":
                variant === "underline" && props.filter !== tab.id,
              "text-foreground font-medium": variant === "text" && props.filter === tab.id,
              "text-foreground-subtle hover:text-foreground": variant === "text" && props.filter !== tab.id,
            }}
            onClick={() => props.onChange(tab.id)}
          >
            {language.t(tab.labelKey)}
            {/* 数量：0 不显示，免得一排 "全部 0 运行中 0" 变成噪音。 */}
            <Show when={countOf(tab.id) > 0}>
              <span
                classList={{
                  "ml-1 tabular-nums": true,
                  "text-foreground": variant === "text" && props.filter === tab.id,
                  "text-foreground-subtlest": !(variant === "text" && props.filter === tab.id),
                }}
              >
                {countOf(tab.id)}
              </span>
            </Show>
          </button>
        )}
      </For>
    </div>
  )
}

export function useArchivedSessions(projects: () => LocalProject[]) {
  const globalSDK = useGlobalSDK()
  const [archived, setArchived] = createSignal<Record<string, Session[]>>({})
  let version = 0

  const load = () => {
    version += 1
    const current = version
    void Promise.all(
      projects().flatMap((project) =>
        [project.worktree, ...(project.sandboxes ?? [])].map(async (directory) => {
          const sessions = await globalSDK.client.experimental.session
            .list({ directory, archived: true, roots: true, limit: 500 })
            .then((result) => result.data ?? [])
            .catch(() => [] as Session[])
          return [directory, sessions] as const
        }),
      ),
    ).then((entries) => {
      if (current !== version) return
      setArchived(Object.fromEntries(entries))
    })
  }

  return { archived, load }
}
