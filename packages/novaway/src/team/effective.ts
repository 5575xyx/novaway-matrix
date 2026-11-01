import { createHash } from "node:crypto"
import type { RosterEntry } from "./profile"

/**
 * 员工**实际生效**的配置（§5.4 / §11.1）。
 *
 * 名册里存的 `model` / `prompt` / `skills` 是「这个人声明的」，不是「派发时用的」；
 * 两者此前并不相等 —— 声明了也从来没被读过。这里把「声明 → 生效」收成一条路径：
 * 派发时按这里的结果组装提示词与模型，快照按这里的结果冻结一份给人看。
 *
 * 冻结的是**声明值与取值来源**，不编造运行期才知道的东西（会话默认模型、agent
 * 配置版本）：快照要能解释历史，不能给历史编一份当时没人算过的值。
 */

export type Model = { providerID: string; modelID: string }

/** `provider/model` → `{ providerID, modelID }`；格式不对就当没声明（不让拼写错误变成跑不起来）。 */
export function parseModel(text: string | undefined): Model | undefined {
  if (!text) return undefined
  const trimmed = text.trim()
  const index = trimmed.indexOf("/")
  if (index <= 0 || index === trimmed.length - 1) return undefined
  return { providerID: trimmed.slice(0, index), modelID: trimmed.slice(index + 1) }
}

export type Effective = {
  /** 真正派发时用的 agent（岗位）。 */
  agent: string
  /** 员工自己声明的模型；没有就按会话默认，这里不写。 */
  model?: string
  /** 岗位说明的哈希：说明改了哈希就变，原文不进快照（可能很长）。 */
  promptHash?: string
  skills?: string[]
}

export function hash(text: string): string {
  return "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 32)
}

export function of(entry: RosterEntry): Effective {
  const prompt = entry.employee.prompt?.trim()
  return {
    agent: entry.employee.job,
    ...(entry.employee.model?.trim() ? { model: entry.employee.model.trim() } : {}),
    ...(prompt ? { promptHash: hash(prompt) } : {}),
    ...(entry.employee.skills?.length ? { skills: [...entry.employee.skills] } : {}),
  }
}

/**
 * 员工的岗位说明，写成一段可以直接放进提示词的话。
 *
 * 没有说明的成员不生成空标题 —— 「【岗位说明】」下面什么都没有，比没有更糟：
 * 模型会以为这就是全部要求。
 */
export function instructions(entry: RosterEntry | undefined): string | undefined {
  const text = entry?.employee.prompt?.trim()
  if (!entry || !text) return undefined
  return "【你的岗位说明 · " + entry.employee.name + "（" + entry.employee.job + "）】" + "\n" + text
}

/** 岗位说明放在任务之前：模型先知道自己是谁，再读要做什么。 */
export function compose(entry: RosterEntry | undefined, prompt: string): string {
  const note = instructions(entry)
  return note ? note + "\n\n" + prompt : prompt
}

export * as TeamEffective from "./effective"
