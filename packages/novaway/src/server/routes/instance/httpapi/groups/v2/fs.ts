import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../../middleware/authorization"
import { InstanceContextMiddleware } from "../../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../../middleware/workspace-routing"

// TUI 的 @ 文件搜索(sdk.client.v2.fs.find)走的就是这条路由。此前服务端从未注册它,
// 请求落进 UI catch-all 返回 index.html,SDK 直接抛
// "Request is not supported by this version of NovaWay Server (Server responded with text/html)"
// 把整个会话炸掉 —— @ 菜单里也从来没列出过文件。
// 用 InstanceContext(而不是 v2 的 LocationMiddleware)是为了拿到完整实例环境:
// File.Service 和项目/工作区信息都在那边。
const FileSystemEntrySchema = Schema.Struct({
  path: Schema.String,
  type: Schema.Literals(["file", "directory"]),
}).annotate({ identifier: "FileSystemEntry" })

const LocationInfoSchema = Schema.Struct({
  directory: Schema.String,
  workspaceID: Schema.optional(Schema.String),
  project: Schema.Struct({
    id: Schema.String,
    directory: Schema.String,
  }),
}).annotate({ identifier: "V2LocationInfo" })

export const FsFindQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  query: Schema.String,
  type: Schema.optional(Schema.Literals(["file", "directory"])),
  limit: Schema.optional(Schema.NumberFromString),
}).annotate({ identifier: "V2FsFindQuery" })

const FsFindSuccess = Schema.Struct({
  location: LocationInfoSchema,
  data: Schema.Array(FileSystemEntrySchema),
}).annotate({ identifier: "V2FsFindResponse" })

export const FsGroup = HttpApiGroup.make("v2.fs")
  .add(
    HttpApiEndpoint.get("fsFind", "/api/fs/find", {
      query: FsFindQuery,
      success: FsFindSuccess,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.fs.find",
        summary: "Find files",
        description: "Fuzzy-find files and directories for the @ mention search.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2 fs",
      description: "Experimental v2 filesystem routes.",
    }),
  )
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)
