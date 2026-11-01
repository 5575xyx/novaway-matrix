import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"

const root = "/office"
const OfficeArtifactKind = Schema.Literals([
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
  version: Schema.Number,
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

/**
 * PPTX 原地编辑：文字、格式、几何、图片替换，全部只重写被点中的那个块。
 * 这是「改一个字就改一个 shape」的落点 —— UI 的画布编辑和 Agent 的
 * office_pptx_edit 工具都走这一条。
 */
export const OfficePptxStyle = Schema.Struct({
  bold: Schema.optional(Schema.Boolean),
  italic: Schema.optional(Schema.Boolean),
  underline: Schema.optional(Schema.Boolean),
  size: Schema.optional(Schema.Number),
  color: Schema.optional(Schema.String),
  align: Schema.optional(Schema.Literals(["l", "ctr", "r", "just"])),
  font: Schema.optional(Schema.String),
})

export const OfficePptxEditPayload = Schema.Struct({
  /** 工作区相对路径，可以是任意位置的 .pptx */
  path: Schema.String,
  /** 文字/格式：text 省略表示只改样式 */
  edits: Schema.optional(
    Schema.Array(
      Schema.Struct({
        slide: Schema.Number,
        shapeId: Schema.optional(Schema.String),
        shapeName: Schema.optional(Schema.String),
        paragraph: Schema.optional(Schema.Number),
        text: Schema.optional(Schema.String),
        style: Schema.optional(OfficePptxStyle),
        cell: Schema.optional(Schema.Struct({ row: Schema.Number, col: Schema.Number })),
      }),
    ),
  ),
  /** 几何：位置/尺寸（EMU）+ 旋转（度） */
  shapes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        slide: Schema.Number,
        shapeId: Schema.optional(Schema.String),
        shapeName: Schema.optional(Schema.String),
        box: Schema.optional(
          Schema.Struct({ x: Schema.Number, y: Schema.Number, w: Schema.Number, h: Schema.Number }),
        ),
        rotation: Schema.optional(Schema.Number),
      }),
    ),
  ),
  /** 图片替换：新图片以 base64 传入，会作为新媒体条目进包 */
  images: Schema.optional(
    Schema.Array(
      Schema.Struct({
        slide: Schema.Number,
        shapeId: Schema.optional(Schema.String),
        shapeName: Schema.optional(Schema.String),
        dataBase64: Schema.String,
        mime: Schema.String,
      }),
    ),
  ),
})

export const OfficePptxEditResponse = Schema.Struct({
  path: Schema.String,
  bytes: Schema.Number,
  changed: Schema.Array(Schema.String),
  applied: Schema.Array(
    Schema.Struct({
      slide: Schema.Number,
      shapeId: Schema.String,
      shapeName: Schema.optional(Schema.String),
      paragraph: Schema.Number,
      previous: Schema.String,
      text: Schema.String,
      cell: Schema.optional(Schema.Struct({ row: Schema.Number, col: Schema.Number })),
    }),
  ),
  shapes: Schema.Array(
    Schema.Struct({
      slide: Schema.Number,
      shapeId: Schema.String,
      shapeName: Schema.optional(Schema.String),
      box: Schema.optional(Schema.Struct({ x: Schema.Number, y: Schema.Number, w: Schema.Number, h: Schema.Number })),
      rotation: Schema.optional(Schema.Number),
    }),
  ),
  images: Schema.Array(
    Schema.Struct({
      slide: Schema.Number,
      shapeId: Schema.String,
      shapeName: Schema.optional(Schema.String),
      mediaPath: Schema.String,
      rId: Schema.String,
    }),
  ),
})

export const OfficePaths = {
  artifact: `${root}/artifact`,
  pptxTemplateFill: `${root}/pptx-template-fill`,
  pptxEdit: `${root}/pptx-edit`,
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
          description:
            "Fill a native PPTX template by replacing slide text runs and save the generated deck into the workspace office folder.",
        }),
      ),
      HttpApiEndpoint.post("editPptxText", OfficePaths.pptxEdit, {
        query: WorkspaceRoutingQuery,
        payload: OfficePptxEditPayload,
        success: described(OfficePptxEditResponse, "Edited PPTX"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.pptx.edit",
          summary: "Edit PPTX slide text",
          description:
            "Rewrite the text of specific shapes inside an existing PPTX. Only the touched slide XML is re-encoded; every other zip entry is copied byte-for-byte, so layouts, media and animations stay intact.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "office", description: "Office mode artifact routes." }))
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)

export * as OfficeGroup from "./office"
