import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { described } from "./metadata"

const root = "/session/:sessionId/workflows"

export const WorkflowApi = HttpApiGroup.make("workflow")
  .add(
    HttpApiEndpoint.get("listWorkflows", root)
      .annotate(described, { summary: "获取会话工作流列表" }),
  )
  .add(
    HttpApiEndpoint.post("createWorkflow", root)
      .annotate(described, { summary: "创建工作流" })
      .payload(
        Schema.Struct({
          name: Schema.String,
          description: Schema.optional(Schema.String),
          steps: Schema.Array(Schema.Struct({
            id: Schema.String,
            name: Schema.String,
            type: Schema.Literals(["agent", "tool", "skill", "condition", "parallel"]),
            config: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
            next: Schema.optional(Schema.String),
            nextTrue: Schema.optional(Schema.String),
            nextFalse: Schema.optional(Schema.String),
            steps: Schema.optional(Schema.Array(Schema.String)),
          })),
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("getWorkflow", "/workflows/:workflowId")
      .annotate(described, { summary: "获取工作流详情" }),
  )
  .add(
    HttpApiEndpoint.patch("updateWorkflow", "/workflows/:workflowId")
      .annotate(described, { summary: "更新工作流" })
      .payload(
        Schema.Struct({
          name: Schema.optional(Schema.String),
          description: Schema.optional(Schema.String),
          steps: Schema.optional(Schema.Array(Schema.Unknown)),
          status: Schema.optional(Schema.Literals(["draft", "running", "paused", "completed", "failed"])),
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("deleteWorkflow", "/workflows/:workflowId")
      .annotate(described, { summary: "删除工作流" }),
  )
  .add(
    HttpApiEndpoint.post("startWorkflow", "/workflows/:workflowId/start")
      .annotate(described, { summary: "启动工作流" }),
  )
  .add(
    HttpApiEndpoint.get("listWorkflowRuns", "/workflows/:workflowId/runs")
      .annotate(described, { summary: "获取工作流运行记录" }),
  )