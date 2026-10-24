import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Service as TeamService } from "@/team/team"

export const TeamCreateParameters = Schema.Struct({
  name: Schema.String.annotate({ description: "Team name" }),
  description: Schema.optional(Schema.String).annotate({ description: "Team purpose" }),
})

export const TeamCreateTool = Tool.define<typeof TeamCreateParameters, { teamID?: string; name?: string }, TeamService>(
  "team_create",
  Effect.gen(function* () {
    const teams = yield* TeamService
    return {
      description: "Create a team for coordinating multiple agents. A team owns a shared task list and member roster.",
      parameters: TeamCreateParameters,
      capabilities: { concurrencySafe: false },
      execute: (params: Schema.Schema.Type<typeof TeamCreateParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // One team per root session: the UI renders exactly one roster, so a
          // second team_create from the lead would otherwise leave the panel
          // pointing at the old team while new workers join the duplicate.
          const existing = yield* teams.ofSession(ctx.sessionID)
          const rooted = existing && existing.rootSessionID === ctx.sessionID ? existing : undefined
          const team = rooted
            ? ((yield* teams.update({ teamID: rooted.id, name: params.name, description: params.description })) ??
              rooted)
            : yield* teams.ensure({ rootSessionID: ctx.sessionID, name: params.name, agent: ctx.agent })
          return {
            title: `Team ${team.name}`,
            output: existing
              ? `Team already exists: ${team.name}\nid: ${team.id}\nUse team_id with task tools and task creation.`
              : `Team created: ${team.name}\nid: ${team.id}\nUse team_id with task tools and task creation.`,
            metadata: { teamID: team.id, name: team.name },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const TeamDeleteParameters = Schema.Struct({
  team: Schema.String.annotate({ description: "Team id or name" }),
})

export const TeamDeleteTool = Tool.define<typeof TeamDeleteParameters, { teamID?: string }, TeamService>(
  "team_delete",
  Effect.gen(function* () {
    const teams = yield* TeamService
    return {
      description: "Delete a team and its member roster. Tasks are left untouched.",
      parameters: TeamDeleteParameters,
      capabilities: { concurrencySafe: false },
      execute: (params: Schema.Schema.Type<typeof TeamDeleteParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const team = yield* teams.resolve(params.team, ctx.sessionID)
          if (!team) return { title: "Team not found", output: `No team named ${params.team}`, metadata: {} }
          yield* teams.remove(team.id)
          return { title: "Team deleted", output: `Deleted team ${team.name}`, metadata: { teamID: team.id } }
        }).pipe(Effect.orDie),
    }
  }),
)

export const TeamListParameters = Schema.Struct({})

export const TeamListTool = Tool.define<typeof TeamListParameters, { count?: number }, TeamService>(
  "team_list",
  Effect.gen(function* () {
    const teams = yield* TeamService
    return {
      description: "List teams the current session belongs to, or all teams in this project.",
      parameters: TeamListParameters,
      capabilities: { readOnly: true, concurrencySafe: true },
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const current = yield* teams.ofSession(ctx.sessionID)
          const list = current ? [current] : yield* teams.list()
          if (list.length === 0) return { title: "Teams", output: "No teams yet.", metadata: {} }
          const lines: string[] = []
          for (const team of list) {
            const members = yield* teams.members(team.id)
            lines.push(`${team.id} ${team.name} (${members.length} members)`)
            for (const member of members) {
              lines.push(
                `  - ${member.name} [${member.agent}] ${member.status}${member.currentTaskID ? ` → ${member.currentTaskID}` : ""}`,
              )
            }
          }
          return { title: "Teams", output: lines.join("\n"), metadata: { count: list.length } }
        }).pipe(Effect.orDie),
    }
  }),
)

export const AgentListParameters = Schema.Struct({
  team: Schema.optional(Schema.String).annotate({ description: "Team id or name; defaults to current team" }),
})

export const AgentListTool = Tool.define<typeof AgentListParameters, { teamID?: string }, TeamService>(
  "agent_list",
  Effect.gen(function* () {
    const teams = yield* TeamService
    return {
      description: "List team members with status, current task and worktree.",
      parameters: AgentListParameters,
      capabilities: { readOnly: true, concurrencySafe: true },
      execute: (params: Schema.Schema.Type<typeof AgentListParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const team = params.team
            ? yield* teams.resolve(params.team, ctx.sessionID)
            : yield* teams.ofSession(ctx.sessionID)
          if (!team) return { title: "No team", output: "The current session is not in a team.", metadata: {} }
          const members = yield* teams.members(team.id)
          const output = members
            .map(
              (member) =>
                `${member.name} [${member.agent}] session=${member.sessionID} status=${member.status}` +
                `${member.currentTaskID ? ` task=${member.currentTaskID}` : ""}` +
                `${member.worktreePath ? ` worktree=${member.worktreePath}` : ""}`,
            )
            .join("\n")
          return { title: `Members of ${team.name}`, output, metadata: { teamID: team.id } }
        }).pipe(Effect.orDie),
    }
  }),
)
