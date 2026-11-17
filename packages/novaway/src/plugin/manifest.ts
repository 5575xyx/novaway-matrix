import type {
  ActivationEvent,
  Contributes,
  ContributesKey,
  Manifest,
  McpServerContribution,
  PluginCapabilities,
  PreviewContribution,
  SurfaceAction,
  SurfaceContribution,
  ViewRender,
  PluginKind,
  ToolDeclaration,
} from "@novaway/plugin-api"
import { contributesKeys } from "@novaway/plugin-api"
import { CONVENTIONAL } from "@/extension/schema"
import { isRecord } from "@/util/record"
import { isPathPluginSpec, parsePluginSpecifier } from "./shared"

/**
 * Manifest v2 的解析与旧机制归一化（§7、§13.1、§14.3 第 3 步）。
 *
 * 只做「原始输入 → 同一结构」这一步：不碰磁盘、不装 npm、不激活（那是 §14.3 第 4 步的 host）。
 * 因此这里的函数全是纯函数，可以直接拿真实样本单测，也可以在 shadow 模式里反复调用对比。
 */

/** 四个来源对应 §13.1 的四个适配器（`legacy-hooks` / `legacy-tui` 在加载期，不归本文件）。 */
export type ManifestSource = "v2" | "extension" | "claude" | "config-plugin"

export type IssueCode =
  | "manifest_shape"
  | "name_missing"
  | "name_invalid"
  | "name_normalized"
  | "api_version"
  | "main_missing"
  | "unmapped_field"
  | "contributes_unknown_key"
  | "contribution_incomplete"
  | "contribution_duplicate"
  | "capability_unknown"
  | "activation_event_invalid"
  | "version_format"

export type Issue = { level: "error" | "warning"; code: IssueCode; message: string; field?: string }

export type Decoded = { manifest: Manifest; source: ManifestSource; issues: Issue[] }

export type ParseInput = {
  /** §7.1 的文件名；只用来区分 `.claude-plugin` 的字段习惯，其余走 extension 形状。 */
  file: string
  /** 读不到 `name` 时（比如 manifest 坏了）由调用方给出的目录名兜底。 */
  fallbackName?: string
}

/** §7.2：插件 id 用字母、数字、`-`、`_`，首字符不能是分隔符。 */
const NAME_CHARSET = /^[a-z0-9][a-z0-9_-]*$/

const FS_SCOPES = ["plugin-data", "workspace-read", "workspace-write"] as const
type FsScope = NonNullable<PluginCapabilities["fs"]>[number]

const DIR_KEYS = ["commands", "agents", "skills"] as const

const ACTIVATION_PREFIXES = [
  "onTool",
  "onCommand",
  "onProvider",
  "onView",
  "onPreview",
  "onEvent",
  "onTrigger",
] as const

export function parseFile(raw: unknown, input: ParseInput): Decoded {
  if (!isRecord(raw))
    return broken(input, [error("manifest_shape", `manifest 不是对象（${typeof raw}），已按空清单处理`)])
  const apiVersion = typeof raw.apiVersion === "number" ? raw.apiVersion : 1
  if (apiVersion >= 2) return parseV2(raw, apiVersion, input.fallbackName)
  return parseLegacy(raw, input.file.includes(".claude-plugin") ? "claude" : "extension", input.fallbackName)
}

/**
 * `config.plugin` 的 spec（§13.1 的 `legacy-config-plugin`）。
 *
 * 这一路没有 JSON manifest：spec 只回答「装哪个」，插件 id 与贡献要等模块加载完才知道。
 * 所以产出的是**安装实例**描述，`contributes` 为空，`legacy` 带上原始 spec 与来源。
 */
export function parseConfigSpec(
  spec: unknown,
  input: { source?: string; scope?: "global" | "local"; name?: string } = {},
) {
  const issue: Issue[] = []
  const pair = Array.isArray(spec) ? [spec[0], spec[1]] : [spec, undefined]
  const text = typeof pair[0] === "string" ? pair[0] : ""
  if (!text)
    return {
      ...broken({ file: "config.plugin" }, [
        error("manifest_shape", "config.plugin 的条目不是字符串或 [字符串, 选项]"),
      ]),
      spec: pair[0],
    }
  const options = isRecord(pair[1]) ? pair[1] : undefined
  if (pair[1] !== undefined && options === undefined) {
    issue.push(warning("unmapped_field", "config.plugin 的选项不是对象，已忽略", "options"))
  }
  const guessed = isPathPluginSpec(text) ? "" : parsePluginSpecifier(text).pkg
  const name = readName(
    {
      value: input.name ?? guessed,
      missing: `路径型插件 "${text}" 的 id 要等模块加载后才知道：模块必须导出 id（§13.1、shared.ts 的 resolvePluginId）`,
    },
    issue,
  )
  if (name !== "" && input.name === undefined && !isPathPluginSpec(text)) {
    issue.push(warning("name_normalized", `插件 id "${name}" 由 spec 猜出，安装后以模块导出的 id 为准`, "name"))
  }

  const manifest: Manifest = {
    name,
    apiVersion: 1,
    kind: "code",
    contributes: {},
    legacy: {
      adapter: "legacy-config-plugin",
      spec: text,
      options,
      origin: input.source,
      scope: input.scope,
    },
  }
  return { manifest, source: "config-plugin" as const, issues: issue }
}

export function errors(issues: Issue[]) {
  return issues.filter((item) => item.level === "error")
}

export function warnings(issues: Issue[]) {
  return issues.filter((item) => item.level === "warning")
}

function parseLegacy(raw: Record<string, unknown>, source: "extension" | "claude", fallbackName?: string): Decoded {
  const issues: Issue[] = []
  const contributes = isRecord(raw.contributes) ? raw.contributes : {}
  const unmapped: string[] = []
  const fallback: string[] = []
  const out: Contributes = {}

  // contributes.X 优先于顶层 X，与旧 extension 加载器（extension/schema.ts 的 contributions()）同一套优先级，
  // 否则 shadow 模式对比出来的差异是归一化自己造的。
  for (const key of DIR_KEYS) {
    const declared = strings(contributes[key] ?? raw[key])
    if (declared === undefined && (contributes[key] !== undefined || raw[key] !== undefined)) {
      issues.push(warning("unmapped_field", `${key} 不是字符串或字符串数组，改用约定目录`, key))
    }
    const paths = declared !== undefined && declared.length > 0 ? declared : CONVENTIONAL[key]
    if (declared === undefined || declared.length === 0) fallback.push(key)
    assignList(out, key, [...paths], issues)
  }

  const toolDirs = strings(contributes.tools ?? raw.tools)
  if (toolDirs !== undefined && toolDirs.length > 0) {
    unmapped.push("tools")
    issues.push(
      warning(
        "unmapped_field",
        `旧 tools 声明（${toolDirs.join(", ")}）只有目录，没有 description/parameters：v2 索引期看不见（§6.5），D1 要过必须改写为贡献声明`,
        "tools",
      ),
    )
  }

  const hooks = strings(contributes.hooks)?.[0] ?? (typeof raw.hooks === "string" ? raw.hooks : undefined)
  if (hooks !== undefined) out.lifecycleHooks = hooks
  else if (isRecord(raw.hooks)) unmapped.push("hooks")
  else if (contributes.hooks !== undefined) unmapped.push("contributes.hooks")

  const serverList = contributes.mcpServers ?? raw.mcpServers
  if (isRecord(serverList)) {
    const servers: Record<string, Omit<McpServerContribution, "id">> = {}
    const dropped: string[] = []
    for (const [id, value] of Object.entries(serverList)) {
      const entry = mcpServer(id, value, issues)
      if (entry === undefined) {
        issues.push(
          warning("contribution_incomplete", `MCP "${id}" 既没有 command 也没有 url，已丢弃`, `mcpServers.${id}`),
        )
        continue
      }
      servers[id] = entry.config
      dropped.push(...entry.dropped.map((field) => `${id}.${field}`))
    }
    out.mcpServers = servers
    if (dropped.length > 0) {
      unmapped.push("mcpServers")
      issues.push(
        warning(
          "unmapped_field",
          `MCP 的 ${dropped.join(", ")} 在 v2 的 McpServerContribution 里没有位置（§13.1）：enabled 属用户态，timeout/oauth 待贡献点补齐`,
          "mcpServers",
        ),
      )
    }
  } else if (serverList !== undefined) {
    unmapped.push("mcpServers")
  }

  const outputStyles = contributes.outputStyles
  if (typeof outputStyles === "string") out.outputStyles = outputStyles
  else if (outputStyles !== undefined) unmapped.push("outputStyles")

  // v2 的 lspServers 是文件路径（§7.4），旧机制是内联 Record —— 只能留给 legacy
  const lspServers = contributes.lspServers
  if (typeof lspServers === "string") out.lspServers = lspServers
  else if (lspServers !== undefined) unmapped.push("lspServers")

  const capabilities = mapPermissions(raw, issues)
  const keywords = strings(raw.keywords)
  const name = readName({ value: typeof raw.name === "string" ? raw.name : "", fallback: fallbackName }, issues)

  const manifest: Manifest = {
    name,
    apiVersion: 1,
    kind: inferKind(raw, issues),
    contributes: out,
    // 旧字段照抄一份到 legacy，host 才能在不丢行为的前提下跑 shadow 对比；
    // unmapped 里是 v2 还没地方放的字段，fallback 里是 CONVENTIONAL 补出来的键。
    legacy: { adapter: "legacy-extension", raw, unmapped, fallback },
  }
  const version = readVersion(raw, issues)
  if (version !== undefined) manifest.version = version
  const main = typeof raw.main === "string" ? raw.main : undefined
  if (main !== undefined) manifest.main = main
  const engines = isRecord(raw.engines) ? raw.engines : undefined
  if (typeof engines?.novaway === "string") manifest.engines = { novaway: engines.novaway }
  const dependencies = isRecord(raw.dependencies) ? raw.dependencies : undefined
  if (dependencies) manifest.dependencies = toStringRecord(dependencies, issues, "dependencies")
  const conflicts = strings(raw.conflicts)
  if (conflicts !== undefined) manifest.conflicts = conflicts
  if (capabilities !== undefined) manifest.capabilities = capabilities
  if (keywords !== undefined && keywords.length > 0) manifest.categories = keywords
  if (typeof raw.license === "string") manifest.license = raw.license
  if (typeof raw.description === "string") manifest.description = raw.description
  if (typeof raw.manifestVersion === "number") manifest.manifestVersion = raw.manifestVersion
  if (unmapped.length > 0 || fallback.length > 0)
    issues.push(
      warning(
        "unmapped_field",
        `归一化后仍留在 legacy 里：unmapped=${unmapped.join(",") || "无"}，fallback=${fallback.join(",") || "无"}`,
      ),
    )

  return { manifest, source, issues }
}

function parseV2(raw: Record<string, unknown>, apiVersion: number, fallbackName?: string): Decoded {
  const issues: Issue[] = []
  if (apiVersion !== 2) {
    issues.push(
      error("api_version", `还不支持 apiVersion=${apiVersion}，当前宿主只实现 v2；按 v2 尽力解析`, "apiVersion"),
    )
  }
  const name = readName({ value: typeof raw.name === "string" ? raw.name : "", fallback: fallbackName }, issues)
  const kind = readKind(raw, issues)
  const manifest: Manifest = {
    name,
    apiVersion,
    kind,
    contributes: readContributes(raw, issues, name),
  }
  const version = readVersion(raw, issues)
  if (version !== undefined) manifest.version = version
  const main = typeof raw.main === "string" ? raw.main : undefined
  if (main !== undefined) manifest.main = main
  if (main === undefined && (manifest.kind === "code" || manifest.kind === "mixed")) {
    issues.push(error("main_missing", `kind=${manifest.kind} 必须有 main 入口`, "main"))
  }
  const engines = isRecord(raw.engines) ? raw.engines : undefined
  if (typeof engines?.novaway === "string") manifest.engines = { novaway: engines.novaway }
  const activation = strings(raw.activationEvents)
  if (activation !== undefined) manifest.activationEvents = checkActivation(activation, issues)
  else if (raw.activationEvents !== undefined) {
    issues.push(warning("unmapped_field", "activationEvents 不是字符串数组，已忽略", "activationEvents"))
  }
  const dependencies = isRecord(raw.dependencies) ? raw.dependencies : undefined
  if (dependencies) manifest.dependencies = toStringRecord(dependencies, issues, "dependencies")
  const capabilities = readCapabilities(raw.capabilities, issues)
  if (capabilities !== undefined) manifest.capabilities = capabilities
  const categories = strings(raw.categories)
  if (categories !== undefined) manifest.categories = categories
  const overrides = strings(raw.overrides)
  if (overrides !== undefined) manifest.overrides = checkOverrides(overrides, issues)
  const priority = typeof raw.priority === "number" ? raw.priority : undefined
  if (priority !== undefined) manifest.priority = priority
  if (typeof raw.license === "string") manifest.license = raw.license
  if (typeof raw.description === "string") manifest.description = raw.description

  return { manifest, source: "v2", issues }
}

/**
 * `name` 的读法。大小写不合规时小写化并给 warning——§13.4 要求迁移期出别名表，
 * 现存的 `PowersNexus@git+...` 就是这一类。
 */
function readName(input: { value: string; fallback?: string; missing?: string }, issues: Issue[]): string {
  const trimmed = input.value.trim()
  if (trimmed) return normalizeName(trimmed, issues)
  const fallback = input.fallback?.trim() ?? ""
  if (fallback) {
    issues.push(
      warning("name_normalized", `manifest 缺 name，用调用方给的目录名 "${fallback}" 兜底（§4.8 同名会撞）`, "name"),
    )
    return normalizeName(fallback, issues)
  }
  issues.push(
    error("name_missing", input.missing ?? "manifest 缺 name：插件 id 是贡献点命名空间的前缀，猜不得", "name"),
  )
  return ""
}

function normalizeName(value: string, issues: Issue[]): string {
  // npm scope 与 §7.2 的字符集天然冲突：`@scope/plug` 拼进工具名会变成 `@scope/plug_tool`。
  // 这里把 scope 折叠成前缀，其余不合规字符一律 name_invalid（§13.4 的别名表要覆盖这一类）。
  const scoped = /^@([^/]+)\/(.+)$/.exec(value)
  const folded = scoped === null ? value : `${scoped[1]}_${scoped[2]}`
  const lowered = folded.toLowerCase()
  if (!NAME_CHARSET.test(lowered)) {
    issues.push(error("name_invalid", `插件 id "${value}" 只能用字母、数字、- 和 _，且不能以分隔符开头`, "name"))
    return lowered
  }
  if (lowered !== value) {
    issues.push(
      warning(
        "name_normalized",
        `插件 id "${value}" 归一化为 "${lowered}"；迁移期需要别名表，否则提示词里的工具名会断（§13.4）`,
        "name",
      ),
    )
  }
  return lowered
}

function readVersion(raw: Record<string, unknown>, issues: Issue[]) {
  if (raw.version === undefined) return undefined
  if (typeof raw.version !== "string") {
    issues.push(warning("version_format", "version 不是字符串，已忽略", "version"))
    return undefined
  }
  if (!/^\d+(\.\d+){0,2}([-+][0-9A-Za-z-.]+)?$/.test(raw.version)) {
    issues.push(warning("version_format", `version "${raw.version}" 不是 semver，依赖范围比较会失效`, "version"))
  }
  return raw.version
}

function inferKind(raw: Record<string, unknown>, issues: Issue[]) {
  const declared = readKind(raw, issues)
  if (declared !== undefined) return declared
  return typeof raw.main === "string" ? "code" : "declarative"
}

function readKind(raw: Record<string, unknown>, issues: Issue[]): PluginKind | undefined {
  if (raw.kind === undefined) return undefined
  if (raw.kind === "declarative" || raw.kind === "code" || raw.kind === "mixed") return raw.kind
  issues.push(warning("unmapped_field", `kind ${display(raw.kind)} 不是 declarative/code/mixed，已忽略`, "kind"))
  return undefined
}

const SURFACE_SLOTS = new Set([
  "sidebar.item",
  "sidebar.footer",
  "settings.section",
  "session.panel",
  "message.part.renderer",
  "composer.action",
  "statusbar.item",
  "home.card",
  "notification.item",
])

function webUrl(value: unknown) {
  if (typeof value !== "string") return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined
  } catch {
    return undefined
  }
}

function renderDeclaration(value: unknown, issues: Issue[], field: string): ViewRender | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    issues.push(error("contribution_incomplete", `${field} 必须声明 type 和 render 配置`, field))
    return undefined
  }
  if (value.type === "builtin" && typeof value.component === "string" && value.component.length > 0) {
    return { type: "builtin", component: value.component }
  }
  if (value.type === "iframe") {
    const url = webUrl(value.url)
    if (url !== undefined) return { type: "iframe", url }
    issues.push(error("contribution_incomplete", `${field}.url 只允许 http(s) URL`, `${field}.url`))
    return undefined
  }
  issues.push(error("contribution_incomplete", `${field}.type 只能是 builtin 或 iframe`, `${field}.type`))
  return undefined
}

function actionDeclaration(value: unknown, issues: Issue[], field: string): SurfaceAction | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    issues.push(error("contribution_incomplete", `${field} 必须声明 type`, field))
    return undefined
  }
  if (value.type === "view" && typeof value.viewId === "string" && value.viewId.length > 0) {
    const render = value.render === undefined ? undefined : renderDeclaration(value.render, issues, `${field}.render`)
    if (value.render !== undefined && render === undefined) return undefined
    return { type: "view", viewId: value.viewId, ...(render === undefined ? {} : { render }) }
  }
  if (value.type === "command" && typeof value.command === "string" && value.command.length > 0) {
    if (/^(settings|session|plugin)\./.test(value.command)) {
      issues.push(
        error("contribution_incomplete", `${field}.command 不能引用宿主命令：${value.command}`, `${field}.command`),
      )
      return undefined
    }
    return { type: "command", command: value.command }
  }
  if (value.type === "url") {
    const url = webUrl(value.url)
    if (url !== undefined) return { type: "url", url }
  }
  issues.push(error("contribution_incomplete", `${field} 不是合法的 view、command 或 http(s) url action`, field))
  return undefined
}

function surfaceDeclaration(value: unknown, issues: Issue[], index: number): SurfaceContribution[] {
  const field = `surfaces[${index}]`
  if (!isRecord(value)) {
    issues.push(error("contribution_incomplete", `${field} 必须是对象`, field))
    return []
  }
  const slot = value.slot
  const id = typeof value.id === "string" && value.id.length > 0 ? value.id : undefined
  if (typeof slot !== "string" || !SURFACE_SLOTS.has(slot)) {
    issues.push(error("contribution_incomplete", `${field}.slot 不是受支持的 Surface slot`, `${field}.slot`))
    return []
  }
  if (id === undefined) {
    issues.push(error("contribution_incomplete", `${field}.id 缺失`, `${field}.id`))
    return []
  }
  if (value.order !== undefined && (typeof value.order !== "number" || !Number.isFinite(value.order))) {
    issues.push(error("contribution_incomplete", `${field}.order 必须是有限数字`, `${field}.order`))
    return []
  }
  if (slot === "message.part.renderer") {
    const match = isRecord(value.match) ? value.match : undefined
    const renderer = isRecord(value.renderer) ? value.renderer : undefined
    if (!match || (!("tool" in match) && !("partType" in match)) || !renderer) {
      issues.push(error("contribution_incomplete", `${field} 必须同时声明 match 与 renderer`, field))
      return []
    }
    if (renderer.type === "iframe") {
      const parsed = renderDeclaration(renderer, issues, `${field}.renderer`)
      if (parsed?.type !== "iframe") return []
    } else if (renderer.type !== "builtin" || typeof renderer.id !== "string" || renderer.id.length === 0) {
      issues.push(error("contribution_incomplete", `${field}.renderer 不是合法 renderer`, `${field}.renderer`))
      return []
    }
    return [value as SurfaceContribution]
  }
  if (slot === "settings.section") {
    if (typeof value.title !== "string" || !isRecord(value.view)) {
      issues.push(error("contribution_incomplete", `${field} 必须声明 title 与 view`, field))
      return []
    }
    const view = value.view
    if (view.type === "declarative" && Array.isArray(view.fields)) return [value as SurfaceContribution]
    if (view.type === "iframe" || view.type === "view") {
      if (view.type === "view" && (typeof view.viewId !== "string" || view.viewId.length === 0)) {
        issues.push(error("contribution_incomplete", `${field}.view.viewId 缺失`, `${field}.view.viewId`))
        return []
      }
      if (view.type === "iframe" && renderDeclaration(view, issues, `${field}.view`) === undefined) return []
      if (
        view.type === "view" &&
        view.render !== undefined &&
        renderDeclaration(view.render, issues, `${field}.view.render`) === undefined
      )
        return []
      return [value as SurfaceContribution]
    }
    issues.push(error("contribution_incomplete", `${field}.view 不是合法 view`, `${field}.view`))
    return []
  }
  if (typeof value.title !== "string") {
    issues.push(error("contribution_incomplete", `${field}.title 缺失`, `${field}.title`))
    return []
  }
  const action = actionDeclaration(value.action, issues, `${field}.action`)
  if (action === undefined) return []
  return [value as SurfaceContribution]
}

function previewerDeclaration(value: unknown, issues: Issue[], index: number): PreviewContribution[] {
  const field = `previewers[${index}]`
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0 || !isRecord(value.match)) {
    issues.push(error("contribution_incomplete", `${field} 必须声明 id 与 match`, field))
    return []
  }
  const render = value.render === undefined ? undefined : renderDeclaration(value.render, issues, `${field}.render`)
  if (value.render !== undefined && render === undefined) return []
  const viewId = typeof value.viewId === "string" && value.viewId.length > 0 ? value.viewId : undefined
  if (viewId === undefined && render === undefined) {
    issues.push(error("contribution_incomplete", `${field} 必须声明 viewId 或 render`, field))
    return []
  }
  if (value.priority !== undefined && (typeof value.priority !== "number" || !Number.isFinite(value.priority))) {
    issues.push(error("contribution_incomplete", `${field}.priority 必须是有限数字`, `${field}.priority`))
    return []
  }
  if (value.order !== undefined && (typeof value.order !== "number" || !Number.isFinite(value.order))) {
    issues.push(error("contribution_incomplete", `${field}.order 必须是有限数字`, `${field}.order`))
    return []
  }
  return [value as PreviewContribution]
}

function readContributes(raw: Record<string, unknown>, issues: Issue[], pluginName: string): Contributes {
  const value = isRecord(raw.contributes) ? raw.contributes : {}
  if (raw.contributes !== undefined && !isRecord(raw.contributes)) {
    issues.push(error("contribution_incomplete", "contributes 不是对象，所有贡献都读不出来", "contributes"))
  }
  for (const key of Object.keys(value)) {
    if ((contributesKeys as readonly string[]).includes(key)) continue
    issues.push(
      warning(
        "contributes_unknown_key",
        `contributes.${key} 不是已知贡献点（§3 全集共 ${contributesKeys.length} 项），已忽略`,
        key,
      ),
    )
  }
  const out: Contributes = {}
  const tools = Array.isArray(value.tools) ? value.tools : undefined
  if (tools !== undefined) {
    const seen = new Set<string>()
    out.tools = tools.flatMap((item) => toolDeclaration(item, seen, issues, pluginName))
  } else if (value.tools !== undefined) {
    issues.push(warning("unmapped_field", "contributes.tools 不是数组，已忽略", "tools"))
  }
  for (const key of DIR_KEYS) {
    const declared = value[key]
    if (declared === undefined) continue
    assignList(out, key, declared, issues)
  }
  if (typeof value.lifecycleHooks === "string") out.lifecycleHooks = value.lifecycleHooks
  if (typeof value.interceptors === "string") out.interceptors = value.interceptors
  if (typeof value.outputStyles === "string") out.outputStyles = value.outputStyles
  if (typeof value.lspServers === "string") out.lspServers = value.lspServers
  if (isRecord(value.mcpServers)) {
    const servers: Record<string, Omit<McpServerContribution, "id">> = {}
    for (const [id, entry] of Object.entries(value.mcpServers)) {
      const mapped = mcpServer(id, entry, issues)
      if (mapped === undefined) {
        issues.push(
          warning("contribution_incomplete", `MCP "${id}" 既没有 command 也没有 url，已丢弃`, `mcpServers.${id}`),
        )
        continue
      }
      if (mapped.dropped.length > 0) {
        issues.push(
          warning(
            "unmapped_field",
            `MCP "${id}" 的 ${mapped.dropped.join(", ")} 在 v2 贡献点里没有位置`,
            `mcpServers.${id}`,
          ),
        )
      }
      servers[id] = mapped.config
    }
    out.mcpServers = servers
  }
  if (isRecord(value.storage)) {
    const namespace = value.storage.namespace
    const migrations = value.storage.migrations
    if (typeof namespace === "string" && typeof migrations === "string") out.storage = { namespace, migrations }
    else {
      issues.push(
        error(
          "contribution_incomplete",
          "storage 必须同时给 namespace 与 migrations：namespace 是 KV 越权检查的边界（§5.4）",
          "storage",
        ),
      )
    }
  }
  if (value.surfaces !== undefined) {
    if (!Array.isArray(value.surfaces)) {
      issues.push(warning("unmapped_field", "contributes.surfaces 不是数组，已忽略", "surfaces"))
    } else {
      out.surfaces = value.surfaces.flatMap((item, index) => surfaceDeclaration(item, issues, index))
    }
  }
  if (value.previewers !== undefined) {
    if (!Array.isArray(value.previewers)) {
      issues.push(warning("unmapped_field", "contributes.previewers 不是数组，已忽略", "previewers"))
    } else {
      out.previewers = value.previewers.flatMap((item, index) => previewerDeclaration(item, issues, index))
    }
  }
  const listKeys = [
    "providers",
    "publishDrivers",
    "httpRoutes",
    "officeEngines",
    "triggers",
    "fastPath",
    "routingPolicies",
    "workerTypes",
    "watchdogPolicies",
    "channels",
    "schedulers",
    "eventSources",
    "agentRuntimes",
    "superAgentStrategies",
    "taskKinds",
    "verifiers",
    "repairStrategies",
    "agentTemplates",
    "superAgentPolicies",
    "superAgentSurfaces",
  ] as const
  for (const key of listKeys) {
    const declared = value[key]
    if (declared === undefined) continue
    assignList(out, key, declared, issues)
  }
  return out
}

/** 深层校验留给注册表（§4.1 的 contribution_invalid），这里只保证形状是数组。 */
function assignList(out: Contributes, key: ContributesKey, value: unknown, issues: Issue[]) {
  const list = strings(value)
  if (list !== undefined) {
    if (!Array.isArray(value)) {
      issues.push(warning("unmapped_field", `contributes.${key} 写成单个字符串，已按单元素数组处理`, key))
    }
    Object.assign(out, { [key]: list })
    return
  }
  if (Array.isArray(value)) {
    Object.assign(out, { [key]: value })
    return
  }
  issues.push(warning("unmapped_field", `contributes.${key} 不是数组，已忽略`, key))
}

function toolDeclaration(item: unknown, seen: Set<string>, issues: Issue[], pluginName: string) {
  if (!isRecord(item)) {
    issues.push(warning("contribution_incomplete", "tools 的条目不是对象，已丢弃", "tools"))
    return []
  }
  const id = typeof item.id === "string" ? item.id : ""
  if (!id) {
    issues.push(error("contribution_incomplete", "工具声明缺 id", "tools"))
    return []
  }
  const final = pluginName ? `${pluginName}_${id}` : id
  if (seen.has(id)) {
    issues.push(error("contribution_duplicate", `工具 id "${final}" 重复声明`, "tools"))
    return []
  }
  seen.add(id)
  if (typeof item.description !== "string" || !isRecord(item.parameters)) {
    issues.push(
      warning(
        "contribution_incomplete",
        `工具 "${final}" 缺 description 或 parameters：索引期拼不出工具块，模型看不见它（§4.2、§6.5）`,
        "tools",
      ),
    )
  }
  if (item.entry !== undefined && typeof item.entry !== "string") {
    issues.push(warning("contribution_incomplete", `工具 "${final}" 的 entry 不是字符串`, "tools"))
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 上面只查了 id/description/parameters 的形状，ToolDeclaration 的其余字段留给注册表在激活期深校验（§4.1）。
  return [{ ...item, id } as ToolDeclaration]
}

/**
 * MCP 条目。v2 只有 `type/command/env/headers/eager`（§7.4、contributions.ts），
 * 而现存写法是 Claude 那一套：`command` 是字符串加独立的 `args`，`type` 写 `stdio`/`sse`/`http`。
 * `enabled`/`timeout`/`oauth` 是用户态或宿主态，v2 贡献点里还没有位置，只能报出来留给 host。
 */
function mcpServer(id: string, value: unknown, issues: Issue[]) {
  if (!isRecord(value)) return undefined
  const head = strings(value.command)
  const command = head === undefined ? undefined : [...head, ...(strings(value.args) ?? [])]
  const url = typeof value.url === "string" ? value.url : undefined
  if (command === undefined && url === undefined) return undefined
  const derived: "local" | "remote" = command !== undefined ? "local" : "remote"
  const type = mcpType(value.type, derived, id, issues)
  const config: Omit<McpServerContribution, "id"> = { type }
  if (command !== undefined) config.command = command
  if (url !== undefined) config.url = url
  const env = isRecord(value.env) ? value.env : isRecord(value.environment) ? value.environment : undefined
  if (env !== undefined) config.env = toStringRecord(env, issues, `mcpServers.${id}.env`)
  if (isRecord(value.headers)) config.headers = toStringRecord(value.headers, issues, `mcpServers.${id}.headers`)
  if (typeof value.eager === "boolean") config.eager = value.eager
  return { config, dropped: ["enabled", "timeout", "oauth"].filter((field) => value[field] !== undefined) }
}

/** 现存写法（Claude 那一套）的 type 别名；v2 只认 local/remote，其余按 command/url 推出来的结果走。 */
function mcpType(value: unknown, derived: "local" | "remote", id: string, issues: Issue[]): "local" | "remote" {
  if (value === undefined) return derived
  if (value === "local" || value === "remote") return value
  if (value === "stdio") return "local"
  if (value === "sse" || value === "http") return "remote"
  issues.push(
    warning(
      "unmapped_field",
      `MCP "${id}" 的 type ${display(value)} 不认识，按 ${derived} 处理`,
      `mcpServers.${id}.type`,
    ),
  )
  return derived
}

function mapPermissions(raw: Record<string, unknown>, issues: Issue[]) {
  const permissions = raw.permissions
  if (!isRecord(permissions)) return undefined
  const out: PluginCapabilities = {}
  const tools = strings(permissions.tools)
  if (tools !== undefined) out.tools = tools
  const network = strings(permissions.network)
  if (network !== undefined) out.network = network
  const fs = strings(permissions.filesystem)
  if (fs !== undefined) {
    out.fs = fs.filter((item): item is FsScope => (FS_SCOPES as readonly string[]).includes(item))
    for (const item of fs) {
      if (!(FS_SCOPES as readonly string[]).includes(item)) {
        issues.push(
          warning(
            "capability_unknown",
            `permissions.filesystem 的 "${item}" 不在 v2 的 fs 作用域里，已丢弃`,
            "permissions.filesystem",
          ),
        )
      }
    }
  }
  for (const key of Object.keys(permissions)) {
    if (["tools", "network", "filesystem"].includes(key)) continue
    issues.push(
      warning(
        "capability_unknown",
        `permissions.${key} 在 v2 的 capabilities 里没有对应项，已丢弃`,
        `permissions.${key}`,
      ),
    )
  }
  return out
}

function readCapabilities(value: unknown, issues: Issue[]) {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    issues.push(
      warning("capability_unknown", "capabilities 不是对象，全部按未声明处理（未声明即拒绝，§5.4）", "capabilities"),
    )
    return undefined
  }
  const out: PluginCapabilities = {}
  const fs = strings(value.fs)
  if (fs !== undefined) {
    out.fs = fs.filter((item): item is FsScope => (FS_SCOPES as readonly string[]).includes(item))
    for (const item of fs) {
      if (!(FS_SCOPES as readonly string[]).includes(item)) {
        issues.push(
          warning("capability_unknown", `capabilities.fs 的 "${item}" 不是合法作用域，已丢弃`, "capabilities.fs"),
        )
      }
    }
  }
  for (const key of ["network", "secrets", "tools", "providers", "publishDrivers", "ui"] as const) {
    const list = strings(value[key])
    if (list !== undefined) out[key] = list
    else if (value[key] !== undefined)
      issues.push(warning("capability_unknown", `capabilities.${key} 不是字符串数组，已丢弃`, `capabilities.${key}`))
  }
  if (typeof value.shell === "boolean") out.shell = value.shell
  else if (value.shell !== undefined)
    issues.push(warning("capability_unknown", "capabilities.shell 不是布尔值，已丢弃", "capabilities.shell"))
  const process = strings(value.process)
  if (process !== undefined) out.process = process.filter((item) => item === "spawn")
  for (const key of Object.keys(value)) {
    if (["fs", "network", "secrets", "tools", "providers", "publishDrivers", "ui", "shell", "process"].includes(key)) continue
    issues.push(warning("capability_unknown", `capabilities.${key} 不是已知权限，已丢弃`, `capabilities.${key}`))
  }
  return out
}

function checkActivation(list: string[], issues: Issue[]) {
  const result: ActivationEvent[] = []
  for (const item of list) {
    if (item === "onStartup" || item === "onSessionStart") {
      result.push(item)
      continue
    }
    const hit = ACTIVATION_PREFIXES.find((prefix) => item.startsWith(`${prefix}:`))
    const name = hit === undefined ? "" : item.slice(hit.length + 1)
    if (hit === undefined || name === "") {
      issues.push(
        warning(
          "activation_event_invalid",
          `activationEvents 的 ${display(item)} 不认识（合法值：onStartup/onSessionStart/${ACTIVATION_PREFIXES.join("/")} 加 ":" 与名字）`,
          "activationEvents",
        ),
      )
      continue
    }
    result.push(`${hit}:${name}`)
  }
  return result
}

function checkOverrides(list: string[], issues: Issue[]) {
  for (const item of list) {
    if (!item.startsWith("builtin.")) {
      issues.push(
        warning(
          "unmapped_field",
          `overrides 只能指向内置贡献（"builtin.<插件>" 或 "builtin.<插件>:<贡献>"），"${item}" 无效`,
          "overrides",
        ),
      )
    }
  }
  return list
}

function toStringRecord(value: Record<string, unknown>, issues: Issue[], field: string) {
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      out[key] = item
      continue
    }
    issues.push(warning("unmapped_field", `${field}.${key} 不是字符串，已丢弃`, field))
  }
  return out
}

function strings(value: unknown): string[] | undefined {
  if (typeof value === "string") return [value]
  if (Array.isArray(value) && value.every((item): item is string => typeof item === "string")) return value
  return undefined
}

/** 报错信息里不许出现 `[object Object]`：一律走 JSON，序列化不出来的（symbol/undefined）只显示类型名。 */
function display(value: unknown): string {
  return JSON.stringify(value) ?? `<${typeof value}>`
}

function error(code: IssueCode, message: string, field?: string): Issue {
  return { level: "error", code, message, field }
}

function warning(code: IssueCode, message: string, field?: string): Issue {
  return { level: "warning", code, message, field }
}

function broken(input: ParseInput | { file: string }, issues: Issue[]): Decoded {
  const fallback = "fallbackName" in input ? input.fallbackName : undefined
  const name = readName({ value: "", fallback }, issues)
  return {
    manifest: { name, apiVersion: 1, kind: "declarative", contributes: {} },
    source: input.file.includes(".claude-plugin") ? "claude" : "extension",
    issues,
  }
}

export * as PluginManifest from "./manifest"
