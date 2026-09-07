import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { File } from "@/file"
import * as InstanceState from "@/effect/instance-state"
import { InstanceHttpApi } from "../../api"

// @ 文件搜索(/api/fs/find)的处理器。File.Service.search 返回的是纯路径字符串,
// 这里用一次混合搜索拿全局相关度排序,再用一次目录搜索给每条标上类型;
// 响应里的 location 让 SDK 侧知道结果相对哪个目录(自动补全用它拼绝对路径)。
export const fsHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.fs", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* File.Service

    const fsFind = Effect.fn("V2FsHttpApi.find")(function* (ctx: {
      query: { query: string; type?: "file" | "directory"; limit?: number }
    }) {
      const instance = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      const limit = ctx.query.limit ?? 20
      const all = yield* svc.search({
        query: ctx.query.query,
        limit,
        ...(ctx.query.type ? { type: ctx.query.type } : {}),
      })
      const dirs =
        ctx.query.type === "directory"
          ? new Set(all)
          : new Set(
              yield* svc.search({
                query: ctx.query.query,
                limit,
                type: "directory",
              }),
            )
      return {
        location: {
          directory: instance.directory,
          ...(workspaceID ? { workspaceID } : {}),
          project: {
            id: instance.project.id,
            directory: instance.project.worktree,
          },
        },
        data: all.map((path) => ({
          path,
          type: (dirs.has(path) ? "directory" : "file") as "directory" | "file",
        })),
      }
    })

    return handlers.handle("fsFind", fsFind)
  }),
)
