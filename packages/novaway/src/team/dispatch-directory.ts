import { Effect } from "effect"
import type { Info as SessionInfo, Interface as SessionInterface } from "@/session/session"
import type { Interface as ProfileInterface } from "./profile"
import type { Interface as TeamInterface } from "./team"
import { fromLive, problems as rosterProblems } from "./roster"

export type Mode = "auto" | "selected"
export type CatalogMember = { name: string; agent: string; role: string }
export type TeamCandidate = {
  id: string
  name: string
  source: "team" | "profile"
  description?: string
  members: CatalogMember[]
}
export type ExpertCandidate = {
  id: string
  name: string
  job: string
  archived: false
  canAutoDispatch: boolean
  model?: string
  prompt?: string
  skills?: string[]
  tier?: string
}

export type Catalog = { teams: TeamCandidate[]; experts: ExpertCandidate[] }

/**
 * The canonical executable team/expert catalog for both team_list and team_run.
 * Keep session mode, workspace isolation, archive status and auto-dispatch
 * eligibility in one resolver so the assistant never sees an executor that the
 * dispatcher cannot accept (or misses a template that it can accept).
 */
export function resolve(input: {
  teams: TeamInterface
  profiles?: ProfileInterface
  sessions: SessionInterface
  session: SessionInfo
  directory: string
  mode: Mode
}): Effect.Effect<Catalog> {
  return Effect.gen(function* () {
    const wanted = new Set(input.mode === "selected" ? (input.session.teamIDs ?? []) : [])
    const teams: TeamCandidate[] = []
    for (const team of yield* input.teams.list()) {
      if (input.mode === "selected" && !wanted.has(team.id)) continue
      if (input.mode === "auto" && !team.autoEligible) continue
      const root = yield* input.sessions.get(team.rootSessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
      // A team without a resolvable root session has no verifiable workspace
      // ownership. Fail closed instead of letting it cross a project boundary.
      if (!root || root.directory !== input.directory) continue
      // A runtime team with only archived members is not a runnable target.
      const members = yield* input.teams.members(team.id)
      const live = fromLive({ teamID: team.id, name: team.name, members })
      if (!live) continue
      teams.push({
        id: team.id,
        name: team.name,
        source: "team",
        ...(team.description ? { description: team.description } : {}),
        members: live.roster.map((entry) => ({
          name: entry.employee.name,
          agent: entry.effective?.agent ?? entry.employee.job,
          role: entry.role === "captain" ? "lead" : "worker",
        })),
      })
    }

    const experts = new Map<string, ExpertCandidate>()
    if (!input.profiles) return { teams, experts: [] }
    const employees = new Map((yield* input.profiles.employees()).map((employee) => [employee.id, employee]))
    for (const profile of yield* input.profiles.list()) {
      const selectedProfile = input.mode === "selected" && wanted.has(profile.id)
      if (input.mode === "selected" && !selectedProfile && !input.session.employeeID) continue

      // A broken roster makes the whole profile unavailable as a team, but it
      // must not hide otherwise valid profile members as standalone experts.
      const profileMembers = yield* input.profiles.members(profile.id)
      const snapshot = yield* input.profiles.snapshot(profile.id)
      const employeeList = [...employees.values()]
      const validTeamRoster =
        !!snapshot &&
        rosterProblems(
          snapshot,
          employeeList,
          profileMembers.map((member) => member.employeeID),
        ).length === 0
      const teamAutoEligible = profileMembers.every((member) => member.canAutoDispatch)
      if (validTeamRoster && (selectedProfile || (input.mode === "auto" && profile.autoEligible && teamAutoEligible)))
        teams.push({
          id: profile.id,
          name: profile.name,
          source: "profile",
          ...(profile.description ? { description: profile.description } : {}),
          members: snapshot!.roster.map((entry) => ({
            name: entry.employee.name,
            agent: entry.effective?.agent ?? entry.employee.job,
            role: entry.role === "captain" ? "lead" : "worker",
          })),
        })
      for (const member of profileMembers) {
        if (input.mode === "auto" && !member.canAutoDispatch) continue
        if (input.mode === "selected" && input.session.employeeID !== member.employeeID) continue
        const employee = employees.get(member.employeeID)
        if (!employee || employee.archived) continue
        const previous = experts.get(employee.id)
        experts.set(employee.id, {
          id: employee.id,
          name: employee.name,
          job: employee.job,
          archived: false,
          canAutoDispatch: Boolean(previous?.canAutoDispatch || member.canAutoDispatch),
          ...(employee.model ? { model: employee.model } : {}),
          ...(employee.prompt ? { prompt: employee.prompt } : {}),
          ...(employee.skills?.length ? { skills: [...employee.skills] } : {}),
          ...(employee.tier ? { tier: employee.tier } : {}),
        })
      }
    }
    return { teams, experts: [...experts.values()] }
  })
}
