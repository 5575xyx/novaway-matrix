import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"

const root = "/office"
const OfficeArtifactKind = Schema.Literals(["document", "ppt", "meeting", "knowledge", "task", "communication"])

export const OfficeArtifactPayload = Schema.Struct({
  kind: OfficeArtifactKind,
  filename: Schema.String,
  mime: Schema.String,
  contentBase64: Schema.String,
})

export const OfficeArtifact = Schema.Struct({
  kind: OfficeArtifactKind,
  path: Schema.String,
  filename: Schema.String,
  bytes: Schema.Number,
  modified: Schema.Number,
})

export const OfficeArtifactSaveResponse = Schema.Struct({
  path: Schema.String,
  bytes: Schema.Number,
})

export const OfficePptxTemplateFillPayload = Schema.Struct({
  filename: Schema.String,
  templateBase64: Schema.String,
  slides: Schema.Array(
    Schema.Struct({
      slide: Schema.Number,
      texts: Schema.Array(Schema.String),
      images: Schema.optional(
        Schema.Array(
          Schema.Struct({
            mime: Schema.String,
            dataBase64: Schema.String,
          }),
        ),
      ),
      tables: Schema.optional(Schema.Array(Schema.Array(Schema.Array(Schema.String)))),
      charts: Schema.optional(
        Schema.Array(
          Schema.Struct({
            categories: Schema.Array(Schema.String),
            series: Schema.Array(
              Schema.Struct({
                name: Schema.String,
                values: Schema.Array(Schema.Number),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
})

export const OfficePaths = {
  artifact: `${root}/artifact`,
  pptxTemplateFill: `${root}/pptx-template-fill`,
} as const

export const OfficeApi = HttpApi.make("office").add(
  HttpApiGroup.make("office")
    .add(
      HttpApiEndpoint.get("listArtifacts", OfficePaths.artifact, {
        query: WorkspaceRoutingQuery,
        success: described(Schema.Array(OfficeArtifact), "Office artifacts"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.artifact.list",
          summary: "List office artifacts",
          description: "List generated Office documents saved in the current workspace's .novaway office folder.",
        }),
      ),
      HttpApiEndpoint.post("saveArtifact", OfficePaths.artifact, {
        query: WorkspaceRoutingQuery,
        payload: OfficeArtifactPayload,
        success: described(OfficeArtifactSaveResponse, "Saved office artifact"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.artifact.save",
          summary: "Save office artifact",
          description: "Save generated Office documents into the current workspace's .novaway office folder.",
        }),
      ),
      HttpApiEndpoint.post("fillPptxTemplate", OfficePaths.pptxTemplateFill, {
        query: WorkspaceRoutingQuery,
        payload: OfficePptxTemplateFillPayload,
        success: described(OfficeArtifactSaveResponse, "Filled PPTX template artifact"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.pptxTemplate.fill",
          summary: "Fill PPTX template",
          description: "Fill a native PPTX template by replacing slide text runs and save the generated deck into the workspace office folder.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "office", description: "Office mode artifact routes." }))
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)

export * as OfficeGroup from "./office"
