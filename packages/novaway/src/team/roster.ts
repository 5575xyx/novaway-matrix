import type { Employee, RosterEntry, Snapshot } from "./profile"

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
    // 活团队成员是会话，不是员工库里的「人」：没有归档这一说，一律按可用处理。
    employee: { id: member.sessionID, name: member.name, job: member.agent, archived: false },
    role: member.sessionID === captain.sessionID ? "captain" : "worker",
    order: index,
    // 活团队没有「这个人能不能被 Auto 自动派活」的声明：一律按最严格的 false。
    canAutoDispatch: false,
  }))
  return { profileID: input.teamID, name: input.name, version: 1, captain: captain.sessionID, roster }
}

/**
 * 派发前对账（§9）：快照里的人现在还能不能接活。
 *
 * 快照冻结的是「当初这份名册长什么样」，不是「这些人现在还在不在」；两件事在派发
 * 时都必须成立，否则队长会把活派给一个已经归档的人，而界面只会显示「运行中」。
 *
 * 三条口径：
 *
 * 1. **归档即不可派**：快照里记着 `archived`（复制那一刻就已经归档了），或者员工库里
 *    现在把它标成归档，结果一样 —— 这个人都不能再接活。
 * 2. **查不到不等于被删了**：员工只归档、不物理删除（§5.1），所以员工库查不到的 id
 *    只可能是临时团队的会话成员。对它们不做判定，否则每个临时团队都会「寻址失败」。
 * 3. **队长必须在名册里**：找不到队长时退回默认 agent，就是「静默改派给别人」。
 */
export type Problem = {
  /** 出问题的人；整份快照读不出来时没有具体的人。 */
  employeeID?: string
  name?: string
  job?: string
  reason: "archived" | "missing" | "unreadable"
}

const REASON: Record<Problem["reason"], string> = {
  archived: "已归档",
  missing: "不在名册里",
  unreadable: "名册快照读不出来",
}

/** 把问题成员写成一句能直接铺在看板上的话：点名到人，不写「有成员」这种含糊话。 */
export function describe(problems: readonly Problem[]): string {
  const parts = problems.map((problem) => {
    const who = problem.name ?? problem.employeeID
    if (!who) return REASON[problem.reason]
    return who + (problem.job ? "（" + problem.job + "）" : "") + "：" + REASON[problem.reason]
  })
  return "寻址失败：" + parts.join("；")
}

export function problems(snapshot: Snapshot, employees: readonly Employee[]): Problem[] {
  const library = new Map(employees.map((employee) => [employee.id, employee]))
  const out: Problem[] = []
  for (const entry of snapshot.roster) {
    const live = library.get(entry.employee.id)
    if (!entry.employee.archived && live?.archived !== true) continue
    out.push({
      employeeID: entry.employee.id,
      // 名字与岗位优先用库里的现值：人可能改过名，看板上要认得出是谁。
      name: live?.name ?? entry.employee.name,
      job: live?.job ?? entry.employee.job,
      reason: "archived",
    })
  }
  if (!snapshot.roster.some((entry) => entry.employee.id === snapshot.captain))
    out.push({ employeeID: snapshot.captain, reason: "missing" })
  return out
}
