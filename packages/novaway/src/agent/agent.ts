import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { Truncate } from "@/tool/truncate"
import { Auth } from "../auth"
import { ProviderTransform } from "@/provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SCOUT from "./prompt/scout.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_PULSE_ORCHESTRATOR from "./prompt/pulse-orchestrator.txt"
import { Permission } from "@/permission"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@novaway/core/global"
import path from "path"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"
import { Effect, Context, Layer, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { type DeepMutable } from "@novaway/core/schema"
import { agencyAgents } from "./agency"

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Finite),
  temperature: Schema.optional(Schema.Finite),
  color: Schema.optional(Schema.String),
  permission: Permission.Ruleset,
  model: Schema.optional(
    Schema.Struct({
      modelID: ModelID,
      providerID: ProviderID,
    }),
  ),
  variant: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Finite),
}).annotate({ identifier: "Agent" })
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>

const GeneratedAgent = Schema.Struct({
  identifier: Schema.String,
  whenToUse: Schema.String,
  systemPrompt: Schema.String,
})

export interface Interface {
  readonly get: (agent: string) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Info[]>
  readonly defaultInfo: () => Effect.Effect<Info>
  readonly defaultAgent: () => Effect.Effect<string>
  /** Reload config + agent cache so newly written agent markdown is available. */
  readonly reload: () => Effect.Effect<Info[]>
  readonly generate: (input: {
    description: string
    model?: { providerID: ProviderID; modelID: ModelID }
  }) => Effect.Effect<
    {
      identifier: string
      whenToUse: string
      systemPrompt: string
    },
    Provider.ModelNotFoundError
  >
}

type State = Omit<Interface, "generate" | "reload">

export class Service extends Context.Service<Service, Interface>()("@NovaWay/Agent") {}

const OFFICE_AGENT_BASE_PROMPT = [
  "你是 NovaWay 办公模式的内置 AI 员工。",
  "你只处理办公交付，不进入工程代码实现、调试、仓库重构或终端执行任务。",
  "先理解用户目标、受众、资料来源和交付格式；信息不足时提出必要问题，但不要用冗长教程替代交付。",
  "输出必须可直接复制到办公文档、演示文稿、知识库、数据分析报告或视觉物料中。",
  "默认使用简体中文；除非用户明确要求，不要输出英文结构说明。",
  "遇到附件或资料时，优先提炼可验证信息，明确区分事实、推断、待确认项。",
  "正式交付时必须使用 Markdown，并以“# 办公产物”作为主标题；可沉淀的偏好、客户背景、术语口径或模板规则必须放在“# 可沉淀记忆/可进化建议”下，等待用户确认。",
  "不要把操作说明、快捷键说明或内部 Agent/Skill 配置过程混入办公产物正文。",
].join("\n")

const officeAgentPrompt = (input: {
  role: string
  skill: string
  workflow: string[]
  output: string[]
  checks: string[]
}) =>
  [
    OFFICE_AGENT_BASE_PROMPT,
    "",
    `当前办公场景：${input.role}`,
    `默认调用 Skill：${input.skill}`,
    "",
    "工作流程：",
    ...input.workflow.map((item, index) => `${index + 1}. ${item}`),
    "",
    "交付格式重点：",
    ...input.output.map((item) => `- ${item}`),
    "",
    "质量检查：",
    ...input.checks.map((item) => `- ${item}`),
  ].join("\n")

const officeSkillPermission = (skillName: string) =>
  Permission.fromConfig({
    question: "allow",
    skill: {
      "*": "deny",
      [skillName]: "allow",
      "office-knowledge": "allow",
      "office-data": "allow",
    },
  })

const officeAgentOptions = (input: { displayName: string; scene: string; skill: string }) => ({
  displayName: input.displayName,
  category: "办公模式",
  modeGroup: "office",
  scene: input.scene,
  defaultSkill: input.skill,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const plugin = yield* Plugin.Service
    const skill = yield* Skill.Service
    const provider = yield* Provider.Service
    const flags = yield* RuntimeFlags.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Agent.state")(function* (ctx) {
        const cfg = yield* config.get()
        const skillDirs = yield* skill.dirs()
        const builtInSkillRules = Object.fromEntries((yield* skill.all()).map((item) => [item.name, "allow"] as const))
        const builtInSkillPermission = Permission.fromConfig({ skill: builtInSkillRules })
        const whitelistedDirs = [
          Truncate.GLOB,
          path.join(Global.Path.tmp, "*"),
          ...skillDirs.map((dir) => path.join(dir, "*")),
        ]
        const readonlyExternalDirectory = {
          "*": "ask",
          ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
        } satisfies Record<string, "allow" | "ask" | "deny">

        const defaults = Permission.fromConfig({
          "*": "allow",
          doom_loop: "ask",
          external_directory: {
            "*": "ask",
            ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
          },
          skill: {
            "*": "deny",
            ...builtInSkillRules,
          },
          question: "deny",
          plan_enter: "deny",
          plan_exit: "deny",
          repo_clone: "deny",
          repo_overview: "deny",
          // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
          read: {
            "*": "allow",
            "*.env": "ask",
            "*.env.*": "ask",
            "*.env.example": "allow",
          },
        })

        const user = Permission.fromConfig(cfg.permission ?? {})

        const agents: Record<string, Info> = {
          build: {
            name: "build",
            description: "The default agent. Executes tools based on configured permissions.",
            options: {
              category: "核心",
            },
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_enter: "allow",
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          plan: {
            name: "plan",
            description: "Plan mode. Disallows all edit tools.",
            options: {
              category: "核心",
            },
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_exit: "allow",
                external_directory: {
                  [path.join(Global.Path.data, "plans", "*")]: "allow",
                },
                edit: {
                  "*": "deny",
                  [path.join(".novaway", "plans", "*.md")]: "allow",
                  [path.relative(ctx.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
                },
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          general: {
            name: "general",
            description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                todowrite: "deny",
              }),
              user,
            ),
            options: {
              category: "核心",
            },
            mode: "subagent",
            native: true,
          },
          "office-document": {
            name: "office-document",
            description: "办公模式 文档整理员工。用于写作、改写、审稿、方案、报告、周报、月报和结构化文档交付。",
            prompt: officeAgentPrompt({
              role: "文档整理",
              skill: "office-document",
              workflow: [
                "确认文档目标、读者和使用场景",
                "建立标题层级、结论和关键论据",
                "生成可复制正文",
                "标出资料缺口、待确认项和可沉淀记忆",
              ],
              output: ["结论先行", "结构清晰", "必要时使用表格和清单", "保留待确认事项"],
              checks: ["是否能直接交付", "是否覆盖目标读者关心点", "是否区分事实和推断"],
            }),
            permission: Permission.merge(defaults, officeSkillPermission("office-document"), user),
            options: officeAgentOptions({ displayName: "文档整理", scene: "document", skill: "office-document" }),
            mode: "primary",
            native: true,
            color: "success",
          },
          "office-ppt": {
            name: "office-ppt",
            description: "办公模式 PPT生成员工。用于汇报大纲、页级故事线、页面文案、图表建议和演讲备注。",
            prompt: officeAgentPrompt({
              role: "PPT生成",
              skill: "office-ppt",
              workflow: [
                "确认受众、页数和汇报目标",
                "设计叙事主线和页面顺序",
                "拆分每页核心观点、正文和图表建议",
                "补充演讲备注和风险问题",
              ],
              output: ["逐页标题", "每页一个核心观点", "页面正文可直接复制", "备注和视觉建议分开"],
              checks: ["故事线是否连贯", "页数是否合理", "是否能支撑汇报目标"],
            }),
            permission: Permission.merge(defaults, officeSkillPermission("office-ppt"), user),
            options: officeAgentOptions({ displayName: "PPT生成", scene: "ppt", skill: "office-ppt" }),
            mode: "primary",
            native: true,
            color: "info",
          },
          "office-data": {
            name: "office-data",
            description: "办公模式 表格分析员工。用于 CSV/Excel 数据清洗、透视、趋势归因、图表建议和分析报告。",
            prompt: officeAgentPrompt({
              role: "表格分析",
              skill: "office-data",
              workflow: [
                "确认业务问题、数据范围和关键指标",
                "识别空值、重复、异常和字段口径问题",
                "按维度完成透视、趋势、对比和归因",
                "生成可核验结论、图表建议和行动建议",
              ],
              output: ["结论先行", "关键数字可核验", "数据口径清晰", "图表建议可执行"],
              checks: [
                "结论是否回答业务问题",
                "数字是否来自用户资料",
                "事实和推断是否区分",
                "图表建议是否说明类型和维度",
              ],
            }),
            permission: Permission.merge(defaults, officeSkillPermission("office-data"), user),
            options: officeAgentOptions({ displayName: "表格分析", scene: "data", skill: "office-data" }),
            mode: "primary",
            native: true,
            color: "primary",
          },
          "office-design": {
            name: "office-design",
            description: "办公模式 视觉设计员工。用于海报、封面、配图、品牌色板和视觉规范生成。",
            prompt: officeAgentPrompt({
              role: "视觉设计",
              skill: "office-design",
              workflow: [
                "确认设计目标、受众、渠道和品牌约束",
                "建立信息层级、构图和视觉基调",
                "确定具体色彩、字体和配图策略",
                "生成可执行的视觉规范和图片提示词",
              ],
              output: ["设计目标明确", "信息层级清晰", "色彩字体具体", "配图提示词可执行"],
              checks: ["是否回应设计目标", "是否给出具体视觉值", "是否区分可用素材和生成素材"],
            }),
            permission: Permission.merge(defaults, officeSkillPermission("office-design"), user),
            options: officeAgentOptions({ displayName: "视觉设计", scene: "design", skill: "office-design" }),
            mode: "primary",
            native: true,
            color: "secondary",
          },
          "office-web": {
            name: "office-web",
            description: "办公模式 网页看板员工。用于 HTML 数据看板、项目追踪页、客户工具页和演示站点。",
            prompt: officeAgentPrompt({
              role: "网页看板",
              skill: "office-web",
              workflow: [
                "确认页面目标、数据来源和目标用户",
                "设计信息架构、页面区块和交互",
                "生成语义化 HTML 结构和说明",
                "给出数据更新和迭代建议",
              ],
              output: ["语义化 HTML", "数据来源清晰", "页面区块完整", "交互说明可执行"],
              checks: ["页面是否回答业务问题", "数据是否有来源", "HTML 是否可直接使用"],
            }),
            permission: Permission.merge(defaults, officeSkillPermission("office-web"), user),
            options: officeAgentOptions({ displayName: "网页看板", scene: "web", skill: "office-web" }),
            mode: "primary",
            native: true,
            color: "warning",
          },
          "office-meeting": {
            name: "office-meeting",
            description: "办公模式 AI 会议员工。用于会议纪要、决议、行动项、负责人、截止时间、风险和会后跟进。",
            prompt: officeAgentPrompt({
              role: "AI 会议",
              skill: "office-meeting",
              workflow: [
                "识别会议主题和参会角色",
                "提取结论、决议、分歧和待确认事项",
                "拆分行动项、负责人和时间",
                "生成会后同步文本",
              ],
              output: ["会议摘要", "决议清单", "行动项表格", "会后邮件或群消息"],
              checks: ["负责人是否明确", "截止时间是否明确", "分歧和结论是否分开"],
            }),
            permission: Permission.merge(defaults, officeSkillPermission("office-meeting"), user),
            options: officeAgentOptions({ displayName: "AI 会议", scene: "meeting", skill: "office-meeting" }),
            mode: "primary",
            native: true,
            color: "accent",
          },
          "office-knowledge": {
            name: "office-knowledge",
            description: "办公模式 AI 资料库员工。用于资料摘要、多文档对比、知识索引、FAQ 和可复用项目知识沉淀。",
            prompt: officeAgentPrompt({
              role: "AI 资料库",
              skill: "office-knowledge",
              workflow: [
                "确认资料范围和核心问题",
                "提炼主题索引和关键观点",
                "对比差异、来源和证据",
                "生成 FAQ、追问线索和记忆建议",
              ],
              output: ["资料摘要", "主题索引", "来源线索", "可追问问题"],
              checks: ["是否保留来源", "确定信息和推断是否区分", "索引是否便于后续检索"],
            }),
            permission: Permission.merge(defaults, officeSkillPermission("office-knowledge"), user),
            options: officeAgentOptions({ displayName: "AI 资料库", scene: "knowledge", skill: "office-knowledge" }),
            mode: "primary",
            native: true,
            color: "primary",
          },
          "office-task": {
            name: "office-task",
            description: "办公模式 AI 任务员工。用于目标拆解、优先级、周计划、风险看板、依赖和执行节奏。",
            prompt: officeAgentPrompt({
              role: "AI 任务",
              skill: "office-task",
              workflow: [
                "确认目标、边界和时间约束",
                "拆解可执行任务",
                "判断优先级、依赖和风险",
                "生成执行节奏和跟进机制",
              ],
              output: ["任务清单", "P0/P1/P2 优先级", "负责人建议", "风险和依赖"],
              checks: ["任务是否可执行", "依赖是否明确", "优先级理由是否充分"],
            }),
            permission: Permission.merge(defaults, officeSkillPermission("office-task"), user),
            options: officeAgentOptions({ displayName: "AI 任务", scene: "task", skill: "office-task" }),
            mode: "primary",
            native: true,
            color: "warning",
          },
          "office-communication": {
            name: "office-communication",
            description: "办公模式 AI 沟通员工。用于邮件、回复、通知、商务表达、中英双语和语气改写。",
            prompt: officeAgentPrompt({
              role: "AI 沟通",
              skill: "office-communication",
              workflow: [
                "确认沟通对象、关系和目标",
                "判断语气、边界和禁用表达",
                "生成推荐正文和备选版本",
                "给出发送前检查",
              ],
              output: ["推荐正文", "正式版", "简短版", "发送前检查"],
              checks: ["语气是否匹配对象", "行动请求是否明确", "是否避免过度承诺"],
            }),
            permission: Permission.merge(defaults, officeSkillPermission("office-communication"), user),
            options: officeAgentOptions({
              displayName: "AI 沟通",
              scene: "communication",
              skill: "office-communication",
            }),
            mode: "primary",
            native: true,
            color: "secondary",
          },
          explore: {
            name: "explore",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                grep: "allow",
                glob: "allow",
                list: "allow",
                bash: "allow",
                webfetch: "allow",
                websearch: "allow",
                read: "allow",
                external_directory: readonlyExternalDirectory,
              }),
              user,
            ),
            description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
            prompt: PROMPT_EXPLORE,
            options: {
              category: "核心",
            },
            mode: "subagent",
            native: true,
          },
          ...(flags.experimentalScout
            ? {
                scout: {
                  name: "scout",
                  permission: Permission.merge(
                    defaults,
                    Permission.fromConfig({
                      "*": "deny",
                      grep: "allow",
                      glob: "allow",
                      webfetch: "allow",
                      websearch: "allow",
                      read: "allow",
                      repo_clone: "allow",
                      repo_overview: "allow",
                      external_directory: {
                        ...readonlyExternalDirectory,
                        [path.join(Global.Path.repos, "*")]: "allow",
                      },
                    }),
                    user,
                  ),
                  description: `Docs and dependency-source specialist. Use this when you need to inspect external documentation, clone dependency repositories into the managed cache, and research library implementation details without modifying the user's workspace.`,
                  prompt: PROMPT_SCOUT,
                  options: {},
                  mode: "subagent" as const,
                  native: true,
                },
              }
            : {}),
          "pulse-orchestrator": {
            name: "pulse-orchestrator",
            description: "运营主 Agent，分析用户意图并协调子 Agent 完成任务",
            mode: "primary",
            native: true,
            color: "#FF6B6B",
            prompt: PROMPT_PULSE_ORCHESTRATOR,
            permission: Permission.merge(
              defaults,
              user,
              Permission.fromConfig({
                mcp: {
                  "wechat-official": "allow",
                },
              }),
            ),
            options: {
              category: "运营",
              displayName: "运营主智能体",
            },
          },
          compaction: {
            name: "compaction",
            mode: "primary",
            native: true,
            hidden: true,
            prompt: PROMPT_COMPACTION,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            options: {
              category: "核心",
            },
          },
          title: {
            name: "title",
            mode: "primary",
            options: {
              category: "核心",
            },
            native: true,
            hidden: true,
            temperature: 0.5,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_TITLE,
          },
          summary: {
            name: "summary",
            mode: "primary",
            options: {
              category: "核心",
            },
            native: true,
            hidden: true,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_SUMMARY,
          },
          ...agencyAgents({ defaults, user }),
        }

        for (const [key, value] of Object.entries(cfg.agent ?? {})) {
          if (value.disable) {
            delete agents[key]
            continue
          }
          let item = agents[key]
          if (!item)
            item = agents[key] = {
              name: key,
              mode: "all",
              permission: Permission.merge(defaults, user),
              options: {},
              native: false,
            }
          if (value.model) item.model = Provider.parseModel(value.model)
          item.variant = value.variant ?? item.variant
          item.prompt = value.prompt ?? item.prompt
          item.description = value.description ?? item.description
          item.temperature = value.temperature ?? item.temperature
          item.topP = value.top_p ?? item.topP
          item.mode = value.mode ?? item.mode
          item.color = value.color ?? item.color
          item.hidden = value.hidden ?? item.hidden
          item.name = value.name ?? item.name
          item.steps = value.steps ?? item.steps
          item.options = mergeDeep(item.options, value.options ?? {})
          item.permission = Permission.merge(item.permission, Permission.fromConfig(value.permission ?? {}))
        }

        // Ensure Truncate.GLOB is allowed unless explicitly configured
        for (const name in agents) {
          const agent = agents[name]
          const explicit = agent.permission.some((r) => {
            if (r.permission !== "external_directory") return false
            if (r.action !== "deny") return false
            return r.pattern === Truncate.GLOB
          })
          if (explicit) continue

          agents[name].permission = Permission.merge(
            agents[name].permission,
            Permission.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
            builtInSkillPermission,
          )
        }

        const get = Effect.fnUntraced(function* (agent: string) {
          return agents[agent]
        })

        const list = Effect.fnUntraced(function* () {
          const cfg = yield* config.get()
          return pipe(
            agents,
            values(),
            sortBy(
              [(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"],
              [(x) => x.name, "asc"],
            ),
          )
        })

        const defaultInfo = Effect.fnUntraced(function* () {
          const c = yield* config.get()
          if (c.default_agent) {
            const agent = agents[c.default_agent]
            if (!agent) throw new Error(`default agent "${c.default_agent}" not found`)
            if (agent.mode === "subagent") throw new Error(`default agent "${c.default_agent}" is a subagent`)
            if (agent.hidden === true) throw new Error(`default agent "${c.default_agent}" is hidden`)
            return agent
          }
          const visible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
          if (!visible) throw new Error("no primary visible agent found")
          return visible
        })

        const defaultAgent = Effect.fnUntraced(function* () {
          return (yield* defaultInfo()).name
        })

        return {
          get,
          list,
          defaultInfo,
          defaultAgent,
        } satisfies State
      }),
    )

    const reload = Effect.fn("Agent.reload")(function* () {
      yield* config.invalidate()
      yield* InstanceState.invalidate(state)
      return yield* InstanceState.useEffect(state, (s) => s.list())
    })

    return Service.of({
      get: Effect.fn("Agent.get")(function* (agent: string) {
        return yield* InstanceState.useEffect(state, (s) => s.get(agent))
      }),
      list: Effect.fn("Agent.list")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.list())
      }),
      defaultInfo: Effect.fn("Agent.defaultInfo")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.defaultInfo())
      }),
      defaultAgent: Effect.fn("Agent.defaultAgent")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.defaultAgent())
      }),
      reload,
      generate: Effect.fn("Agent.generate")(function* (input: {
        description: string
        model?: { providerID: ProviderID; modelID: ModelID }
      }) {
        const cfg = yield* config.get()
        const model = input.model ?? (yield* provider.defaultModel())
        const resolved = yield* provider.getModel(model.providerID, model.modelID)
        const language = yield* provider.getLanguage(resolved)
        const tracer = cfg.experimental?.openTelemetry
          ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
          : undefined

        const system = [PROMPT_GENERATE]
        yield* plugin.trigger("experimental.chat.system.transform", { model: resolved }, { system })
        const existing = yield* InstanceState.useEffect(state, (s) => s.list())

        // TODO: clean this up so provider specific logic doesnt bleed over
        const authInfo = yield* auth.get(model.providerID).pipe(Effect.orDie)
        const isOpenaiOauth = model.providerID === "openai" && authInfo?.type === "oauth"

        const params = {
          experimental_telemetry: {
            isEnabled: cfg.experimental?.openTelemetry,
            tracer,
            metadata: {
              userId: cfg.username ?? "unknown",
            },
          },
          temperature: 0.3,
          messages: [
            ...(isOpenaiOauth
              ? []
              : system.map(
                  (item): ModelMessage => ({
                    role: "system",
                    content: item,
                  }),
                )),
            {
              role: "user",
              content: `Create an agent configuration based on this request: "${input.description}".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
            },
          ],
          model: language,
          schema: Object.assign(
            Schema.toStandardSchemaV1(GeneratedAgent),
            Schema.toStandardJSONSchemaV1(GeneratedAgent),
          ),
        } satisfies Parameters<typeof generateObject>[0]

        if (isOpenaiOauth) {
          return yield* Effect.promise(async () => {
            const result = streamObject({
              ...params,
              providerOptions: ProviderTransform.providerOptions(resolved, {
                instructions: system.join("\n"),
                store: false,
              }),
              onError: () => {},
            })
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error
            }
            return result.object
          })
        }

        return yield* Effect.promise(() => generateObject(params).then((r) => r.object))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Plugin.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

export * as Agent from "./agent"
