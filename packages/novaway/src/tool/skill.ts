import path from "path"
import { pathToFileURL } from "url"
import { Effect, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Ripgrep } from "../file/ripgrep"
import { Skill } from "../skill"
import { Service as SessionService } from "@/session/session"
import { Service as AgentService } from "@/agent/agent"
import { makeRunAgent, type RunAgentPromptOps } from "@/session/agent-step"
import { MessageV2 } from "@/session/message-v2"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from available_skills" }),
})

type Metadata = { name: string; dir?: string; fork?: boolean }

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const rg = yield* Ripgrep.Service
    const sessions = yield* SessionService
    const agents = yield* AgentService

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* skill.get(params.name)
          if (!info) {
            const all = yield* skill.all()
            const available = all.map((item) => item.name).join(", ")
            throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
          }

          yield* ctx.ask({
            permission: "skill",
            patterns: [params.name],
            always: [params.name],
            metadata: {},
          })

          // `context: fork` runs the skill in an isolated subagent session so the
          // main conversation does not absorb its intermediate tool output.
          if (info.context === "fork") {
            const ops = ctx.extra?.promptOps as RunAgentPromptOps | undefined
            if (ops) {
              const message = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
                Effect.orDie,
              )
              if (message.info.role === "assistant") {
                const runAgent = makeRunAgent({
                  ops,
                  sessions,
                  agents,
                  parentSessionID: ctx.sessionID,
                  defaultModel: { providerID: message.info.providerID, modelID: message.info.modelID },
                  defaultAgent: info.agent ?? ctx.agent,
                })
                const output = yield* runAgent({
                  agent: info.agent ?? ctx.agent,
                  prompt: info.content,
                  title: `Skill: ${info.name}`,
                })
                const metadata: Metadata = { name: info.name, fork: true }
                return {
                  title: `Forked skill: ${info.name}`,
                  output: [`<skill_result name="${info.name}">`, output, "</skill_result>"].join(
                    String.fromCharCode(10),
                  ),
                  metadata,
                }
              }
            }
          }

          const dir = path.dirname(info.location)
          const base = pathToFileURL(dir).href
          const limit = 10
          const files = yield* rg.files({ cwd: dir, follow: false, hidden: true, signal: ctx.abort }).pipe(
            Stream.filter((file) => !file.includes("SKILL.md")),
            Stream.map((file) => path.resolve(dir, file)),
            Stream.take(limit),
            Stream.runCollect,
            Effect.map((chunk) => [...chunk].map((file) => `<file>${file}</file>`).join("\n")),
          )

          return {
            title: `Loaded skill: ${info.name}`,
            output: [
              `<skill_content name="${info.name}">`,
              `# Skill: ${info.name}`,
              "",
              info.content.trim(),
              "",
              `Base directory for this skill: ${base}`,
              "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
              "Note: file list is sampled.",
              "",
              "<skill_files>",
              files,
              "</skill_files>",
              "</skill_content>",
            ].join("\n"),
            metadata: { name: info.name, dir } satisfies Metadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
