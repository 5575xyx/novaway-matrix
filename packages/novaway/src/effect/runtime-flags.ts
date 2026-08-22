import { Config, ConfigProvider, Context, Effect, Layer } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
const experimental = bool("NovaWay_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: bool(name) }).pipe(Config.map((flags) => flags.experimental || flags.enabled))

export class Service extends ConfigService.Service<Service>()("@NovaWay/RuntimeFlags", {
  autoShare: bool("NovaWay_AUTO_SHARE"),
  pure: bool("NovaWay_PURE"),
  disableDefaultPlugins: bool("NovaWay_DISABLE_DEFAULT_PLUGINS"),
  disableChannelDb: bool("NovaWay_DISABLE_CHANNEL_DB"),
  disableEmbeddedWebUi: bool("NovaWay_DISABLE_EMBEDDED_WEB_UI"),
  disableExternalSkills: bool("NovaWay_DISABLE_EXTERNAL_SKILLS"),
  disableLspDownload: bool("NovaWay_DISABLE_LSP_DOWNLOAD"),
  skipMigrations: bool("NovaWay_SKIP_MIGRATIONS"),
  disableClaudeCodePrompt: Config.all({
    broad: bool("NovaWay_DISABLE_CLAUDE_CODE"),
    direct: bool("NovaWay_DISABLE_CLAUDE_CODE_PROMPT"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableClaudeCodeSkills: Config.all({
    broad: bool("NovaWay_DISABLE_CLAUDE_CODE"),
    direct: bool("NovaWay_DISABLE_CLAUDE_CODE_SKILLS"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  enableExa: Config.all({
    experimental,
    enabled: bool("NovaWay_ENABLE_EXA"),
    legacy: bool("NovaWay_EXPERIMENTAL_EXA"),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
  enableParallel: Config.all({
    enabled: bool("NovaWay_ENABLE_PARALLEL"),
    legacy: bool("NovaWay_EXPERIMENTAL_PARALLEL"),
  }).pipe(Config.map((flags) => flags.enabled || flags.legacy)),
  enableExperimentalModels: bool("NovaWay_ENABLE_EXPERIMENTAL_MODELS"),
  enableQuestionTool: bool("NovaWay_ENABLE_QUESTION_TOOL"),
  experimentalScout: enabledByExperimental("NovaWay_EXPERIMENTAL_SCOUT"),
  experimentalBackgroundSubagents: enabledByExperimental("NovaWay_EXPERIMENTAL_BACKGROUND_SUBAGENTS"),
  experimentalLspTy: bool("NovaWay_EXPERIMENTAL_LSP_TY"),
  experimentalLspTool: enabledByExperimental("NovaWay_EXPERIMENTAL_LSP_TOOL"),
  experimentalOxfmt: enabledByExperimental("NovaWay_EXPERIMENTAL_OXFMT"),
  experimentalPlanMode: enabledByExperimental("NovaWay_EXPERIMENTAL_PLAN_MODE"),
  experimentalEventSystem: enabledByExperimental("NovaWay_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalWorkspaces: enabledByExperimental("NovaWay_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("NovaWay_EXPERIMENTAL_ICON_DISCOVERY"),
  outputTokenMax: positiveInteger("NovaWay_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  bashDefaultTimeoutMs: positiveInteger("NovaWay_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  client: Config.string("NovaWay_CLIENT").pipe(Config.withDefault("cli")),
}) {}

export type Info = Context.Service.Shape<typeof Service>

const emptyConfigLayer = Service.defaultLayer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  Layer.orDie,
)

export const layer = (overrides: Partial<Info> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const flags = yield* Service
      return Service.of({ ...flags, ...overrides })
    }),
  ).pipe(Layer.provide(emptyConfigLayer))

export const defaultLayer = Service.defaultLayer.pipe(Layer.orDie)

export * as RuntimeFlags from "./runtime-flags"
