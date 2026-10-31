import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../../middleware/authorization"
import { InstanceContextMiddleware } from "../../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../../middleware/workspace-routing"
import { LocationInfo, ModelRef, PermissionRule, V2RoutingQuery } from "./shared"

// v2 catalog routes: per-location lists of agents, commands, skills, references
// and integrations. The kernel already exposes these through the v1 `instance`
// group, but v2 clients expect the `{ location, data }` envelope and the v2
// field names. Keeping both lets Web (v1) and TUI (v2) share one server.

const RequestEnvelope = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ identifier: "V2RequestEnvelope" })

export const AgentV2Info = Schema.Struct({
  id: Schema.String,
  model: Schema.optional(ModelRef),
  request: RequestEnvelope,
  system: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  hidden: Schema.Boolean,
  color: Schema.optional(Schema.String),
  steps: Schema.optional(Schema.Finite),
  permissions: Schema.Array(PermissionRule),
}).annotate({ identifier: "AgentV2Info" })

export const CommandV2Info = Schema.Struct({
  name: Schema.String,
  template: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(ModelRef),
  subtask: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "CommandV2Info" })

export const SkillV2Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  slash: Schema.optional(Schema.Boolean),
  location: Schema.String,
  content: Schema.String,
}).annotate({ identifier: "SkillV2Info" })

const ReferenceLocalSource = Schema.Struct({
  type: Schema.Literal("local"),
  path: Schema.String,
  description: Schema.optional(Schema.String),
  hidden: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "ReferenceLocalSource" })

const ReferenceGitSource = Schema.Struct({
  type: Schema.Literal("git"),
  repository: Schema.String,
  branch: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  hidden: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "ReferenceGitSource" })

export const ReferenceInfo = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  description: Schema.optional(Schema.String),
  hidden: Schema.optional(Schema.Boolean),
  source: Schema.Union([ReferenceLocalSource, ReferenceGitSource]),
}).annotate({ identifier: "ReferenceInfo" })

export const IntegrationInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  methods: Schema.Array(Schema.Unknown),
  connections: Schema.Array(Schema.Unknown),
}).annotate({ identifier: "IntegrationInfo" })

const AgentList = Schema.Struct({
  location: LocationInfo,
  data: Schema.Array(AgentV2Info),
}).annotate({ identifier: "V2AgentListResponse" })

const CommandList = Schema.Struct({
  location: LocationInfo,
  data: Schema.Array(CommandV2Info),
}).annotate({ identifier: "V2CommandListResponse" })

const SkillList = Schema.Struct({
  location: LocationInfo,
  data: Schema.Array(SkillV2Info),
}).annotate({ identifier: "V2SkillListResponse" })

const ReferenceList = Schema.Struct({
  location: LocationInfo,
  data: Schema.Array(ReferenceInfo),
}).annotate({ identifier: "V2ReferenceListResponse" })

const IntegrationList = Schema.Struct({
  location: LocationInfo,
  data: Schema.Array(IntegrationInfo),
}).annotate({ identifier: "V2IntegrationListResponse" })

export const AgentGroup = HttpApiGroup.make("v2.agent")
  .add(
    HttpApiEndpoint.get("list", "/api/agent", {
      query: V2RoutingQuery,
      success: AgentList,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.agent.list",
        summary: "List v2 agents",
        description: "Retrieve the agents available at the requested location.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "v2 agents", description: "Experimental v2 agent routes." }))
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)

export const CommandGroup = HttpApiGroup.make("v2.command")
  .add(
    HttpApiEndpoint.get("list", "/api/command", {
      query: V2RoutingQuery,
      success: CommandList,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.command.list",
        summary: "List v2 commands",
        description: "Retrieve slash commands available at the requested location.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "v2 commands", description: "Experimental v2 command routes." }))
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)

export const SkillGroup = HttpApiGroup.make("v2.skill")
  .add(
    HttpApiEndpoint.get("list", "/api/skill", {
      query: V2RoutingQuery,
      success: SkillList,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.skill.list",
        summary: "List v2 skills",
        description: "Retrieve skills available at the requested location.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "v2 skills", description: "Experimental v2 skill routes." }))
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)

export const ReferenceGroup = HttpApiGroup.make("v2.reference")
  .add(
    HttpApiEndpoint.get("list", "/api/reference", {
      query: V2RoutingQuery,
      success: ReferenceList,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.reference.list",
        summary: "List v2 references",
        description: "Retrieve configured @-mention references for the requested location.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "v2 references", description: "Experimental v2 reference routes." }))
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)

export const IntegrationGroup = HttpApiGroup.make("v2.integration")
  .add(
    HttpApiEndpoint.get("list", "/api/integration", {
      query: V2RoutingQuery,
      success: IntegrationList,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.integration.list",
        summary: "List v2 integrations",
        description:
          "Retrieve integrations available at the requested location. The kernel has no integration registry yet, so this currently returns an empty list.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "v2 integrations", description: "Experimental v2 integration routes." }))
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)
