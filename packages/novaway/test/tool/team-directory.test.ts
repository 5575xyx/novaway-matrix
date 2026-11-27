import { expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { Service as TeamService, defaultLayer as TeamLayer } from "@/team/team"
import { Service as TeamRunService, defaultLayer as RunLayer } from "@/team/run"
import { defaultLayer as VerificationLayer } from "@/team/verification"
import { defaultLayer as MissionLayer } from "@/team/mission"
import { Service as ProfileService, defaultLayer as ProfileLayer } from "@/team/profile"
import { Session } from "@/session/session"
import { SessionUsage } from "@/session/usage"
import { MessageID, SessionID } from "@/session/schema"
import { TeamListTool } from "@/tool/team"
import { TeamRunTool } from "@/tool/team-run"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { defaultLayer as PlanApprovalLayer } from "@/session/plan-approval"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    TeamLayer,
    RunLayer,
    VerificationLayer,
    MissionLayer,
    ProfileLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    PlanApprovalLayer,
    Session.defaultLayer,
    SessionUsage.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
  ),
)

const ctx = (sessionID: SessionID, directory: string) => ({
  sessionID,
  messageID: MessageID.make("msg_team_directory"),
  agent: "build",
  directory,
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

it.instance(
  "team_list and team_run do not expose selected runtime teams from another workspace",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const teams = yield* TeamService
      const currentDirectory = yield* tmpdirScoped({ git: true })
      const foreignDirectory = yield* tmpdirScoped({ git: true })
      const current = yield* sessions.create({
        title: "current workspace",
        teamMode: "selected",
        directory: currentDirectory,
      })
      const foreignRoot = yield* sessions.create({ title: "foreign root", directory: foreignDirectory })
      const foreign = yield* teams.create({ name: "Foreign workspace team", rootSessionID: foreignRoot.id })
      yield* teams.addMember({
        teamID: foreign.id,
        sessionID: SessionID.make("ses_foreign_team_member"),
        name: "Foreign member",
        agent: "plan",
        role: "lead",
      })
      yield* sessions.setTeamMode({ sessionID: current.id, mode: "selected", teamIDs: [foreign.id] })

      const listTool = yield* TeamListTool
      const listed = yield* (yield* listTool.init()).execute({}, ctx(current.id, currentDirectory))
      expect(listed.output).not.toContain(`${foreign.id} Foreign workspace team`)

      const runTool = yield* TeamRunTool
      const exit = yield* Effect.exit(
        (yield* runTool.init()).execute({ team: foreign.id, goal: "review" }, ctx(current.id, currentDirectory)),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("No team is available")
    }),
  { timeout: 30_000 },
)

it.instance(
  "team_list and team_run hide teams whose root session cannot prove workspace ownership",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const teams = yield* TeamService
      const directory = yield* tmpdirScoped({ git: true })
      const session = yield* sessions.create({ title: "missing team root", teamMode: "selected", directory })
      const stale = yield* teams.create({
        name: "Unresolvable team",
        rootSessionID: SessionID.make("ses_missing_team_root"),
      })
      yield* sessions.setTeamMode({ sessionID: session.id, mode: "selected", teamIDs: [stale.id] })

      const listTool = yield* TeamListTool
      const listed = yield* (yield* listTool.init()).execute({}, ctx(session.id, directory))
      expect(listed.output).not.toContain(`${stale.id} Unresolvable team [team]`)
      expect(listed.output).not.toContain(`${stale.id} Unresolvable team (`)

      const runTool = yield* TeamRunTool
      const exit = yield* Effect.exit(
        (yield* runTool.init()).execute({ team: stale.id, goal: "review" }, ctx(session.id, directory)),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("No team is available")
    }),
  { timeout: 30_000 },
)

it.instance(
  "team_run rejects ambiguous display names and requires a listed ID",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const profiles = yield* ProfileService
      const runs = yield* TeamRunService
      const directory = yield* tmpdirScoped({ git: true })
      const session = yield* sessions.create({ title: "ambiguous catalog", teamMode: "auto", directory })
      const firstEmployee = yield* profiles.createEmployee({ name: "Same expert name", job: "plan" })
      const secondEmployee = yield* profiles.createEmployee({ name: "Same expert name", job: "build" })
      const first = yield* profiles.create({
        name: "Same team name",
        captain: firstEmployee.id,
        members: [{ employeeID: firstEmployee.id, role: "captain", canAutoDispatch: true }],
      })
      const second = yield* profiles.create({
        name: "Same team name",
        captain: secondEmployee.id,
        members: [{ employeeID: secondEmployee.id, role: "captain", canAutoDispatch: true }],
      })
      yield* profiles.update({ profileID: first.id, autoEligible: true })
      yield* profiles.update({ profileID: second.id, autoEligible: true })

      const list = yield* TeamListTool
      const listed = yield* (yield* list.init()).execute({}, ctx(session.id, directory))
      expect(listed.output).toContain(`${first.id} Same team name [profile]`)
      expect(listed.output).toContain(`${second.id} Same team name [profile]`)
      expect(listed.output).toContain(`${firstEmployee.id} Same expert name [plan]`)
      expect(listed.output).toContain(`${secondEmployee.id} Same expert name [build]`)

      const runTool = yield* TeamRunTool
      const definition = yield* runTool.init()
      const ambiguousTeam = yield* Effect.exit(
        definition.execute({ team: "Same team name", goal: "review" }, ctx(session.id, directory)),
      )
      expect(Exit.isFailure(ambiguousTeam)).toBe(true)
      if (Exit.isFailure(ambiguousTeam)) {
        expect(Cause.pretty(ambiguousTeam.cause)).toContain(first.id)
        expect(Cause.pretty(ambiguousTeam.cause)).toContain(second.id)
      }
      const ambiguousExpert = yield* Effect.exit(
        definition.execute({ expert: "Same expert name", goal: "plan" }, ctx(session.id, directory)),
      )
      expect(Exit.isFailure(ambiguousExpert)).toBe(true)
      if (Exit.isFailure(ambiguousExpert)) {
        expect(Cause.pretty(ambiguousExpert.cause)).toContain(firstEmployee.id)
        expect(Cause.pretty(ambiguousExpert.cause)).toContain(secondEmployee.id)
      }

      const dispatched = yield* definition.execute({ team: second.id, goal: "review" }, ctx(session.id, directory))
      expect((yield* runs.get(dispatched.metadata.runID!))?.state).toBe("running")
    }),
  { timeout: 30_000 },
)

it.instance(
  "team_list advertises selected templates and direct experts accepted by team_run",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const profiles = yield* ProfileService
      const runs = yield* TeamRunService
      const directory = yield* tmpdirScoped({ git: true })
      const employee = yield* profiles.createEmployee({ name: "Selected expert", job: "plan" })
      const profile = yield* profiles.create({
        name: "Selected template",
        captain: employee.id,
        members: [{ employeeID: employee.id, role: "captain" }],
      })
      const selectedTeamSession = yield* sessions.create({
        title: "selected team",
        teamMode: "selected",
        teamIDs: [profile.id],
        directory,
      })
      const selectedExpertSession = yield* sessions.create({
        title: "selected expert",
        teamMode: "selected",
        teamIDs: [],
        employeeID: employee.id,
        directory,
      })

      const listTool = yield* TeamListTool
      const runTool = yield* TeamRunTool
      const selectedTeamList = yield* (yield* listTool.init()).execute({}, ctx(selectedTeamSession.id, directory))
      expect(selectedTeamList.output).toContain(`${profile.id} Selected template [profile]`)
      expect(selectedTeamList.output).not.toContain(`${employee.id} Selected expert [plan]`)
      const teamRun = yield* (yield* runTool.init()).execute(
        { team: profile.id, goal: "Review selected work" },
        ctx(selectedTeamSession.id, directory),
      )
      expect((yield* runs.get(teamRun.metadata.runID!))?.state).toBe("running")

      const selectedExpertList = yield* (yield* listTool.init()).execute({}, ctx(selectedExpertSession.id, directory))
      expect(selectedExpertList.output).toContain(`${employee.id} Selected expert [plan]`)
      expect(selectedExpertList.output).not.toContain(`${profile.id} Selected template [profile]`)
      const expertRun = yield* (yield* runTool.init()).execute(
        { expert: employee.id, goal: "Plan selected work" },
        ctx(selectedExpertSession.id, directory),
      )
      expect((yield* runs.get(expertRun.metadata.runID!))?.state).toBe("running")
      const unknownExpert = yield* Effect.exit(
        (yield* runTool.init()).execute(
          { expert: "unknown expert", goal: "plan" },
          ctx(selectedExpertSession.id, directory),
        ),
      )
      expect(Exit.isFailure(unknownExpert)).toBe(true)
      if (Exit.isFailure(unknownExpert)) {
        expect(Cause.pretty(unknownExpert.cause)).toContain(employee.id)
        expect(Cause.pretty(unknownExpert.cause)).toContain("Selected expert [plan]")
      }
    }),
  { timeout: 30_000 },
)

it.instance(
  "a profile roster defect hides the team but does not hide a valid standalone expert",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const profiles = yield* ProfileService
      const runs = yield* TeamRunService
      const directory = yield* tmpdirScoped({ git: true })
      const expert = yield* profiles.createEmployee({ name: "Available specialist", job: "plan" })
      const archivedCoworker = yield* profiles.createEmployee({ name: "Archived coworker", job: "build" })
      const profile = yield* profiles.create({
        name: "Broken team, usable expert",
        captain: expert.id,
        members: [
          { employeeID: expert.id, role: "captain", canAutoDispatch: true },
          { employeeID: archivedCoworker.id, canAutoDispatch: true },
        ],
      })
      yield* profiles.update({ profileID: profile.id, autoEligible: true })
      const standalone = yield* profiles.createEmployee({ name: "Expert without auto team", job: "review" })
      const nonAutoTeam = yield* profiles.create({
        name: "Manual-only team, auto expert",
        captain: standalone.id,
        members: [{ employeeID: standalone.id, role: "captain", canAutoDispatch: true }],
      })
      const missingRosterExpert = yield* profiles.createEmployee({ name: "Expert with missing teammate", job: "build" })
      const incompleteProfile = yield* profiles.create({
        name: "Missing teammate, usable expert",
        captain: missingRosterExpert.id,
        members: [
          { employeeID: missingRosterExpert.id, role: "captain", canAutoDispatch: true },
          { employeeID: "emp_missing_profile_teammate", canAutoDispatch: true },
        ],
      })
      yield* profiles.update({ profileID: incompleteProfile.id, autoEligible: true })
      yield* profiles.updateEmployee({ employeeID: archivedCoworker.id, archived: true })
      const selectedSession = yield* sessions.create({
        title: "selected expert with broken team",
        teamMode: "selected",
        employeeID: expert.id,
        directory,
      })
      const autoSession = yield* sessions.create({ title: "auto expert with broken team", teamMode: "auto", directory })
      const listTool = yield* TeamListTool
      const runDefinition = yield* (yield* TeamRunTool).init()

      for (const session of [selectedSession, autoSession]) {
        const listed = yield* (yield* listTool.init()).execute({}, ctx(session.id, directory))
        expect(listed.output).toContain(`${expert.id} Available specialist [plan]`)
        expect(listed.output).not.toContain(`${profile.id} Broken team, usable expert [profile]`)
        const dispatched = yield* runDefinition.execute(
          { expert: expert.id, goal: "Plan independently" },
          ctx(session.id, directory),
        )
        expect((yield* runs.get(dispatched.metadata.runID!))?.state).toBe("running")
        if (session.id === autoSession.id) {
          expect(listed.output).toContain(`${standalone.id} Expert without auto team [review]`)
          expect(listed.output).not.toContain(`${nonAutoTeam.id} Manual-only team, auto expert [profile]`)
          expect(listed.output).toContain(`${missingRosterExpert.id} Expert with missing teammate [build]`)
          expect(listed.output).not.toContain(`${incompleteProfile.id} Missing teammate, usable expert [profile]`)
          const standaloneRun = yield* runDefinition.execute(
            { expert: standalone.id, goal: "Review independently" },
            ctx(session.id, directory),
          )
          expect((yield* runs.get(standaloneRun.metadata.runID!))?.state).toBe("running")
          const incompleteRosterExpertRun = yield* runDefinition.execute(
            { expert: missingRosterExpert.id, goal: "Build independently" },
            ctx(session.id, directory),
          )
          expect((yield* runs.get(incompleteRosterExpertRun.metadata.runID!))?.state).toBe("running")
        }
      }
    }),
  { timeout: 30_000 },
)

it.instance(
  "team_list and team_run share the same auto-eligible template directory",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const teams = yield* TeamService
      const profiles = yield* ProfileService
      const runs = yield* TeamRunService
      const directory = yield* tmpdirScoped({ git: true })
      const session = yield* sessions.create({ title: "dispatch catalog", teamMode: "auto", directory })

      const live = yield* teams.create({ name: "Available live team", rootSessionID: session.id })
      yield* teams.update({ teamID: live.id, autoEligible: true })
      yield* teams.addMember({
        teamID: live.id,
        sessionID: SessionID.make("ses_directory_live_member"),
        name: "Live reviewer",
        agent: "plan",
        role: "lead",
      })
      const hidden = yield* teams.create({ name: "User-only live team", rootSessionID: session.id })
      const emptyLive = yield* teams.create({ name: "Empty live team", rootSessionID: session.id })
      yield* teams.update({ teamID: emptyLive.id, autoEligible: true })

      const employee = yield* profiles.createEmployee({ name: "Template captain", job: "build" })
      const profile = yield* profiles.create({
        name: "Reusable review team",
        captain: employee.id,
        members: [{ employeeID: employee.id, role: "captain", canAutoDispatch: true }],
      })
      yield* profiles.update({ profileID: profile.id, autoEligible: true })
      const privateProfile = yield* profiles.create({
        name: "Non-dispatchable template",
        captain: employee.id,
        members: [{ employeeID: employee.id, role: "captain", canAutoDispatch: true }],
      })
      const restrictedEmployee = yield* profiles.createEmployee({ name: "Restricted team member", job: "general" })
      const partiallyRestrictedProfile = yield* profiles.create({
        name: "Partially restricted team",
        captain: employee.id,
        members: [
          { employeeID: employee.id, role: "captain", canAutoDispatch: true },
          { employeeID: restrictedEmployee.id, canAutoDispatch: false },
        ],
      })
      yield* profiles.update({ profileID: partiallyRestrictedProfile.id, autoEligible: true })
      const incompleteProfile = yield* profiles.create({
        name: "Incomplete roster template",
        captain: employee.id,
        members: [
          { employeeID: employee.id, role: "captain", canAutoDispatch: true },
          { employeeID: "emp_missing_roster_worker", canAutoDispatch: true },
        ],
      })
      yield* profiles.update({ profileID: incompleteProfile.id, autoEligible: true })
      const archivedEmployee = yield* profiles.createEmployee({ name: "Archived captain", job: "plan" })
      const archivedProfile = yield* profiles.create({
        name: "Archived roster template",
        captain: archivedEmployee.id,
        members: [{ employeeID: archivedEmployee.id, role: "captain", canAutoDispatch: true }],
      })
      yield* profiles.update({ profileID: archivedProfile.id, autoEligible: true })
      yield* profiles.updateEmployee({ employeeID: archivedEmployee.id, archived: true })

      const list = yield* TeamListTool
      const listed = yield* (yield* list.init()).execute({}, ctx(session.id, directory))
      expect(listed.output).toContain(`${live.id} Available live team [team]`)
      expect(listed.output).toContain(`${profile.id} Reusable review team [profile]`)
      expect(listed.output).toContain(`${employee.id} Template captain [build]`)
      expect(listed.output).not.toContain(`${hidden.id} User-only live team [team]`)
      expect(listed.output).not.toContain(`${emptyLive.id} Empty live team [team]`)
      expect(listed.output).not.toContain(`${privateProfile.id} Non-dispatchable template [profile]`)
      expect(listed.output).not.toContain(`${partiallyRestrictedProfile.id} Partially restricted team [profile]`)
      expect(listed.output).not.toContain(`${restrictedEmployee.id} Restricted team member [general]`)
      expect(listed.output).not.toContain(`${incompleteProfile.id} Incomplete roster template [profile]`)
      expect(listed.output).not.toContain(`${archivedProfile.id} Archived roster template [profile]`)
      expect(listed.output).not.toContain(`${archivedEmployee.id} Archived captain [plan]`)
      expect(listed.output).toContain("team_run accepts these exact IDs and names")

      const runTool = yield* TeamRunTool
      const runDefinition = yield* runTool.init()
      const emptyDispatch = yield* Effect.exit(
        runDefinition.execute({ team: emptyLive.id, goal: "Review empty team" }, ctx(session.id, directory)),
      )
      expect(Exit.isFailure(emptyDispatch)).toBe(true)
      if (Exit.isFailure(emptyDispatch)) expect(Cause.pretty(emptyDispatch.cause)).toContain("Unknown team")

      const incomplete = yield* Effect.exit(
        runDefinition.execute(
          { team: incompleteProfile.id, goal: "Review incomplete roster" },
          ctx(session.id, directory),
        ),
      )
      expect(Exit.isFailure(incomplete)).toBe(true)
      if (Exit.isFailure(incomplete)) {
        expect(Cause.pretty(incomplete.cause)).toContain(incompleteProfile.id)
        expect(Cause.pretty(incomplete.cause)).toContain(profile.id)
        expect(Cause.pretty(incomplete.cause)).toContain("Unknown team")
      }

      const dispatched = yield* runDefinition.execute(
        { team: profile.id, goal: "Review the current changes" },
        ctx(session.id, directory),
      )
      expect(dispatched.metadata.runID).toBeTruthy()
      expect((yield* runs.get(dispatched.metadata.runID!))?.state).toBe("running")
    }),
  { timeout: 30_000 },
)
