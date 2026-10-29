import { Context, Effect, Layer, Option } from "effect"
import * as os from "os"

import { InstanceState } from "@/effect/instance-state"
import { Shell } from "@/shell/shell"
import { Git } from "@/git"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import PROMPT_DEEPSEEK from "./prompt/deepseek.txt"
import PROMPT_GLM from "./prompt/glm.txt"
import PROMPT_QWEN from "./prompt/qwen.txt"
import PROMPT_MINIMAX from "./prompt/minimax.txt"
import PROMPT_MIMO from "./prompt/mimo.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { Config } from "@/config/config"

export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  // 国产模型专用系统提示词(按各自特性适配),置于默认之前。
  const domesticId = model.api.id.toLowerCase()
  if (domesticId.includes("deepseek")) return [PROMPT_DEEPSEEK]
  if (domesticId.includes("glm")) return [PROMPT_GLM]
  if (domesticId.includes("qwen") || domesticId.includes("qwq")) return [PROMPT_QWEN]
  if (domesticId.includes("minimax")) return [PROMPT_MINIMAX]
  if (domesticId.includes("mimo")) return [PROMPT_MIMO]
  return [PROMPT_DEFAULT]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info, activatedPaths?: string[]) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/SystemPrompt") {}

/** `git status --short` beyond this is cut; the model can run git itself. */
const GIT_STATUS_MAX_CHARS = 2_000

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    /**
     * Repository snapshot injected once per instance, mirroring Claude Code's
     * `<gitStatus>` context: branch, main branch, git user, working-tree
     * status and the last 5 commits. It is deliberately computed once (five
     * git spawns) and frozen, so the model is told it is a snapshot rather
     * than current truth.
     */
    const gitSnapshot = yield* InstanceState.make<string | undefined>(
      Effect.fn("SystemPrompt.gitSnapshot")(function* (ctx) {
        if (ctx.project.vcs !== "git") return undefined
        const git = Option.getOrUndefined(yield* Effect.serviceOption(Git.Service))
        if (!git) return undefined
        const cwd = ctx.directory
        const [branch, base, status, log, user] = yield* Effect.all(
          [
            git.branch(cwd),
            git.defaultBranch(cwd),
            git.run(["--no-optional-locks", "status", "--short"], { cwd }),
            git.run(["--no-optional-locks", "log", "--oneline", "-n", "5"], { cwd }),
            git.run(["--no-optional-locks", "config", "user.name"], { cwd }),
          ],
          { concurrency: 5 },
        )
        const text = (result: { exitCode: number; text: () => string }) =>
          result.exitCode === 0 ? result.text().trim() : ""
        const raw = text(status)
        const changed =
          raw.length > GIT_STATUS_MAX_CHARS
            ? `${raw.slice(0, GIT_STATUS_MAX_CHARS)}\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" with the shell tool)`
            : raw || "(clean)"
        const commit = text(log)
        const name = text(user)
        return [
          "This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.",
          `Current branch: ${branch ?? "(detached HEAD)"}`,
          ...(base ? [`Main branch (you will usually use this for PRs): ${base.name}`] : []),
          ...(name ? [`Git user: ${name}`] : []),
          `Status:\n${changed}`,
          ...(commit ? [`Recent commits:\n${commit}`] : []),
        ].join("\n\n")
      }),
    )

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        // 使用实际解析出的模型 id：提示词按模型族选择，环境块也据此告知模型身份。
        const modelName = model.api.id
        const modelId = `${model.providerID}/${model.api.id}`
        // Report the shell the shell tool will actually use: the configured
        // `shell` wins over $SHELL, and a stale env hint made the model emit
        // bash syntax into a PowerShell session (or vice versa).
        const config = Option.getOrUndefined(yield* Effect.serviceOption(Config.Service))
        const shellPath = Shell.acceptable(config ? (yield* config.get()).shell : undefined)
        const shellName = Shell.name(shellPath)
        const shellHint =
          shellName === "bash" || shellName === "zsh" || shellName === "sh" || shellName === "fish"
            ? "The shell executes Unix/POSIX commands."
            : shellName === "pwsh" || shellName === "powershell"
              ? "The shell is PowerShell. Use PowerShell syntax (cmdlets, `$env:VAR`, backtick escapes), not bash syntax."
              : shellName === "cmd"
                ? "The shell is cmd.exe. Use cmd syntax, not bash or PowerShell."
                : ""
        const git = yield* InstanceState.get(gitSnapshot)
        return [
          [
            `You are powered by the model named ${modelName}. The exact model ID is ${modelId}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform} (${os.release()})`,
            `  Shell: ${shellName} (${shellPath})${shellHint ? ` — ${shellHint}` : ""}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
          ...(git ? [git] : []),
        ]
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info, activatedPaths?: string[]) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent, activatedPaths)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer))

export * as SystemPrompt from "./system"
