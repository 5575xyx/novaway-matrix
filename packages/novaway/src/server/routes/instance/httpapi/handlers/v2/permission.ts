import * as InstanceState from "@/effect/instance-state"
import { PermissionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"

export const permissionSavedHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.permission", (handlers) =>
  Effect.gen(function* () {
    const saved = Effect.fn("V2PermissionHttpApi.saved")(function* (ctx: { query: { projectID?: string } }) {
      const projectID = ctx.query.projectID ?? (yield* InstanceState.context).project.id
      const rules = yield* Effect.sync(() => {
        const row = Database.use((db) =>
          db.select().from(PermissionTable).where(eq(PermissionTable.project_id, projectID)).get(),
        )
        return row?.data ?? []
      })
      return {
        data: rules.map((rule, index) => ({
          id: `${projectID}:${index}`,
          projectID,
          action: rule.permission,
          resource: rule.pattern,
        })),
      }
    })

    return handlers.handle("saved", saved)
  }),
)
