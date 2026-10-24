import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { TeamCreateTool } from "@/tool/team"
import { Service as TeamService, defaultLayer as TeamLayer } from "@/team/team"
import { SessionID } from "@/session/schema"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(TeamLayer, Truncate.defaultLayer, Agent.defaultLayer))

const lead = SessionID.make("ses_team_create_lead")
const ctx = (): any => ({ sessionID: lead, agent: "build" })

describe("team_create tool", () => {
  it.instance("reuses the team already rooted at the session", () =>
    Effect.gen(function* () {
      const teams = yield* TeamService
      const tool = yield* TeamCreateTool
      const def = yield* tool.init()

      const first = yield* def.execute({ name: "alpha" }, ctx())
      const second = yield* def.execute({ name: "beta" }, ctx())

      // The status panel renders one roster, so a repeated create must not
      // strand new workers in a team the panel never resolves.
      expect(second.metadata.teamID).toBe(first.metadata.teamID)
      expect(second.output).toContain("already exists")
      const members = yield* teams.members(first.metadata.teamID!)
      expect(members.map((member) => member.name)).toEqual(["team-lead"])
    }),
  )
})
