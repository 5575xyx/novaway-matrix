import type { RosterEntry, Snapshot } from "./profile"

/**
 * 活团队 → 名册快照（§5.2）。
 *
 * 两条发起路径的「人」来自不同地方：模板发起时读 `team_profile` 的编制，
 * 会话里用 `team_run` 发起时读 `team_member`（成员本来就是会话）。运行一旦开始
 * 只认快照 —— 之后改名、退组都不影响已在跑的这次运行。
 */

export type LiveMember = {
  sessionID: string
  name: string
  agent: string
  role: "lead" | "worker"
  status?: string
}

/** 存档的成员不参与派发：它们已经不在这个团队里了。 */
export function fromLive(input: {
  teamID: string
  name: string
  members: readonly LiveMember[]
}): Snapshot | undefined {
  const members = input.members.filter((member) => member.status !== "archived")
  const captain = members.find((member) => member.role === "lead") ?? members[0]
  // 一个成员都没有就没有队长：不编一个默认 agent 冒充，调用方按「无法派发」处理。
  if (!captain) return undefined
  const roster: RosterEntry[] = members.map((member, index) => ({
    employee: { id: member.sessionID, name: member.name, job: member.agent },
    role: member.sessionID === captain.sessionID ? "captain" : "worker",
    order: index,
    // 活团队没有「这个人能不能被 Auto 自动派活」的声明：一律按最严格的 false。
    canAutoDispatch: false,
  }))
  return { profileID: input.teamID, name: input.name, version: 1, captain: captain.sessionID, roster }
}
