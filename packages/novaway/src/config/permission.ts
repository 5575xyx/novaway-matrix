export * as ConfigPermission from "./permission"
import { Schema, SchemaGetter } from "effect"

export const Action = Schema.Literals(["ask", "allow", "deny"]).annotate({ identifier: "PermissionActionConfig" })
export type Action = Schema.Schema.Type<typeof Action>

export const Object = Schema.Record(Schema.String, Action).annotate({ identifier: "PermissionObjectConfig" })
export type Object = Schema.Schema.Type<typeof Object>

export const Rule = Schema.Union([Action, Object]).annotate({ identifier: "PermissionRuleConfig" })
export type Rule = Schema.Schema.Type<typeof Rule>

// Known permission keys get explicit types in the Effect schema for generated
// docs/types. Runtime config parsing uses Effect's `propertyOrder: "original"`
// parse option so user key order is preserved for permission precedence.
const InputObject = Schema.StructWithRest(
  Schema.Struct({
    read: Schema.optional(Rule),
    edit: Schema.optional(Rule),
    glob: Schema.optional(Rule),
    grep: Schema.optional(Rule),
    list: Schema.optional(Rule),
    bash: Schema.optional(Rule),
    powershell: Schema.optional(Rule),
    task: Schema.optional(Rule),
    external_directory: Schema.optional(Rule),
    todowrite: Schema.optional(Action),
    todoedit: Schema.optional(Action),
    question: Schema.optional(Action),
    webfetch: Schema.optional(Action),
    websearch: Schema.optional(Action),
    repo_clone: Schema.optional(Rule),
    repo_overview: Schema.optional(Rule),
    lsp: Schema.optional(Rule),
    doom_loop: Schema.optional(Action),
    skill: Schema.optional(Rule),
    cron: Schema.optional(Rule),
    worktree: Schema.optional(Rule),
  }),
  [Schema.Record(Schema.String, Rule)],
)

// Input the user writes in config: either a single Action (shorthand for "*")
// or an object of per-target rules.
const InputSchema = Schema.Union([Action, InputObject])

// Normalise the Action shorthand into `{ "*": action }`. Object inputs pass
// through untouched.
const normalizeInput = (input: Schema.Schema.Type<typeof InputSchema>): Schema.Schema.Type<typeof InputObject> =>
  typeof input === "string" ? { "*": input } : input

export const Info = InputSchema.pipe(
  Schema.decodeTo(InputObject, {
    decode: SchemaGetter.transform(normalizeInput),
    // Not perfectly invertible (we lose whether the user originally typed an
    // Action shorthand), but the object form is always a valid representation
    // of the same rules.
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
).annotate({ identifier: "PermissionConfig" })
type _Info = Schema.Schema.Type<typeof InputObject>
export type Info = { -readonly [K in keyof _Info]: _Info[K] }

/**
 * 自主审批（`permission_mode: "acceptEdits"`，旧档位 "auto" 同义）下的安全分类器设置。
 *
 * 分类器不是独立权限档位,而是自主审批的辅助判定开关,默认关闭:开启后每次需要
 * 询问的调用都会多一次小模型判断,适合无人盯着但又要拦住明显危险操作
 * (删除仓库、外发凭据)的场景。
 */
export const AutoInfo = Schema.Struct({
  classifier: Schema.optional(Schema.Boolean).annotate({
    description: "自主审批权限模式下用 LLM 安全分类器判定放行/拒绝。默认 false(仍然询问用户)。",
  }),
  denial_limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "连续被分类器拒绝的次数上限。达到上限后停止自动拒绝,改为把决定交回用户,避免模型被锁死。默认 3。",
  }),
}).annotate({ identifier: "PermissionAutoConfig" })
export type AutoInfo = Schema.Schema.Type<typeof AutoInfo>
