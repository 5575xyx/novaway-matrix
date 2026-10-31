import { SessionID } from "@/session/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ApiNotFoundError } from "../../errors"
import { Authorization } from "../../middleware/authorization"
import { InstanceContextMiddleware } from "../../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../../middleware/workspace-routing"
import { LocationRef, ModelRef, V2RoutingQuery } from "./shared"

// Session resources v2 clients read after opening a session: the session
// descriptor itself plus the pending permission and question requests. The v1
// surface returns these through `/session/{id}` and the global
// `/permission` + `/question` queues; v2 scopes them to a session.
//
// Kept in its own group so the existing `/api/session` list/prompt handlers do
// not have to pay for instance-context resolution on every poll.

const Tokens = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  reasoning: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite,
    write: Schema.Finite,
  }),
}).annotate({ identifier: "V2SessionTokens" })

export const SessionV2Info = Schema.Struct({
  id: Schema.String,
  parentID: Schema.optional(Schema.String),
  projectID: Schema.String,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(ModelRef),
  cost: Schema.Finite,
  tokens: Tokens,
  time: Schema.Struct({
    created: Schema.Finite,
    updated: Schema.Finite,
    archived: Schema.optional(Schema.Finite),
  }).annotate({ identifier: "V2SessionTime" }),
  title: Schema.String,
  location: LocationRef,
  subpath: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionV2Info" })

const SessionEnvelope = Schema.Struct({
  data: SessionV2Info,
}).annotate({ identifier: "V2SessionGetResponse" })

const PermissionRequest = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  save: Schema.optional(Schema.Array(Schema.String)),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  source: Schema.optional(
    Schema.Struct({
      type: Schema.Literal("tool"),
      messageID: Schema.String,
      callID: Schema.String,
    }).annotate({ identifier: "V2PermissionSource" }),
  ),
}).annotate({ identifier: "PermissionV2Request" })

const PermissionList = Schema.Struct({
  data: Schema.Array(PermissionRequest),
}).annotate({ identifier: "V2SessionPermissionListResponse" })

const QuestionInfo = Schema.Struct({
  question: Schema.String,
  header: Schema.String,
  options: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      description: Schema.String,
    }),
  ),
  multiple: Schema.optional(Schema.Boolean),
  custom: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "QuestionV2Info" })

const QuestionRequest = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  questions: Schema.Array(QuestionInfo),
  tool: Schema.optional(
    Schema.Struct({
      messageID: Schema.String,
      callID: Schema.String,
    }).annotate({ identifier: "QuestionV2Tool" }),
  ),
}).annotate({ identifier: "QuestionV2Request" })

const QuestionList = Schema.Struct({
  data: Schema.Array(QuestionRequest),
}).annotate({ identifier: "V2SessionQuestionListResponse" })

export const SessionResourceGroup = HttpApiGroup.make("v2.session-resource")
  .add(
    HttpApiEndpoint.get("get", "/api/session/:sessionID", {
      params: { sessionID: SessionID },
      query: V2RoutingQuery,
      success: SessionEnvelope,
      error: ApiNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.get",
        summary: "Get v2 session",
        description: "Retrieve a single v2 session descriptor for the requested location.",
      }),
    ),
    HttpApiEndpoint.get("permissions", "/api/session/:sessionID/permission", {
      params: { sessionID: SessionID },
      query: V2RoutingQuery,
      success: PermissionList,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.permission.list",
        summary: "List session permission requests",
        description: "Retrieve permission requests currently waiting on the user for this session.",
      }),
    ),
    HttpApiEndpoint.get("questions", "/api/session/:sessionID/question", {
      params: { sessionID: SessionID },
      query: V2RoutingQuery,
      success: QuestionList,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.question.list",
        summary: "List session questions",
        description: "Retrieve questions currently waiting on the user for this session.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2 session resources",
      description: "Experimental v2 session descriptor and pending-request routes.",
    }),
  )
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)
