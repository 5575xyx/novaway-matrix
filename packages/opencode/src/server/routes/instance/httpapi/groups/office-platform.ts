import { PositiveInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"

const root = "/office/platform"

export const OfficeScheduleTrigger = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("interval"),
    minutes: PositiveInt,
  }),
  Schema.Struct({
    type: Schema.Literal("daily"),
    time: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("weekly"),
    dayOfWeek: PositiveInt,
    time: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("monthly"),
    dayOfMonth: PositiveInt,
    time: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("days"),
    everyDays: PositiveInt,
    time: Schema.String,
  }),
])

export const OfficeBrowserRequest = Schema.Struct({
  enabled: Schema.Boolean,
  url: Schema.optional(Schema.String),
})

export const OfficeScheduleInput = Schema.Struct({
  title: Schema.String,
  scene: Schema.String,
  prompt: Schema.String,
  connectors: Schema.optional(Schema.Array(Schema.String)),
  browser: Schema.optional(OfficeBrowserRequest),
  notificationUrl: Schema.optional(Schema.String),
  inputValues: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  trigger: OfficeScheduleTrigger,
})

export const OfficeSchedule = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  scene: Schema.String,
  prompt: Schema.String,
  connectors: Schema.Array(Schema.String),
  browser: OfficeBrowserRequest,
  notificationUrl: Schema.optional(Schema.String),
  inputValues: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  trigger: OfficeScheduleTrigger,
  status: Schema.Literals(["active", "paused"]),
  nextRunAt: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export const OfficeScheduleUpdate = Schema.Struct({
  title: Schema.optional(Schema.String),
  scene: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  connectors: Schema.optional(Schema.Array(Schema.String)),
  browser: Schema.optional(OfficeBrowserRequest),
  notificationUrl: Schema.optional(Schema.String),
  inputValues: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  trigger: Schema.optional(OfficeScheduleTrigger),
  status: Schema.optional(Schema.Literals(["active", "paused"])),
})

export const OfficeRun = Schema.Struct({
  id: Schema.String,
  scheduleId: Schema.optional(Schema.String),
  workflowId: Schema.optional(Schema.String),
  status: Schema.Literals(["running", "completed", "error"]),
  startedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  logs: Schema.Array(Schema.String),
})

export const OfficeRuntimeDiagnostic = Schema.Struct({
  browser: Schema.Literals(["configured", "connected", "failed"]),
  tencentDocs: Schema.Literals(["configured", "missing"]),
  feishu: Schema.Literals(["configured", "missing"]),
})

export const OfficePlatformStatus = Schema.Struct({
  schedulerEnabled: Schema.Literal(true),
  scheduleCount: Schema.Number,
  activeScheduleCount: Schema.Number,
  browserConfigured: Schema.Boolean,
  diagnostics: OfficeRuntimeDiagnostic,
})

export const OfficeWorkflowInput = Schema.Struct({
  title: Schema.String,
  scene: Schema.String,
  prompt: Schema.String,
  connectors: Schema.optional(Schema.Array(Schema.String)),
  browser: Schema.optional(OfficeBrowserRequest),
  notificationUrl: Schema.optional(Schema.String),
  sourceSessionId: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
})

export const OfficeWorkflow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  scene: Schema.String,
  prompt: Schema.String,
  connectors: Schema.Array(Schema.String),
  browser: OfficeBrowserRequest,
  notificationUrl: Schema.optional(Schema.String),
  sourceSessionId: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
  version: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export const OfficeWorkflowUpdate = Schema.Struct({
  title: Schema.optional(Schema.String),
  scene: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  connectors: Schema.optional(Schema.Array(Schema.String)),
  browser: Schema.optional(OfficeBrowserRequest),
  notificationUrl: Schema.optional(Schema.String),
  sourceSessionId: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
})

export const OfficeScheduleFromWorkflowInput = Schema.Struct({
  trigger: OfficeScheduleTrigger,
  notificationUrl: Schema.optional(Schema.String),
  browser: Schema.optional(OfficeBrowserRequest),
  inputValues: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

export const OfficeWorkflowRunInput = Schema.Struct({
  inputValues: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

export const OfficeArtifactKind = Schema.Literals([
  "document",
  "ppt",
  "data",
  "design",
  "web",
  "knowledge",
  "meeting",
  "task",
  "communication",
])

export const OfficeArtifact = Schema.Struct({
  id: Schema.String,
  kind: OfficeArtifactKind,
  name: Schema.String,
  filename: Schema.String,
  path: Schema.String,
  workflowId: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
  version: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export const OfficeConnector = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  name: Schema.String,
  description: Schema.String,
  status: Schema.Literals(["connected", "failed", "disabled"]),
  capabilities: Schema.Array(Schema.String),
  configured: Schema.Boolean,
})

export const OfficeConnectorActionPayload = Schema.Struct({
  action: Schema.String,
  arguments: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

export const OfficeConnectorConfig = Schema.Struct({
  feishuWebhookUrl: Schema.optional(Schema.String),
  feishuKeyword: Schema.optional(Schema.String),
  feishuAppId: Schema.optional(Schema.String),
  feishuAppSecret: Schema.optional(Schema.String),
  feishuUserId: Schema.optional(Schema.String),
  tencentDocsToken: Schema.optional(Schema.String),
})

export const BrowserStartPayload = Schema.Struct({
  url: Schema.String,
  viewport: Schema.optional(
    Schema.Struct({
      width: Schema.Number,
      height: Schema.Number,
    }),
  ),
})

export const BrowserSnapshot = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  text: Schema.String,
  bodyText: Schema.String,
  refs: Schema.Array(
    Schema.Struct({
      ref: Schema.String,
      role: Schema.String,
      name: Schema.String,
      tag: Schema.String,
    }),
  ),
  overflow: Schema.Boolean,
  focusVisible: Schema.Boolean,
})

export const BrowserStatus = Schema.Struct({
  configured: Schema.Boolean,
  active: Schema.Boolean,
})

export const OfficePlatformPaths = {
  status: root,
  schedules: `${root}/schedules`,
  schedule: `${root}/schedules/:id`,
  run: `${root}/schedules/:id/run`,
  runs: `${root}/runs`,
  workflows: `${root}/workflows`,
  workflow: `${root}/workflows/:id`,
  workflowRun: `${root}/workflows/:id/run`,
  workflowSchedule: `${root}/workflows/:id/schedule`,
  artifacts: `${root}/artifacts`,
  artifactRestore: `${root}/artifacts/:id/restore`,
  connectors: `${root}/connectors`,
  connectorConnect: `${root}/connectors/:id/connect`,
  connectorDisconnect: `${root}/connectors/:id/disconnect`,
  connectorAction: `${root}/connectors/:id/action`,
  connectorConfig: `${root}/connectors/config`,
  browser: `${root}/browser`,
  browserStart: `${root}/browser/start`,
  browserSnapshot: `${root}/browser/snapshot`,
  browserStop: `${root}/browser/stop`,
} as const

export const OfficePlatformApi = HttpApi.make("office-platform").add(
  HttpApiGroup.make("office-platform")
    .add(
      HttpApiEndpoint.get("status", OfficePlatformPaths.status, {
        query: WorkspaceRoutingQuery,
        success: described(OfficePlatformStatus, "Office platform status"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.status",
          summary: "Get office platform status",
          description: "Get scheduler, browser, and office platform capability status.",
        }),
      ),
      HttpApiEndpoint.get("listSchedules", OfficePlatformPaths.schedules, {
        query: WorkspaceRoutingQuery,
        success: described(Schema.Array(OfficeSchedule), "Office schedules"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.schedule.list",
          summary: "List office schedules",
          description: "List persisted office automation schedules.",
        }),
      ),
      HttpApiEndpoint.post("createSchedule", OfficePlatformPaths.schedules, {
        query: WorkspaceRoutingQuery,
        payload: OfficeScheduleInput,
        success: described(OfficeSchedule, "Created office schedule"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.schedule.create",
          summary: "Create office schedule",
          description: "Create a persisted office automation schedule.",
        }),
      ),
      HttpApiEndpoint.patch("updateSchedule", OfficePlatformPaths.schedule, {
        params: { id: Schema.String },
        query: WorkspaceRoutingQuery,
        payload: OfficeScheduleUpdate,
        success: described(OfficeSchedule, "Updated office schedule"),
        error: [HttpApiError.BadRequest, HttpApiError.NotFound],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.schedule.update",
          summary: "Update office schedule",
          description: "Update a persisted office automation schedule.",
        }),
      ),
      HttpApiEndpoint.delete("deleteSchedule", OfficePlatformPaths.schedule, {
        params: { id: Schema.String },
        query: WorkspaceRoutingQuery,
        success: described(Schema.Boolean, "Office schedule deleted"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.schedule.delete",
          summary: "Delete office schedule",
          description: "Delete a persisted office automation schedule.",
        }),
      ),
      HttpApiEndpoint.post("runSchedule", OfficePlatformPaths.run, {
        params: { id: Schema.String },
        query: WorkspaceRoutingQuery,
        success: described(OfficeRun, "Office run"),
        error: [HttpApiError.BadRequest, HttpApiError.NotFound],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.schedule.run",
          summary: "Run office schedule now",
          description: "Run a persisted office automation schedule immediately.",
        }),
      ),
      HttpApiEndpoint.get("listRuns", OfficePlatformPaths.runs, {
        query: WorkspaceRoutingQuery,
        success: described(Schema.Array(OfficeRun), "Office runs"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.run.list",
          summary: "List office runs",
          description: "List office automation run history.",
        }),
      ),
      HttpApiEndpoint.get("listWorkflows", OfficePlatformPaths.workflows, {
        query: WorkspaceRoutingQuery,
        success: described(Schema.Array(OfficeWorkflow), "Office workflows"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.workflow.list",
          summary: "List office workflows",
          description: "List reusable office automation workflows.",
        }),
      ),
      HttpApiEndpoint.post("createWorkflow", OfficePlatformPaths.workflows, {
        query: WorkspaceRoutingQuery,
        payload: OfficeWorkflowInput,
        success: described(OfficeWorkflow, "Created office workflow"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.workflow.create",
          summary: "Create office workflow",
          description: "Create a reusable office automation workflow.",
        }),
      ),
      HttpApiEndpoint.patch("updateWorkflow", OfficePlatformPaths.workflow, {
        params: { id: Schema.String },
        query: WorkspaceRoutingQuery,
        payload: OfficeWorkflowUpdate,
        success: described(OfficeWorkflow, "Updated office workflow"),
        error: [HttpApiError.BadRequest, HttpApiError.NotFound],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.workflow.update",
          summary: "Update office workflow",
          description: "Update a reusable office automation workflow.",
        }),
      ),
      HttpApiEndpoint.delete("deleteWorkflow", OfficePlatformPaths.workflow, {
        params: { id: Schema.String },
        query: WorkspaceRoutingQuery,
        success: described(Schema.Boolean, "Office workflow deleted"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.workflow.delete",
          summary: "Delete office workflow",
          description: "Delete a reusable office automation workflow.",
        }),
      ),
      HttpApiEndpoint.post("runWorkflow", OfficePlatformPaths.workflowRun, {
        params: { id: Schema.String },
        query: WorkspaceRoutingQuery,
        payload: OfficeWorkflowRunInput,
        success: described(OfficeRun, "Office workflow run"),
        error: [HttpApiError.BadRequest, HttpApiError.NotFound],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.workflow.run",
          summary: "Run office workflow now",
          description: "Run a reusable office workflow immediately.",
        }),
      ),
      HttpApiEndpoint.post("scheduleWorkflow", OfficePlatformPaths.workflowSchedule, {
        params: { id: Schema.String },
        query: WorkspaceRoutingQuery,
        payload: OfficeScheduleFromWorkflowInput,
        success: described(OfficeSchedule, "Office schedule created from workflow"),
        error: [HttpApiError.BadRequest, HttpApiError.NotFound],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.workflow.schedule",
          summary: "Schedule office workflow",
          description: "Create a persisted schedule from a reusable office workflow.",
        }),
      ),
      HttpApiEndpoint.get("listArtifacts", OfficePlatformPaths.artifacts, {
        query: WorkspaceRoutingQuery,
        success: described(Schema.Array(OfficeArtifact), "Office artifact versions"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.artifact.list",
          summary: "List office artifact versions",
          description: "List versioned office artifacts produced by office workflows and saves.",
        }),
      ),
      HttpApiEndpoint.post("restoreArtifact", OfficePlatformPaths.artifactRestore, {
        params: { id: Schema.String },
        query: WorkspaceRoutingQuery,
        payload: Schema.Struct({ version: Schema.optional(PositiveInt) }),
        success: described(OfficeArtifact, "Office artifact restored"),
        error: [HttpApiError.BadRequest, HttpApiError.NotFound],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.artifact.restore",
          summary: "Restore office artifact version",
          description: "Restore an office artifact version back into the workspace.",
        }),
      ),
      HttpApiEndpoint.get("listConnectors", OfficePlatformPaths.connectors, {
        query: WorkspaceRoutingQuery,
        success: described(Schema.Array(OfficeConnector), "Office connectors"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.connector.list",
          summary: "List office connectors",
          description: "List available office connectors backed by MCP servers.",
        }),
      ),
      HttpApiEndpoint.post("connectConnector", OfficePlatformPaths.connectorConnect, {
        params: { id: Schema.String },
        query: WorkspaceRoutingQuery,
        success: described(Schema.Boolean, "Office connector connected"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.connector.connect",
          summary: "Connect office connector",
          description: "Connect a connector backed by an MCP server.",
        }),
      ),
      HttpApiEndpoint.post("disconnectConnector", OfficePlatformPaths.connectorDisconnect, {
        params: { id: Schema.String },
        query: WorkspaceRoutingQuery,
        success: described(Schema.Boolean, "Office connector disconnected"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.connector.disconnect",
          summary: "Disconnect office connector",
          description: "Disconnect a connector backed by an MCP server.",
        }),
      ),
      HttpApiEndpoint.post("connectorAction", OfficePlatformPaths.connectorAction, {
        params: { id: Schema.String },
        query: WorkspaceRoutingQuery,
        payload: OfficeConnectorActionPayload,
        success: described(Schema.Boolean, "Office connector action completed"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.connector.action",
          summary: "Run office connector action",
          description: "Run a connector action backed by a webhook or MCP tool.",
        }),
      ),
      HttpApiEndpoint.get("getConnectorConfig", OfficePlatformPaths.connectorConfig, {
        query: WorkspaceRoutingQuery,
        success: described(OfficeConnectorConfig, "Office connector config"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.connector.config.get",
          summary: "Get office connector config",
          description: "Get page-configured connector credentials for Tencent Docs and Feishu.",
        }),
      ),
      HttpApiEndpoint.put("updateConnectorConfig", OfficePlatformPaths.connectorConfig, {
        query: WorkspaceRoutingQuery,
        payload: OfficeConnectorConfig,
        success: described(OfficeConnectorConfig, "Updated office connector config"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.connector.config.update",
          summary: "Update office connector config",
          description: "Persist page-configured connector credentials for Tencent Docs and Feishu.",
        }),
      ),
      HttpApiEndpoint.get("browserStatus", OfficePlatformPaths.browser, {
        query: WorkspaceRoutingQuery,
        success: described(BrowserStatus, "Office browser status"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.browser.status",
          summary: "Get office browser status",
          description: "Get whether office browser automation is configured and active.",
        }),
      ),
      HttpApiEndpoint.post("browserStart", OfficePlatformPaths.browserStart, {
        query: WorkspaceRoutingQuery,
        payload: BrowserStartPayload,
        success: described(BrowserSnapshot, "Office browser started"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.browser.start",
          summary: "Start office browser session",
          description: "Navigate an office browser session and return the first snapshot.",
        }),
      ),
      HttpApiEndpoint.post("browserSnapshot", OfficePlatformPaths.browserSnapshot, {
        query: WorkspaceRoutingQuery,
        success: described(BrowserSnapshot, "Office browser snapshot"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.browser.snapshot",
          summary: "Snapshot office browser session",
          description: "Return the current office browser page snapshot.",
        }),
      ),
      HttpApiEndpoint.post("browserStop", OfficePlatformPaths.browserStop, {
        query: WorkspaceRoutingQuery,
        success: described(Schema.Boolean, "Office browser stopped"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.platform.browser.stop",
          summary: "Stop office browser session",
          description: "Close the current office browser session.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "office-platform", description: "Office platform capability routes." }))
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)

export * as OfficePlatformGroup from "./office-platform"
