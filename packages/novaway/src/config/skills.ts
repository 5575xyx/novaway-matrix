import { Schema } from "effect"

export const Info = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Additional paths to skill folders",
  }),
  urls: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)",
  }),
  // 被关闭的技能名。扩展市场里的「内置扩展」开关写的就是这个列表：
  // 关掉一个扩展只影响它包含的技能，不删除任何文件，随时可以再打开。
  disabled: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Skill names that are disabled (hidden from agents); re-enable by removing them here.",
  }),
})

export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigSkills from "./skills"
