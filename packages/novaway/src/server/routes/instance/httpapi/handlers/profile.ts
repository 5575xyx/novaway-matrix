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
      .handle("createEmployee", (ctx) =>
        Effect.gen(function* () {
          const name = ctx.payload.name.trim()
          const job = ctx.payload.job.trim()
          // 名字与岗位是唯一必填的两项：没有岗位就无法派活，没有名字就无法在名册里指认人。
          if (!name || !job) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const created = yield* profiles.createEmployee({
            name,
            job,
            model: ctx.payload.model?.trim() || undefined,
            ...(ctx.payload.skills ? { skills: [...ctx.payload.skills] } : {}),
            prompt: ctx.payload.prompt,
            tier: ctx.payload.tier?.trim() || undefined,
          })
          return {
            id: created.id,
            name: created.name,
            job: created.job,
            // 没设的覆盖项直接不出现：客户端类型写的是 `model?: string`，
            // 发送 null 会让「有没有设置」看起来像「设置成了 null」。
            ...(created.model !== undefined ? { model: created.model } : {}),
            ...(created.prompt !== undefined ? { prompt: created.prompt } : {}),
            ...(created.skills !== undefined ? { skills: created.skills } : {}),
            ...(created.tier !== undefined ? { tier: created.tier } : {}),
            archived: created.archived,
          }
        }),
      )
      .handle("updateEmployee", (ctx) =>
        Effect.gen(function* () {
          const name = ctx.payload.name?.trim()
          const job = ctx.payload.job?.trim()
          // 传了空字符串是「想清空」的误用：名字与岗位不能变空，直接拒绝而不是写进库。
          if (name === "" || job === "") return yield* Effect.fail(new HttpApiError.BadRequest({}))
          // 覆盖项留空 = 清掉这条覆盖；`undefined` = 没传，保持原样。两者不能混。
          // 服务层用 null 表示「没有覆盖」，HTTP 层把空值归一成 null。
          const override = (value: string | undefined) => (value === undefined ? undefined : value.trim() || null)
          const skills =
            ctx.payload.skills === undefined ? undefined : ctx.payload.skills.map((item) => item.trim()).filter(Boolean)
          const model = override(ctx.payload.model)
          const prompt = override(ctx.payload.prompt)
          const tier = override(ctx.payload.tier)
          const updated = yield* profiles.updateEmployee({
            employeeID: ctx.params.employeeID,
            ...(name !== undefined ? { name } : {}),
            ...(job !== undefined ? { job } : {}),
            ...(model !== undefined ? { model } : {}),
            ...(skills !== undefined ? { skills: skills.length > 0 ? skills : null } : {}),
            ...(prompt !== undefined ? { prompt } : {}),
            ...(tier !== undefined ? { tier } : {}),
            ...(ctx.payload.archived !== undefined ? { archived: ctx.payload.archived } : {}),
          })
          if (!updated) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return {
            id: updated.id,
            name: updated.name,
            job: updated.job,
            ...(updated.model !== undefined ? { model: updated.model } : {}),
            ...(updated.prompt !== undefined ? { prompt: updated.prompt } : {}),
            ...(updated.skills !== undefined ? { skills: updated.skills } : {}),
            ...(updated.tier !== undefined ? { tier: updated.tier } : {}),
            archived: updated.archived,
          }
        }),
      )
  }),
)
