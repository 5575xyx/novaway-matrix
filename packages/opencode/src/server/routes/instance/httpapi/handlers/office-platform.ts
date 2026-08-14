import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { MCP } from "@/mcp"
import { OfficePlatform } from "@/office/platform"
import { InstanceHttpApi } from "../api"
import {
  BrowserStartPayload,
  OfficeConnectorActionPayload,
  OfficeConnectorConfig,
  OfficeScheduleFromWorkflowInput,
  OfficeScheduleInput,
  OfficeScheduleUpdate,
  OfficeWorkflowRunInput,
  OfficeWorkflowInput,
  OfficeWorkflowUpdate,
} from "../groups/office-platform"

export const officePlatformHandlers = HttpApiBuilder.group(InstanceHttpApi, "office-platform", (handlers) =>
  Effect.gen(function* () {
    const platform = yield* OfficePlatform.Service
    const mcp = yield* MCP.Service

    const browserToolID = Effect.fn("OfficePlatformHttpApi.browserToolID")(function* (name: string) {
      const tools = yield* mcp.tools()
      const id = Object.keys(tools).find((key) => key === `browser_${name}` || key.endsWith(`_${name}`))
      if (!id) return yield* new HttpApiError.BadRequest({})
      return id
    })

    const mcpSnapshot = Effect.fn("OfficePlatformHttpApi.mcpSnapshot")(function* () {
      const toolID = yield* browserToolID("browser_snapshot")
      const result = yield* mcp.callTool(toolID, {}).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      const text = Array.isArray(result && typeof result === "object" && "content" in result)
        ? (result as { content: Array<{ type: string; text?: string }> }).content
            .map((part) => part.text ?? "")
            .filter(Boolean)
            .join("\n")
        : String(result)
      return {
        url: "",
        title: "",
        text,
        bodyText: text,
        refs: [],
        overflow: false,
        focusVisible: true,
      }
    })

    const status = Effect.fn("OfficePlatformHttpApi.status")(function* () {
      const base = yield* platform.status()
      const statusMap = yield* mcp.status()
      const browserInfo = statusMap.browser
      const browser: "configured" | "connected" | "failed" =
        browserInfo?.status === "connected"
          ? "connected"
          : browserInfo?.status === "failed"
            ? "failed"
            : "configured"
      return {
        ...base,
        diagnostics: {
          ...base.diagnostics,
          browser,
        },
      }
    })

    const listSchedules = Effect.fn("OfficePlatformHttpApi.listSchedules")(function* () {
      return yield* platform.listSchedules()
    })

    const createSchedule = Effect.fn("OfficePlatformHttpApi.createSchedule")(function* (ctx: {
      payload: typeof OfficeScheduleInput.Type
    }) {
      return yield* platform.createSchedule(ctx.payload)
    })

    const updateSchedule = Effect.fn("OfficePlatformHttpApi.updateSchedule")(function* (ctx: {
      params: { id: string }
      payload: typeof OfficeScheduleUpdate.Type
    }) {
      const result = yield* platform.updateSchedule(ctx.params.id, ctx.payload)
      if (!result) return yield* new HttpApiError.NotFound({})
      return result
    })

    const deleteSchedule = Effect.fn("OfficePlatformHttpApi.deleteSchedule")(function* (ctx: {
      params: { id: string }
    }) {
      return yield* platform.deleteSchedule(ctx.params.id)
    })

    const listRuns = Effect.fn("OfficePlatformHttpApi.listRuns")(function* () {
      return yield* platform.listRuns()
    })

    const listWorkflows = Effect.fn("OfficePlatformHttpApi.listWorkflows")(function* () {
      return yield* platform.listWorkflows()
    })

    const createWorkflow = Effect.fn("OfficePlatformHttpApi.createWorkflow")(function* (ctx: {
      payload: typeof OfficeWorkflowInput.Type
    }) {
      return yield* platform.createWorkflow(ctx.payload)
    })

    const updateWorkflow = Effect.fn("OfficePlatformHttpApi.updateWorkflow")(function* (ctx: {
      params: { id: string }
      payload: typeof OfficeWorkflowUpdate.Type
    }) {
      const result = yield* platform.updateWorkflow(ctx.params.id, ctx.payload)
      if (!result) return yield* new HttpApiError.NotFound({})
      return result
    })

    const deleteWorkflow = Effect.fn("OfficePlatformHttpApi.deleteWorkflow")(function* (ctx: {
      params: { id: string }
    }) {
      return yield* platform.deleteWorkflow(ctx.params.id)
    })

    const runSchedule = Effect.fn("OfficePlatformHttpApi.runSchedule")(function* (ctx: { params: { id: string } }) {
      const result = yield* platform.runNow(ctx.params.id)
      if (!result) return yield* new HttpApiError.NotFound({})
      return result
    })

    const runWorkflow = Effect.fn("OfficePlatformHttpApi.runWorkflow")(function* (ctx: {
      params: { id: string }
      payload: typeof OfficeWorkflowRunInput.Type
    }) {
      const result = yield* platform.runWorkflow(ctx.params.id, ctx.payload.inputValues)
      if (!result) return yield* new HttpApiError.NotFound({})
      return result
    })

    const scheduleWorkflow = Effect.fn("OfficePlatformHttpApi.scheduleWorkflow")(function* (ctx: {
      params: { id: string }
      payload: typeof OfficeScheduleFromWorkflowInput.Type
    }) {
      const result = yield* platform.scheduleWorkflow(
        ctx.params.id,
        ctx.payload.trigger,
        ctx.payload.notificationUrl,
        ctx.payload.browser,
        ctx.payload.inputValues,
      )
      if (!result) return yield* new HttpApiError.NotFound({})
      return result
    })

    const listArtifacts = Effect.fn("OfficePlatformHttpApi.listArtifacts")(function* () {
      return yield* platform.listArtifacts()
    })

    const restoreArtifact = Effect.fn("OfficePlatformHttpApi.restoreArtifact")(function* (ctx: {
      params: { id: string }
      payload: { version?: number }
    }) {
      const result = yield* platform.restoreArtifact(ctx.params.id, ctx.payload.version)
      if (!result) return yield* new HttpApiError.NotFound({})
      return result
    })

    const listConnectors = Effect.fn("OfficePlatformHttpApi.listConnectors")(function* () {
      const statusMap = yield* mcp.status()
      const builtins = [
        {
          id: "browser",
          name: "浏览器自动化",
          description: "内置浏览器，可导航、抓取、填写表单、截图和诊断页面。",
          capabilities: ["browser"],
        },
        {
          id: "tencent-docs",
          name: "腾讯文档",
          description: "创建和编辑智能文档、表格、幻灯片、思维导图与流程图。",
          capabilities: ["docs", "mcp"],
        },
        {
          id: "feishu",
          name: "飞书通知",
          description: "通过群机器人 Webhook 发送消息和定时任务失败通知。",
          capabilities: ["im", "webhook"],
        },
      ] as const

      return builtins.map((item) => {
        const info = item.id === "feishu" ? undefined : statusMap[item.id]
        const configured =
          item.id === "feishu"
            ? Boolean(process.env.FEISHU_WEBHOOK_URL)
            : item.id === "tencent-docs"
              ? Boolean(process.env.TENCENT_DOCS_TOKEN)
              : Boolean(info && info.status !== "disabled")
        const status: "connected" | "failed" | "disabled" =
          item.id === "feishu"
            ? configured
              ? "connected"
              : "disabled"
            : item.id === "tencent-docs"
              ? !configured
                ? "disabled"
                : info?.status === "connected"
                  ? "connected"
                  : info?.status === "failed"
                    ? "failed"
                    : "disabled"
            : info?.status === "connected"
              ? "connected"
              : info?.status === "failed"
                ? "failed"
                : "disabled"
        return {
          id: item.id,
          provider: item.id,
          name: item.name,
          description: item.description,
          status,
          capabilities: [...item.capabilities],
          configured,
        }
      })
    })

    const getConnectorConfig = Effect.fn("OfficePlatformHttpApi.getConnectorConfig")(function* () {
      return yield* platform.getConnectorConfig()
    })

    const updateConnectorConfig = Effect.fn("OfficePlatformHttpApi.updateConnectorConfig")(function* (ctx: {
      payload: typeof OfficeConnectorConfig.Type
    }) {
      const result = yield* platform.saveConnectorConfig(ctx.payload)
      if (ctx.payload.tencentDocsToken !== undefined) {
        yield* mcp.connect("tencent-docs").pipe(Effect.ignore)
      }
      return result
    })

    const connectConnector = Effect.fn("OfficePlatformHttpApi.connectConnector")(function* (ctx: {
      params: { id: string }
    }) {
      if (ctx.params.id === "feishu") return true
      yield* mcp.connect(ctx.params.id).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return true
    })

    const disconnectConnector = Effect.fn("OfficePlatformHttpApi.disconnectConnector")(function* (ctx: {
      params: { id: string }
    }) {
      if (ctx.params.id === "feishu") return true
      yield* mcp.disconnect(ctx.params.id).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return true
    })

    const connectorAction = Effect.fn("OfficePlatformHttpApi.connectorAction")(function* (ctx: {
      params: { id: string }
      payload: typeof OfficeConnectorActionPayload.Type
    }) {
      if (ctx.params.id === "feishu" && ctx.payload.action === "send_message") {
        const webhook = process.env.FEISHU_WEBHOOK_URL
        if (!webhook) return yield* new HttpApiError.BadRequest({})
        const text = String(ctx.payload.arguments?.text ?? "")
        if (!text.trim()) return yield* new HttpApiError.BadRequest({})
        yield* Effect.tryPromise(async () => {
          const response = await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ msg_type: "text", content: { text } }),
          })
          if (!response.ok) throw new Error(`Feishu webhook failed: ${response.status}`)
        }).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
        return true
      }

      const tools = yield* mcp.tools()
      const toolID = Object.keys(tools).find(
        (key) => key === `${ctx.params.id}_${ctx.payload.action}` || key.endsWith(`_${ctx.payload.action}`),
      )
      if (!toolID) return yield* new HttpApiError.BadRequest({})
      yield* mcp
        .callTool(toolID, ctx.payload.arguments ?? {})
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return true
    })

    const browserStatus = Effect.fn("OfficePlatformHttpApi.browserStatus")(function* () {
      const statusMap = yield* mcp.status()
      const server = statusMap.browser
      const configured = Boolean(server && server.status !== "disabled")
      const active =
        server?.status === "connected"
          ? yield* mcpSnapshot()
              .pipe(Effect.as(true))
              .pipe(Effect.catch(() => Effect.succeed(false)))
          : false
      return { configured, active }
    })

    const browserStart = Effect.fn("OfficePlatformHttpApi.browserStart")(function* (ctx: {
      payload: typeof BrowserStartPayload.Type
    }) {
      const navigateToolID = yield* browserToolID("browser_navigate")
      if (ctx.payload.viewport) {
        yield* mcp
          .callTool("browser_browser_set_viewport", {
            width: ctx.payload.viewport.width,
            height: ctx.payload.viewport.height,
          })
          .pipe(Effect.ignore)
      }
      yield* mcp
        .callTool(navigateToolID, { url: ctx.payload.url })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return yield* mcpSnapshot()
    })

    const browserSnapshot = Effect.fn("OfficePlatformHttpApi.browserSnapshot")(function* () {
      return yield* mcpSnapshot()
    })

    const browserStop = Effect.fn("OfficePlatformHttpApi.browserStop")(function* () {
      const toolID = yield* browserToolID("browser_close")
      yield* mcp.callTool(toolID, {}).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return true
    })

    return handlers
      .handle("status", status)
      .handle("listSchedules", listSchedules)
      .handle("createSchedule", createSchedule)
      .handle("updateSchedule", updateSchedule)
      .handle("deleteSchedule", deleteSchedule)
      .handle("listRuns", listRuns)
      .handle("runSchedule", runSchedule)
      .handle("listWorkflows", listWorkflows)
      .handle("createWorkflow", createWorkflow)
      .handle("updateWorkflow", updateWorkflow)
      .handle("deleteWorkflow", deleteWorkflow)
      .handle("runWorkflow", runWorkflow)
      .handle("scheduleWorkflow", scheduleWorkflow)
      .handle("listArtifacts", listArtifacts)
      .handle("restoreArtifact", restoreArtifact)
      .handle("listConnectors", listConnectors)
      .handle("connectConnector", connectConnector)
      .handle("disconnectConnector", disconnectConnector)
      .handle("connectorAction", connectorAction)
      .handle("getConnectorConfig", getConnectorConfig)
      .handle("updateConnectorConfig", updateConnectorConfig)
      .handle("browserStatus", browserStatus)
      .handle("browserStart", browserStart)
      .handle("browserSnapshot", browserSnapshot)
      .handle("browserStop", browserStop)
  }),
)
