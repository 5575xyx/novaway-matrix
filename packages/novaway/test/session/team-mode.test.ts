import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session as SessionNs } from "@/session/session"
import { Service as TeamService, defaultLayer as TeamLayer } from "@/team/team"
import { defaultLayer as TruncateLayer } from "@/tool/truncate"
import { defaultLayer as AgentLayer } from "@/agent/agent"
import { Bus } from "@/bus"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { Evolution } from "@/evolution/service"
import { Memory } from "@/memory/service"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    SessionNs.layer.pipe(
      Layer.provide(Bus.layer),
      Layer.provide(Storage.defaultLayer),
      Layer.provide(SyncEvent.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
    ),
    Evolution.defaultLayer,
    Memory.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    TruncateLayer,
    AgentLayer,
    TeamLayer,
  ) as never,
)

/**
 * 团队目录（§4.2）的选择必须真的落库。
 *
 * 这里刻意「写一次、重新读一次」：只断言返回值会漏掉投影层不写某些列的情况 ——
 * 那种情况下接口返回成功、界面显示已选中，而模型永远拿不到团队目录。
 */
describe("session team mode", () => {
  it.instance("persists the selected teams and clears them when switched off", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const teams = yield* TeamService
      const info = yield* sessions.create({ title: "团队选择" })
      const team = yield* teams.create({ name: "审查组", rootSessionID: info.id })

      yield* sessions.setTeamMode({ sessionID: info.id, mode: "selected", teamIDs: [team.id] })
      const selected = yield* sessions.get(info.id)
      expect(selected.teamMode).toBe("selected")
      expect(selected.teamIDs).toEqual([team.id])

      // 切到 Auto 时 ID 要清掉：否则下次切回 selected 会带回已经删掉的团队。
      yield* sessions.setTeamMode({ sessionID: info.id, mode: "auto" })
      const auto = yield* sessions.get(info.id)
      expect(auto.teamMode).toBe("auto")
      expect(auto.teamIDs).toBeUndefined()
    }),
  )
})
