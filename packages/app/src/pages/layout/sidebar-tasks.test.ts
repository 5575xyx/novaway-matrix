import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const layoutSource = readFileSync(join(import.meta.dir, "..", "layout.tsx"), "utf8")
const tasksSource = readFileSync(join(import.meta.dir, "sidebar-tasks.tsx"), "utf8")

describe("task filter drives the project badge", () => {
  test("exposes a single filtered list to the rows", () => {
    expect(tasksSource).toContain("export function useProjectTaskList")
    expect(tasksSource).toContain("const sessions = useProjectTaskList(props)")
  })

  // 项目行的计数徽章已按 ZCode 去掉（它的项目行只有图标 + 名称，没有「N 个任务」），
  // 筛选状态改由列表本身与 TaskFilterBar 表达。这里改为断言「徽章确实不再渲染」，
  // 并保留「不许用未过滤的 sessions().length 凑数」这条原始意图。
  test("project rows no longer render a task-count badge", () => {
    expect(layoutSource).not.toContain('language.t("sidebar.project.count"')
    expect(layoutSource).not.toContain("{ count: sessions().length }")
    // 项目列表本身仍在（改为直接渲染 <ProjectTaskList>，不再在项目行上算徽章）
    expect(layoutSource).toContain("<ProjectTaskList")
  })

  test("asks for help when a non-default filter matches nothing", () => {
    expect(tasksSource).toContain('props.filter() !== "all" && sessions().length === 0')
    expect(tasksSource).toContain('language.t("sidebar.filter.empty")')
  })
})

describe("sidebar project entry points", () => {
  // 侧栏顶部改成两个整宽入口后，第一个是「新建任务」，不再有把图标挤在一起的 plus 工具条。
  // 「打开项目」入口保留在：项目列表为空时的空态按钮、以及 command（mod+o）。
  test("the header new-task entry creates a task, the project entry lives in the empty state", () => {
    const header = layoutSource.slice(layoutSource.indexOf('aria-label={language.t("sidebar.newTask")}'))
    expect(header.slice(0, 260)).toContain("navigateWithSidebarReset")
    const emptyState = layoutSource.slice(layoutSource.indexOf('language.t("sidebar.empty.title")'))
    expect(emptyState.slice(0, 400)).toContain("onClick={chooseProject}")
  })

  test("every project row keeps its own new task action", () => {
    expect(layoutSource).toContain('aria-label={language.t("sidebar.newTask")}')
    expect(layoutSource).toContain("opacity-0 group-hover:opacity-100 focus-visible:opacity-100")
    expect(layoutSource).toContain("navigateWithSidebarReset(`/${base64Encode(proj.worktree)}/session`)")
  })
})
