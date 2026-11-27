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
      query: {
        query: string
        path?: string
        recursive?: "true" | "false"
        type?: "file" | "directory"
        limit?: number
      }
    }) {
      const instance = yield* InstanceState.context
      // Local directory-routed requests do not always have a control-plane
      // WorkspaceRef. The filesystem search is still valid without a workspace
      // id; only include it when the route context provides one.
      const workspaceID = yield* InstanceState.workspaceID.pipe(Effect.catch(() => Effect.succeed(undefined)))
      const limit = ctx.query.limit ?? 20
      const query = ctx.query.query.trim().toLowerCase()
      const results: Array<{ path: string; type: "file" | "directory" }> = []
      const pending = [ctx.query.path ?? ""]
      const visited = new Set<string>()
      const recursive = ctx.query.recursive !== "false"

      // Do not use File.search here. Its fuzzy index performs a full workspace
      // scan on a cold instance, which can block the UI while large workspaces
      // are still bootstrapping. The directory API already respects .gitignore;
      // walk only non-ignored directories and stop once the result limit is met.
      while (pending.length > 0 && visited.size < 2048 && results.length < limit) {
        const dir = pending.shift()!
        if (visited.has(dir)) continue
        visited.add(dir)
        const nodes = yield* svc.list(dir).pipe(Effect.catch(() => Effect.succeed([])))
        for (const node of nodes) {
          if (node.ignored) continue
          const matches = !query || node.path.toLowerCase().includes(query)
          if (matches && (!ctx.query.type || node.type === ctx.query.type)) {
            results.push({ path: node.path, type: node.type })
            if (results.length >= limit) break
          }
          if (recursive && node.type === "directory") pending.push(node.path)
        }
      }
      const all = results
      return {
        location: {
          directory: instance.directory,
          ...(workspaceID ? { workspaceID } : {}),
          project: {
            id: instance.project.id,
            directory: instance.project.worktree,
          },
        },
        data: all.map((entry) => ({
          path: entry.path,
          type: entry.type,
        })),
      }
    })

    return handlers.handle("fsFind", fsFind)
  }),
)
