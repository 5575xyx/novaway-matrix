import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { DocumentOp } from "@/office/ops-schema"

const root = "/office"

/** Office 面板需要把格式、路径和引擎失败原因传回调用方，不能只返回内置 BadRequest 的 _tag。 */
export class OfficeError extends Schema.ErrorClass<OfficeError>("OfficeError")(
  {
    name: Schema.Literal("OfficeError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}

export const officeError = (message: string) => new OfficeError({ name: "OfficeError", data: { message } })

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
        box: Schema.optional(Schema.Struct({ x: Schema.Number, y: Schema.Number, w: Schema.Number, h: Schema.Number })),
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
  /** 结构操作：新增文本框 / 删除形状。 */
  structure: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          op: Schema.Literal("addTextBox"),
          slide: Schema.Number,
          text: Schema.String,
          box: Schema.optional(
            Schema.Struct({ x: Schema.Number, y: Schema.Number, w: Schema.Number, h: Schema.Number }),
          ),
          style: Schema.optional(OfficePptxStyle),
        }),
        Schema.Struct({
          op: Schema.Literal("addShape"),
          slide: Schema.Number,
          kind: Schema.Literals(["rect", "roundRect", "ellipse", "triangle", "diamond", "rightArrow", "line", "star5"]),
          box: Schema.optional(
            Schema.Struct({ x: Schema.Number, y: Schema.Number, w: Schema.Number, h: Schema.Number }),
          ),
          fill: Schema.optional(Schema.String),
          line: Schema.optional(Schema.String),
          text: Schema.optional(Schema.String),
          style: Schema.optional(OfficePptxStyle),
        }),
        Schema.Struct({
          op: Schema.Literal("addPicture"),
          slide: Schema.Number,
          dataBase64: Schema.String,
          mime: Schema.String,
          box: Schema.optional(
            Schema.Struct({ x: Schema.Number, y: Schema.Number, w: Schema.Number, h: Schema.Number }),
          ),
        }),
        Schema.Struct({
          op: Schema.Literal("deleteShape"),
          slide: Schema.Number,
          shapeId: Schema.optional(Schema.String),
          shapeName: Schema.optional(Schema.String),
        }),
      ]),
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

/**
 * 通用文档编辑：DOCX 段落、富文本块、纯文本行命令都走这一条。
 * 和 PPTX 专用路由并存 —— PPTX 的几何/图片操作语义更细，需要单独的参数。
 */
export const OfficeDocumentEditPayload = Schema.Struct({
  path: Schema.String,
  ops: Schema.Array(DocumentOp),
  /** 加密 PDF 的密码（用户密码或所有者密码）。 */
  password: Schema.optional(Schema.String),
})

export const OfficeDocumentEditResponse = Schema.Struct({
  path: Schema.String,
  bytes: Schema.Number,
  changed: Schema.Array(Schema.String),
  applied: Schema.Number,
  /** 宿主撤销栈的状态：面板据此决定「撤销 / 重做」是否可点。 */
  canUndo: Schema.Boolean,
  canRedo: Schema.Boolean,
  undoLabel: Schema.optional(Schema.String),
  redoLabel: Schema.optional(Schema.String),
})

/** 撤销 / 重做只按路径定位，用的是宿主缓存的历史（人和 AI 共用一条）。 */
/**
 * 整字节写回：浏览器内 Office 编辑器（DOCX / XLSX / PPTX / PDF）保存时，
 * 把编辑器算好的完整字节一次性写回原文件。
 *
 * 这是 op 级 `editDocument` 之外的「整包保存」通道 —— 浏览器内编辑器不按
 * 段落/单元格发 op，而是保存出整个文件的 bytes。服务端用 recordDocumentWrite
 * 接进宿主撤销栈 + 原子写回 + watcher 广播，和 PPTX 画布编辑同一条路，
 * 避免创建第二套写盘逻辑。
 */
export const OfficeDocumentSavePayload = Schema.Struct({
  path: Schema.String,
  /** 编辑器保存出的完整文件字节，base64 编码。 */
  contentBase64: Schema.String,
  /** 加密 PDF 的密码（用户密码或所有者密码）。 */
  password: Schema.optional(Schema.String),
  /** 编辑器确认写入时观察到的磁盘版本；服务端保存前做 SHA-256 CAS 校验。 */
  expectedBaselineSha256: Schema.optional(Schema.String),
})

export const OfficeDocumentSaveResponse = Schema.Struct({
  path: Schema.String,
  bytes: Schema.Number,
  /** 宿主撤销栈的状态：保存后面板据此决定「撤销 / 重做」是否可点。 */
  canUndo: Schema.Boolean,
  canRedo: Schema.Boolean,
  undoLabel: Schema.optional(Schema.String),
  redoLabel: Schema.optional(Schema.String),
})

export const OfficeDocumentHistoryPayload = Schema.Struct({
  path: Schema.String,
})

export const OfficeDocumentHistoryQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const OfficeDocumentHistoryResponse = Schema.Struct({
  path: Schema.String,
  bytes: Schema.Number,
  canUndo: Schema.Boolean,
  canRedo: Schema.Boolean,
  undoLabel: Schema.optional(Schema.String),
  redoLabel: Schema.optional(Schema.String),
})

/** 导出：只读，返回文本内容给前端下载 / 给 Agent 落盘。 */
export const OfficeDocumentExportPayload = Schema.Struct({
  path: Schema.String,
  /** csv / tsv / html / md / txt / docx / xlsx / pptx / png */
  target: Schema.String,
  /** 加密 PDF 的密码（用户密码或所有者密码）。 */
  password: Schema.optional(Schema.String),
  /** PNG 目标时的页码（1 起，默认第 1 页）。 */
  page: Schema.optional(Schema.Number),
  /** PNG 目标的位图缩放（1 = 72 dpi，默认 2）。 */
  scale: Schema.optional(Schema.Number),
})

export const OfficeDocumentCreatePayload = Schema.Struct({
  path: Schema.String,
  /** 标题：写进正文 / 第一张幻灯片；不传就用文件名。 */
  title: Schema.optional(Schema.String),
  /** 初始正文：Markdown 风格的空行分段，生成对应的段落 / 幻灯片行。 */
  body: Schema.optional(Schema.String),
})

export const OfficeDocumentCreateResponse = Schema.Struct({
  path: Schema.String,
  kind: Schema.String,
  bytes: Schema.Number,
})

export const OfficeDocumentExportResponse = Schema.Struct({
  path: Schema.String,
  target: Schema.String,
  mime: Schema.String,
  /** 文本目标是 UTF-8 字符串；docx/xlsx/pptx 是 base64。 */
  content: Schema.String,
  /** content 的编码，旧客户端可以忽略。 */
  encoding: Schema.optional(Schema.Union([Schema.Literal("utf8"), Schema.Literal("base64")])),
  bytes: Schema.Number,
})

export const OfficeDocumentStateResponse = Schema.Struct({
  path: Schema.String,
  canUndo: Schema.Boolean,
  canRedo: Schema.Boolean,
  undoLabel: Schema.optional(Schema.String),
  redoLabel: Schema.optional(Schema.String),
})

export const OfficePaths = {
  artifact: `${root}/artifact`,
  pptxTemplateFill: `${root}/pptx-template-fill`,
  pptxEdit: `${root}/pptx-edit`,
  documentCreate: `${root}/document-create`,
  documentEdit: `${root}/document-edit`,
  documentSave: `${root}/document-save`,
  documentUndo: `${root}/document-undo`,
  documentRedo: `${root}/document-redo`,
  documentState: `${root}/document-state`,
  documentExport: `${root}/document-export`,
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
      HttpApiEndpoint.post("createDocument", OfficePaths.documentCreate, {
        query: WorkspaceRoutingQuery,
        payload: OfficeDocumentCreatePayload,
        success: described(OfficeDocumentCreateResponse, "Created document"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.document.create",
          summary: "Create an Office document",
          description:
            "Create a native DOCX / XLSX / PPTX file from a title and optional body, using the same writers as the CLI and Agent tools. Refuses to overwrite an existing path.",
        }),
      ),
      HttpApiEndpoint.post("editDocument", OfficePaths.documentEdit, {
        query: WorkspaceRoutingQuery,
        payload: OfficeDocumentEditPayload,
        success: described(OfficeDocumentEditResponse, "Edited document"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.document.edit",
          summary: "Edit a document by node",
          description:
            "Apply node-level operations to a DOCX / HTML / Markdown / plain-text file. Editing is surgical: only the touched paragraph or XML part is rewritten; untouched bytes are preserved. Human UI and Agent tools share the same operation vocabulary.",
        }),
      ),
      HttpApiEndpoint.post("saveDocument", OfficePaths.documentSave, {
        query: WorkspaceRoutingQuery,
        payload: OfficeDocumentSavePayload,
        success: described(OfficeDocumentSaveResponse, "Saved document bytes"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.document.save",
          summary: "Save whole document bytes back to the file",
          description:
            "Write the editor-produced bytes of a DOCX / XLSX / PPTX / PDF back to the original path. Optional expectedBaselineSha256 enables a server-side compare-and-swap check before the write. The write is recorded on the host undo stack and atomically swapped (temp file + rename). Used by the in-browser office editor host; the op-level editDocument remains the surgical path.",
        }),
      ),
      HttpApiEndpoint.post("exportDocument", OfficePaths.documentExport, {
        query: WorkspaceRoutingQuery,
        payload: OfficeDocumentExportPayload,
        success: described(OfficeDocumentExportResponse, "Exported document content"),
        error: OfficeError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.document.export",
          summary: "Export a document to text",
          description:
            'Read-only export of a DOCX / XLSX / HTML / Markdown / text file into csv, tsv, html, md, txt, docx, xlsx or pptx. Binary targets come back base64-encoded in `content` with `encoding: "base64"`. The original file is never modified; the same engine and operation contract back the panel button and Agent tools.',
        }),
      ),
      HttpApiEndpoint.post("undoDocument", OfficePaths.documentUndo, {
        query: WorkspaceRoutingQuery,
        payload: OfficeDocumentHistoryPayload,
        success: described(OfficeDocumentHistoryResponse, "Undone document edit"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.document.undo",
          summary: "Undo the last document edit",
          description:
            "Undo one step on the host-side document session and write the previous bytes back. Human UI and Agent edits share the same undo stack.",
        }),
      ),
      HttpApiEndpoint.post("redoDocument", OfficePaths.documentRedo, {
        query: WorkspaceRoutingQuery,
        payload: OfficeDocumentHistoryPayload,
        success: described(OfficeDocumentHistoryResponse, "Redone document edit"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.document.redo",
          summary: "Redo a document edit",
          description: "Re-apply one undone step on the host-side document session.",
        }),
      ),
      HttpApiEndpoint.get("documentState", OfficePaths.documentState, {
        query: OfficeDocumentHistoryQuery,
        success: described(OfficeDocumentStateResponse, "Document undo/redo state"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "office.document.state",
          summary: "Read document undo/redo state",
          description: "Report whether the current document has anything to undo or redo.",
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
