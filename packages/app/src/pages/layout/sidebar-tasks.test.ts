import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Session } from "@novaway/sdk/v2/client"
import { indexSidebarChildren } from "./sidebar-child-index"

const layoutSource = readFileSync(join(import.meta.dir, "..", "layout.tsx"), "utf8")
const tasksSource = readFileSync(join(import.meta.dir, "sidebar-tasks.tsx"), "utf8")

describe("task filter drives the project badge", () => {
  test("uses the same filtered list for project counts and task rows", () => {
    expect(layoutSource).toContain("const projectTaskCount = () => model.sessions().length")
    expect(layoutSource).toContain("<ProjectTaskList {...taskListView} model={model} />")
    expect(tasksSource).toContain("props.bucketSessions?.() ?? allSessions()")
  })

  test("asks for help when a non-default filter matches nothing", () => {
    // 分段（按日期 / 自定义）自己会因"这段没任务"整段不渲染，所以那句
    // 「没有匹配的任务」只在没有分段时说，否则会看到四五个空标题排队道歉。
    expect(tasksSource).toContain('props.filter() !== "all" && !props.bucket && sessions().length === 0')
    expect(tasksSource).toContain('language.t("sidebar.filter.empty")')
  })
})

describe("sidebar project entry points", () => {
  // 侧栏顶部改成两个整宽入口后，第一个是「新建任务」，不再有把图标挤在一起的 plus 工具条。
  // 「打开项目」入口保留在：项目列表为空时的空态按钮、以及 command（mod+o）。
  test("the header new-task entry creates a task, the project entry lives in the empty state", () => {
    const header = layoutSource.slice(layoutSource.indexOf('aria-label={language.t("sidebar.newTask")}'))
    // 入口现在复用 startNewTask（图标条收起时也用同一个函数），跳转逻辑在它里面。
    expect(header.slice(0, 260)).toContain("onClick={startNewTask}")
    const start = layoutSource.slice(layoutSource.indexOf("function startNewTask"))
    expect(start.slice(0, 400)).toContain("navigateWithSidebarReset")
    const emptyState = layoutSource.slice(layoutSource.indexOf('language.t("sidebar.empty.title")'))
    expect(emptyState.slice(0, 400)).toContain("onClick={chooseProject}")
  })

  test("every project row keeps its own new task action", () => {
    expect(layoutSource).toContain('aria-label={language.t("sidebar.newTask")}')
    expect(layoutSource).toContain("opacity-0 group-hover:opacity-100 focus-visible:opacity-100")
    expect(layoutSource).toContain("navigateWithSidebarReset(`/${base64Encode(proj.worktree)}/session`)")
  })
})

const session = (id: string, directory: string, parentID?: string): Session => ({
  id,
  directory,
  parentID,
  projectID: "project",
  scope: "project",
  slug: id,
  title: id,
  version: "test",
  time: { created: 0, updated: 0 },
})

describe("sidebar child index", () => {
  test("reads each normalized directory once for 200 root tasks and preserves parent and child order", () => {
    const workspace = "C:/workspace"
    const sandbox = "/workspace-sandbox"
    const roots = Array.from({ length: 200 }, (_, index) =>
      session(`root-${index}`, index % 2 === 0 ? workspace : ["C:", "workspace", ""].join(String.fromCharCode(92))),
    )
    const first = session("child-first", workspace, "root-0")
    const second = session("child-second", workspace, "root-0")
    const last = session("child-sandbox", sandbox, "root-0")
    const sandboxChild = session("child-other-parent", sandbox, "sandbox-root")
    const rows = new Map([
      [workspace, [...roots, first, second, session(first.id, workspace, "root-0")]],
      [sandbox, [session(first.id, sandbox, "root-0"), last, sandboxChild]],
    ])
    const reads: string[] = []
    const indexed = indexSidebarChildren([...roots, session("sandbox-root", sandbox)], (directory) => {
      reads.push(directory)
      return rows.get(directory)
    })
    expect(reads).toEqual([workspace, sandbox])
    expect(indexed.get("root-0")).toEqual([first, second, last])
    expect(indexed.get("root-0")?.[0]).toBe(first)
    expect(indexed.get("sandbox-root")).toEqual([sandboxChild])
    expect(indexed.has("root-1")).toBe(false)
  })
})
