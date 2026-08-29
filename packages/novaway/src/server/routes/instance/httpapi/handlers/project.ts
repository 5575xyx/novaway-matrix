import { AppRuntime } from "@/effect/app-runtime"
import * as InstanceState from "@/effect/instance-state"
import { Project } from "@/project/project"
import { ProjectID } from "@/project/schema"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForReload } from "../lifecycle"

export const projectHandlers = HttpApiBuilder.group(InstanceHttpApi, "project", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Project.Service

    const list = Effect.fn("ProjectHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const current = Effect.fn("ProjectHttpApi.current")(function* () {
      return (yield* InstanceState.context).project
    })

    const initGit = Effect.fn("ProjectHttpApi.initGit")(function* () {
      const ctx = yield* InstanceState.context
      const next = yield* svc.initGit({ directory: ctx.directory, project: ctx.project })
      if (next.id === ctx.project.id && next.vcs === ctx.project.vcs && next.worktree === ctx.project.worktree)
        return next
      yield* markInstanceForReload(ctx, {
        directory: ctx.directory,
        worktree: ctx.directory,
        project: next,
      })
      return next
    })

    const update = Effect.fn("ProjectHttpApi.update")(function* (ctx: {
      params: { projectID: ProjectID }
      payload: Project.UpdatePayload
    }) {
      return yield* svc.update({ ...ctx.payload, projectID: ctx.params.projectID })
    })

    // TUI 启动时 project.sync() 会无条件调用它；缺这条路由请求会落到 UI 兜底路由拿到
    // text/html，SDK 拦截器直接抛错，TUI 根本渲染不出来。
    // 顺序有意义：TUI 取 `list.findLast(item => item.strategy === undefined).directory` 当主目录，
    // 所以主 worktree 必须排在最后。
    const directories = Effect.fn("ProjectHttpApi.directories")(function* (ctx: {
      params: { projectID: ProjectID }
    }) {
      const project = yield* svc.get(ctx.params.projectID)
      if (!project) return yield* Effect.fail(new HttpApiError.BadRequest())
      const sandboxes = yield* svc.sandboxes(ctx.params.projectID)
      return [
        ...sandboxes.filter((directory) => directory !== project.worktree).map((directory) => ({ directory })),
        { directory: project.worktree },
      ]
    })

    return handlers
      .handle("list", list)
      .handle("current", current)
      .handle("initGit", initGit)
      .handle("update", update)
      .handle("directories", directories)
  }),
)
