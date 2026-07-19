import { describe, expect, test } from "bun:test"
import { reconcileTasks, taskTodos } from "../../src/powersnexus/reconcile"
import type { WorkflowTask } from "../../src/powersnexus/workflow-schema"

const tasks: WorkflowTask[] = [
  {
    id: "TASK-1",
    requirementIDs: ["REQ-1"],
    title: "实现登录",
    status: "pending",
    dependsOn: [],
  },
]

describe("PowersNexus Todo 协调", () => {
  test("使用稳定 TASK-ID 生成 Session Todo", () => {
    expect(taskTodos(tasks)).toEqual([{ content: "[TASK-1] 实现登录", status: "pending", priority: "medium" }])
  })

  test("仅工件变化时更新 Session，仅 Session 变化时生成工件状态操作", () => {
    expect(
      reconcileTasks({
        tasks,
        todos: [],
        state: { artifactRevision: 0, sessionRevision: 0, origin: "artifact" },
        artifactRevision: 1,
        sessionRevision: 0,
      }),
    ).toMatchObject({ type: "update-session" })

    expect(
      reconcileTasks({
        tasks,
        todos: [{ content: "[TASK-1] 实现登录", status: "completed", priority: "medium" }],
        state: { artifactRevision: 1, sessionRevision: 0, origin: "artifact" },
        artifactRevision: 1,
        sessionRevision: 1,
      }),
    ).toMatchObject({ type: "update-artifact", tasks: [{ id: "TASK-1", status: "completed" }] })
  })

  test("两侧同 revision 周期同时变化且状态不同则返回明确冲突", () => {
    expect(
      reconcileTasks({
        tasks,
        todos: [{ content: "[TASK-1] 实现登录", status: "completed", priority: "medium" }],
        state: { artifactRevision: 0, sessionRevision: 0, origin: "artifact" },
        artifactRevision: 1,
        sessionRevision: 1,
      }),
    ).toEqual({ type: "conflict", code: "TASK_STATE_CONFLICT", taskIDs: ["TASK-1"] })
  })
})
