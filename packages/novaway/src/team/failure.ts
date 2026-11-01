import { Cause } from "effect"

/**
 * 失败的结构化原因（§18 / §21.2 的「异常原因不被吞」）。
 *
 * 以前派发失败只有一句话：`message(cause)` 把整个失败折成一段文本。文本能给人看，
 * 但代码没法据此做判断 —— 「格式错」「超时」「用户拒绝了权限」「提供方挂了」在
 * 状态机里是四种不同的下一步（重问 / 重试 / 等放行 / 稍后再试），折成一段字符串
 * 之后，它们全都变成了「这一队失败了」。
 *
 * 这里只做分类，不重新生成描述：`message` 仍是当时那句原文，界面与事件照旧展示它。
 */

export type FailureKind =
  /** 读不出报告（§8.4）：模型没按约定回话，重问一次即可。 */
  | "format"
  /** 一次调用超过上限没有任何进展（§9）：重试可能有用，但要重新预占预算。 */
  | "timeout"
  /** 权限策略拒绝（§11.1 / §11.2）：换人也没用，必须由用户放行。 */
  | "permission"
  /** 提供方故障（网络、限流、鉴权）：与这一队做得好不好无关。 */
  | "provider"
  /** 改动没能落成提交（§10.1）：无法复验，也就无法交付。 */
  | "commit"
  /** 验证器自身出错（§6.2）：结论只能是 unverified，不能算失败。 */
  | "verifier"
  /** 不知道什么原因：如实说不知道，不硬塞进上面任何一类。 */
  | "unknown"

export type Failure = { kind: FailureKind; message: string }

/** 权限类错误的 `_tag`：这几个是权限系统自己抛的，不看文本也能认出来。 */
const PERMISSION_TAGS = new Set(["PermissionDeniedError", "PermissionRejectedError", "PermissionCorrectedError"])

/**
 * 只认「一定出自权限判定」的措辞。
 *
 * 用「permission denied」这种泛词做匹配，模型自己写的一句话也会被误判成用户拒绝 ——
 * 那会把一次普通的失败说成「需要用户放行」，让用户去点一个并不存在的按钮。
 */
const PERMISSION_TEXT = ["只读运行不允许", "只读运行不能", "这次任务的范围是", "not allowed in the current context"]

/** 提供方故障的特征：传输层与 SDK 层面的原文，不会出现在模型自己的输出里。 */
const PROVIDER_TEXT = [
  "AI_APICallError",
  "APIError",
  "fetch failed",
  "socket hang up",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "rate limit",
]

function classifyMessage(message: string): FailureKind {
  if (PERMISSION_TEXT.some((item) => message.includes(item))) return "permission"
  if (PROVIDER_TEXT.some((item) => message.includes(item))) return "provider"
  return "unknown"
}

/**
 * 把一个失败原因分类。
 *
 * `fallback` 是「我知道这次失败发生在哪一步」时的兜底（提交、验证器），
 * 比猜测更可靠：同样是 `unknown` 文本，发生在提交步骤就是 `commit`。
 */
export function classify(cause: Cause.Cause<unknown>, fallback: FailureKind = "unknown"): Failure {
  const error = Cause.squash(cause)
  const message = error instanceof Error ? error.message : String(error)
  if (error && typeof error === "object") {
    const tag: unknown = Reflect.get(error, "_tag")
    if (typeof tag === "string" && PERMISSION_TAGS.has(tag)) return { kind: "permission", message }
  }
  const kind = classifyMessage(message)
  return { kind: kind === "unknown" ? fallback : kind, message }
}

/** 只有这两类值得原样重试：超时再看一次；提供方故障稍后可能就好了。 */
export function retriable(kind: FailureKind): boolean {
  return kind === "timeout" || kind === "provider"
}

export * as TeamFailure from "./failure"
