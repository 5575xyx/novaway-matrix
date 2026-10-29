import { Context, Effect, Layer } from "effect"
import { and, desc, eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import type { SessionID } from "@/session/schema"
import { TeamMemberTable, TeamTable } from "./team.sql"

export type Team = {
  id: string
  name: string
  description?: string
  rootSessionID: SessionID
  /** 允许 Auto 模式自动选中（默认关闭，见 `TeamTable.auto_eligible`）。 */
  autoEligible: boolean
  createdAt: number
  updatedAt: number
}

export type Member = {
  teamID: string
  sessionID: SessionID
  name: string
  agent: string
  role: "lead" | "worker"
  status: "idle" | "active" | "archived"
  currentTaskID?: string
  worktreePath?: string
  createdAt: number
  updatedAt: number
}

export interface Interface {
  readonly create: (input: { name: string; description?: string; rootSessionID: SessionID }) => Effect.Effect<Team>
  /**
   * Return the team rooted at (or joined by) this session, creating one with
   * `name` when none exists. Check and insert happen in one synchronous DB
   * block so concurrent subagent spawns cannot create duplicate teams.
   */
  readonly ensure: (input: {
    rootSessionID: SessionID
    name: string
    agent: string
    memberName?: string
  }) => Effect.Effect<Team>
  readonly update: (input: {
    teamID: string
    name?: string
    description?: string
    autoEligible?: boolean
  }) => Effect.Effect<Team | undefined>
  readonly get: (id: string) => Effect.Effect<Team | undefined>
  readonly resolve: (idOrName: string, rootSessionID?: SessionID) => Effect.Effect<Team | undefined>
  readonly list: (rootSessionID?: SessionID) => Effect.Effect<Team[]>
  readonly remove: (id: string) => Effect.Effect<void>
  readonly addMember: (input: {
    teamID: string
    sessionID: SessionID
    name: string
    agent: string
    role?: "lead" | "worker"
    worktreePath?: string
  }) => Effect.Effect<Member>
  readonly members: (teamID: string) => Effect.Effect<Member[]>
  readonly member: (teamID: string, idOrName: string) => Effect.Effect<Member | undefined>
  readonly updateMember: (input: {
    teamID: string
    sessionID: SessionID
    status?: Member["status"]
    currentTaskID?: string | null
    worktreePath?: string | null
  }) => Effect.Effect<Member | undefined>
  readonly removeMember: (input: { teamID: string; sessionID: SessionID }) => Effect.Effect<void>
  readonly ofSession: (sessionID: SessionID) => Effect.Effect<Team | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/Team") {}

const id = () => `team_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

function toTeam(row: typeof TeamTable.$inferSelect): Team {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    rootSessionID: row.root_session_id,
    autoEligible: row.auto_eligible === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toMember(row: typeof TeamMemberTable.$inferSelect): Member {
  return {
    teamID: row.team_id,
    sessionID: row.session_id,
    name: row.name,
    agent: row.agent,
    role: row.role as Member["role"],
    status: row.status as Member["status"],
    currentTaskID: row.current_task_id ?? undefined,
    worktreePath: row.worktree_path ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const get: Interface["get"] = Effect.fn("Team.get")(function* (teamID) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(TeamTable).where(eq(TeamTable.id, teamID)).get()),
      )
      return row ? toTeam(row) : undefined
    })

    const resolve: Interface["resolve"] = Effect.fn("Team.resolve")(function* (idOrName, rootSessionID) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => {
          const byID = db.select().from(TeamTable).where(eq(TeamTable.id, idOrName)).get()
          if (byID) return byID
          const rows = db.select().from(TeamTable).where(eq(TeamTable.name, idOrName)).all()
          if (rootSessionID) return rows.find((item) => item.root_session_id === rootSessionID)
          return rows[0]
        }),
      )
      return row ? toTeam(row) : undefined
    })

    const create: Interface["create"] = Effect.fn("Team.create")(function* (input) {
      const now = Date.now()
      const team: Team = {
        id: id(),
        name: input.name,
        description: input.description,
        rootSessionID: input.rootSessionID,
        autoEligible: false,
        createdAt: now,
        updatedAt: now,
      }
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(TeamTable)
            .values({
              id: team.id,
              name: team.name,
              description: team.description ?? null,
              root_session_id: team.rootSessionID,
              created_at: now,
              updated_at: now,
            })
            .run(),
        ),
      )
      return team
    })

    const ensure: Interface["ensure"] = Effect.fn("Team.ensure")(function* (input) {
      const now = Date.now()
      // Check + insert is one synchronous block: two subagents spawning at the
      // same time must land in the same team instead of creating duplicates.
      const team = yield* Effect.sync(() =>
        Database.use((db) => {
          const membership = db
            .select()
            .from(TeamMemberTable)
            .where(eq(TeamMemberTable.session_id, input.rootSessionID))
            .orderBy(desc(TeamMemberTable.updated_at))
            .get()
          if (membership) {
            const joined = db.select().from(TeamTable).where(eq(TeamTable.id, membership.team_id)).get()
            if (joined) return toTeam(joined)
          }
          const rooted = db
            .select()
            .from(TeamTable)
            .where(eq(TeamTable.root_session_id, input.rootSessionID))
            .orderBy(desc(TeamTable.updated_at))
            .get()
          if (rooted) return toTeam(rooted)
          const created: Team = {
            id: id(),
            name: input.name,
            rootSessionID: input.rootSessionID,
            // 内核自动建的团队不进 Auto 池：它连名字都是默认的，用户没批准过。
            autoEligible: false,
            createdAt: now,
            updatedAt: now,
          }
          db.insert(TeamTable)
            .values({
              id: created.id,
              name: created.name,
              description: null,
              root_session_id: created.rootSessionID,
              created_at: now,
              updated_at: now,
            })
            .run()
          return created
        }),
      )
      // Idempotent: addMember updates the existing lead row instead of
      // duplicating it. Only the root session becomes lead; a session that is
      // merely a member of another team keeps its worker role.
      if (team.rootSessionID === input.rootSessionID) {
        yield* addMember({
          teamID: team.id,
          sessionID: input.rootSessionID,
          name: input.memberName ?? "team-lead",
          agent: input.agent,
          role: "lead",
        }).pipe(Effect.ignore)
      }
      return team
    })

    const update: Interface["update"] = Effect.fn("Team.update")(function* (input) {
      const now = Date.now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(TeamTable)
            .set({
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.description !== undefined ? { description: input.description } : {}),
              ...(input.autoEligible !== undefined ? { auto_eligible: input.autoEligible ? 1 : 0 } : {}),
              updated_at: now,
            })
            .where(eq(TeamTable.id, input.teamID))
            .run(),
        ),
      )
      return yield* get(input.teamID)
    })

    const list: Interface["list"] = Effect.fn("Team.list")(function* (rootSessionID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          rootSessionID
            ? db.select().from(TeamTable).where(eq(TeamTable.root_session_id, rootSessionID)).all()
            : db.select().from(TeamTable).all(),
        ),
      )
      return rows.map(toTeam)
    })

    const remove: Interface["remove"] = Effect.fn("Team.remove")(function* (teamID) {
      yield* Effect.sync(() =>
        Database.use((db) => {
          db.delete(TeamMemberTable).where(eq(TeamMemberTable.team_id, teamID)).run()
          db.delete(TeamTable).where(eq(TeamTable.id, teamID)).run()
        }),
      )
    })

    const addMember: Interface["addMember"] = Effect.fn("Team.addMember")(function* (input) {
      const now = Date.now()
      yield* Effect.sync(() =>
        Database.use((db) => {
          const existing = db
            .select()
            .from(TeamMemberTable)
            .where(and(eq(TeamMemberTable.team_id, input.teamID), eq(TeamMemberTable.session_id, input.sessionID)))
            .get()
          if (existing) {
            db.update(TeamMemberTable)
              .set({
                name: input.name,
                agent: input.agent,
                role: input.role ?? existing.role,
                worktree_path: input.worktreePath ?? existing.worktree_path,
                updated_at: now,
              })
              .where(and(eq(TeamMemberTable.team_id, input.teamID), eq(TeamMemberTable.session_id, input.sessionID)))
              .run()
            return
          }
          db.insert(TeamMemberTable)
            .values({
              team_id: input.teamID,
              session_id: input.sessionID,
              name: input.name,
              agent: input.agent,
              role: input.role ?? "worker",
              status: "idle",
              worktree_path: input.worktreePath ?? null,
              created_at: now,
              updated_at: now,
            })
            .run()
        }),
      )
      return (yield* member(input.teamID, input.sessionID))!
    })

    const members: Interface["members"] = Effect.fn("Team.members")(function* (teamID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(TeamMemberTable).where(eq(TeamMemberTable.team_id, teamID)).all()),
      )
      return rows.map(toMember)
    })

    const member: Interface["member"] = Effect.fn("Team.member")(function* (teamID, idOrName) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(TeamMemberTable).where(eq(TeamMemberTable.team_id, teamID)).all()),
      )
      const row = rows.find((item) => item.session_id === idOrName || item.name === idOrName)
      return row ? toMember(row) : undefined
    })

    const updateMember: Interface["updateMember"] = Effect.fn("Team.updateMember")(function* (input) {
      yield* Effect.sync(() =>
        Database.use((db) => {
          db.update(TeamMemberTable)
            .set({
              ...(input.status ? { status: input.status } : {}),
              ...(input.currentTaskID !== undefined ? { current_task_id: input.currentTaskID } : {}),
              ...(input.worktreePath !== undefined ? { worktree_path: input.worktreePath } : {}),
              updated_at: Date.now(),
            })
            .where(and(eq(TeamMemberTable.team_id, input.teamID), eq(TeamMemberTable.session_id, input.sessionID)))
            .run()
        }),
      )
      return yield* member(input.teamID, input.sessionID)
    })

    const removeMember: Interface["removeMember"] = Effect.fn("Team.removeMember")(function* (input) {
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .delete(TeamMemberTable)
            .where(and(eq(TeamMemberTable.team_id, input.teamID), eq(TeamMemberTable.session_id, input.sessionID)))
            .run(),
        ),
      )
    })

    const ofSession: Interface["ofSession"] = Effect.fn("Team.ofSession")(function* (sessionID) {
      // A root session can historically belong to more than one team (the lead
      // called team_create twice). The UI only renders one roster, so resolve
      // deterministically to the newest membership instead of whichever row
      // SQLite happens to return first — otherwise the panel keeps showing a
      // stale team while new workers join the fresh one.
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(TeamMemberTable)
            .where(eq(TeamMemberTable.session_id, sessionID))
            .orderBy(desc(TeamMemberTable.updated_at))
            .all(),
        ),
      )
      for (const row of rows) {
        const team = yield* get(row.team_id)
        if (team) return team
      }
      const team = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(TeamTable)
            .where(eq(TeamTable.root_session_id, sessionID))
            .orderBy(desc(TeamTable.updated_at))
            .get(),
        ),
      )
      return team ? toTeam(team) : undefined
    })

    return Service.of({
      create,
      ensure,
      update,
      get,
      resolve,
      list,
      remove,
      addMember,
      members,
      member,
      updateMember,
      removeMember,
      ofSession,
    })
  }),
)

export const defaultLayer = layer

export * as Team from "./team"
