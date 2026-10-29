/**
 * 团队目录（§4.2）的渲染与去重签名。
 *
 * 「用户选了哪些团队」不能只活在 UI 里：主智能体真正能派发什么，必须由内核
 * 按会话字段重新算一遍。这里把「算目录」和「写成提示词」分开，渲染部分是纯函数，
 * 可以脱离数据库单测。
 */

export type CatalogMember = { name: string; agent: string; role: string }

export type CatalogEntry = {
  id: string
  name: string
  description?: string
  members: readonly CatalogMember[]
}

export type CatalogMode = "auto" | "selected"

/**
 * 目录的稳定签名：模式 + 团队集合 + 成员集合。
 *
 * 用它解决「每轮都重发一遍目录」的浪费：内容没变就只注入一次。团队成员变化
 * 也算变化 —— 否则新加的成员永远不会出现在模型眼里。
 */
export function signature(mode: CatalogMode, entries: readonly CatalogEntry[]) {
  return [
    mode,
    ...entries.map(
      (entry) =>
        entry.id +
        ":" +
        entry.name +
        ":" +
        entry.members.map((member) => `${member.name}@${member.agent}/${member.role}`).join(","),
    ),
  ].join("|")
}

/**
 * 渲染成一段 `<system-reminder>`。
 *
 * 两条信息缺一不可：
 * 1. **能派发谁** —— 名字、成员、职责，模型据此选团队；
 * 2. **派发要付什么代价** —— Auto 模式必须等用户批准，否则模型会以为
 *    「调一次工具就开跑了」，实际停在 `awaiting_approval`。
 */
export function render(mode: CatalogMode, entries: readonly CatalogEntry[]) {
  if (entries.length === 0) return undefined
  const lines = ["<system-reminder>", "本次会话可派发的团队（用户已选择，列表之外的一律不可用）："]
  for (const entry of entries) {
    const roster = entry.members.map(
      (member) => `${member.name}[${member.agent}]${member.role === "lead" ? "(lead)" : ""}`,
    )
    lines.push(`- ${entry.name}（id: ${entry.id}）${entry.description ? "— " + entry.description : ""}`)
    if (roster.length) lines.push(`  成员：${roster.join("、")}`)
  }
  lines.push("")
  lines.push("用 `team_run`（team 填名字或 id）派发；验收标准要写成能被复核的一句话，没有验收的派发只能得到 partial。")
  if (mode === "auto") {
    lines.push(
      "当前是 Auto 模式：`team_run` 只会创建运行并停在等待批准，必须由用户在运行页确认后才会执行。不要声称已经开始。",
    )
  } else {
    lines.push("当前是指定团队模式：`team_run` 会直接批准计划，执行仍由用户在运行页启动。")
  }
  lines.push("</system-reminder>")
  return lines.join("\n")
}

export * as TeamCatalog from "./catalog"
