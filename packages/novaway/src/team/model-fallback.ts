import { Provider } from "@/provider/provider"

/**
 * 成员派发用哪个模型（§4.3 / §5.4）。
 *
 * 成员会话会记住它创建时用的模型；网关目录换代后那个 id 可能已经不存在，
 * 于是每一次派发都死在 `ProviderModelNotFoundError` 上 —— 对用户来说就是
 * 「这支队突然不能用了」。
 *
 * 这里只做决定，不碰 Effect：可用性由调用方问一遍 provider，最后按
 * 「会话记住的 → 默认模型」挑一个。换掉模型这件事必须说出来，
 * 不静默降级 —— 模型换了，成本和效果都变了。
 */

export type DispatchModel = { providerID: string; modelID: string }

export type PickedDispatchModel = {
  model: DispatchModel
  /** 原模型不可用时才出现：写进回复，事后可以解释「这次为什么换了模型」。 */
  replaced?: DispatchModel
}

export function pickDispatchModel(input: {
  /** 会话里记住的模型。 */
  pinned?: DispatchModel | undefined
  /** 上面那个模型在当前目录里是否还能用。 */
  pinnedUsable: boolean
  /** 兜底模型；provider 一个可用模型都给不出时为空。 */
  fallback?: DispatchModel | undefined
}): PickedDispatchModel | undefined {
  if (input.pinned && input.pinnedUsable) return { model: input.pinned }
  if (!input.fallback) return undefined
  return input.pinned ? { model: input.fallback, replaced: input.pinned } : { model: input.fallback }
}

const label = (model: DispatchModel) => `${model.providerID}/${model.modelID}`

/**
 * 模型被换掉的通知。
 *
 * 同一个成员回退到同一个模型只说一次：每条回复都念一遍就成了噪声，
 * 但换回来（恢复成会话记住的模型）之后要重新允许提示。
 */
export function modelNotice(seen: Map<string, string>, sessionID: string, picked: PickedDispatchModel): string {
  if (!picked.replaced) {
    seen.delete(sessionID)
    return ""
  }
  const target = label(picked.model)
  if (seen.get(sessionID) === target) return ""
  seen.set(sessionID, target)
  return `（模型已回退到 ${target}：${label(picked.replaced)} 已不可用）`
}

/**
 * 失败原因写成一句人话。
 *
 * `String(cause)` 会把 Effect 的内部结构（`Cause([Die(...)])`）原样贴进群聊，
 * 既看不懂也没法行动；模型的问题要指出是哪个模型、可以换成什么。
 */
export function describeFailure(err: unknown): string {
  if (Provider.ModelNotFoundError.isInstance(err)) {
    const hint = err.suggestions?.length ? `，可用：${err.suggestions.slice(0, 3).join("、")}` : ""
    return `模型不可用（${err.providerID}/${err.modelID}）${hint}`
  }
  if (err instanceof Error && err.message) return err.message
  if (typeof err === "object" && err !== null && "message" in err) {
    const message = (err as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }
  if (typeof err === "string" && err) return err
  return "未知原因"
}
