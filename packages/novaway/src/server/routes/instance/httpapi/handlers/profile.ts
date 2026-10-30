import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Service as ProfileService } from "@/team/profile"

/**
 * 团队模板接口。
 *
 * 组初始化时做一次幂等种子：打开应用就有「代码审查团队」，满足 §4.5 的
 * 「不配置任何组织，三步拿到第一份结果」。种子只补缺，不覆盖用户的编辑。
 */
export const profileHandlers = HttpApiBuilder.group(InstanceHttpApi, "profile", (handlers) =>
  Effect.gen(function* () {
    const profiles = yield* ProfileService
    yield* profiles.seed()

    const detail = Effect.fn("ProfileHttpApi.detail")(function* (profileID: string) {
      const profile = yield* profiles.get(profileID)
      if (!profile) return undefined
      const roster = yield* profiles.roster(profileID)
      return {
        profile: {
          id: profile.id,
          name: profile.name,
          description: profile.description,
          captainMember: profile.captainMember,
          autoEligible: profile.autoEligible,
          version: profile.version,
          memberCount: roster.length,
          updatedAt: profile.updatedAt,
        },
        members: roster.map((entry) => ({
          employeeID: entry.employee.id,
          name: entry.employee.name,
          job: entry.employee.job,
          role: entry.role,
          duty: entry.duty,
          order: entry.order,
        })),
      }
    })

    return handlers
      .handle("listProfiles", () =>
        Effect.gen(function* () {
          const list = yield* profiles.list()
          return yield* Effect.forEach(
            list,
            (profile) =>
              Effect.gen(function* () {
                const roster = yield* profiles.roster(profile.id)
                return {
                  id: profile.id,
                  name: profile.name,
                  description: profile.description,
                  captainMember: profile.captainMember,
                  autoEligible: profile.autoEligible,
                  version: profile.version,
                  memberCount: roster.length,
                  updatedAt: profile.updatedAt,
                }
              }),
            { concurrency: 1 },
          )
        }),
      )
      .handle("profileDetail", (ctx) =>
        Effect.gen(function* () {
          const found = yield* detail(ctx.params.profileID)
          if (!found) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return found
        }),
      )
      .handle("createProfile", (ctx) =>
        Effect.gen(function* () {
          const name = ctx.payload.name.trim()
          if (!name) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          if (!ctx.payload.members.some((member) => member.employeeID === ctx.payload.captain))
            return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const profile = yield* profiles.create({
            name,
            description: ctx.payload.description?.trim() || undefined,
            captain: ctx.payload.captain,
            members: ctx.payload.members,
          })
          const created = yield* detail(profile.id)
          if (!created) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          return created
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.BadRequest({})))),
      )
      .handle("removeProfile", (ctx) =>
        Effect.gen(function* () {
          const profile = yield* profiles.get(ctx.params.profileID)
          if (!profile) return yield* Effect.fail(new HttpApiError.NotFound({}))
          yield* profiles.remove(profile.id)
          return true
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.NotFound({})))),
      )
      .handle("listEmployees", () => profiles.employees())
  }),
)
