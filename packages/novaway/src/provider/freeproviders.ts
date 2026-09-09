import type { Model } from "./provider"
import { ProviderID, ModelID } from "./schema"
import { discoverProviderModels } from "./model-discovery"
import {
  AGNES_FREE_MODEL_IDS,
  filterCatalogToFreeModels as filterCatalogModels,
  FREE_PROVIDER_NATURE,
  KILO_FREE_MODEL_IDS,
  SILICONFLOW_FREE_MODEL_IDS,
  freeCostFromPricing as coreFreeCostFromPricing,
  type FreeNature,
} from "@novaway/core/free-provider-policy"
import type { RemoteProviderModel } from "@novaway/core/openai-compatible"

export {
  AGNES_FREE_MODEL_IDS,
  FREE_PROVIDER_NATURE,
  KILO_FREE_MODEL_IDS,
  SILICONFLOW_FREE_MODEL_IDS,
  type FreeNature,
} from "@novaway/core/free-provider-policy"

export const freeCostFromPricing = coreFreeCostFromPricing

export function filterCatalogToFreeModels<T extends { cost: { input: number; output: number } }>(
  providerID: string,
  models: Record<string, T>,
): Record<string, T> {
  return filterCatalogModels(providerID, models)
}

export type FreeDiscoveryConfig = {
  providerID: string
  baseURL: string
  /** 该网关的全部模型都在免费额度内（发现出的新模型直接按免费标 0 成本） */
  freeByDefault?: boolean
  /** 只接受 prompt 和 completion 都明确为 0 的模型 */
  requireZeroPricing?: boolean
  /** 供应商免费层允许的模型 ID；用于目录有标价但 key 有免费层的供应商 */
  freeModelIDs?: ReadonlySet<string>
  headers?: Record<string, string>
}

export type FreeDiscoverySnapshot = {
  models: Record<string, Model>
  liveModelIDs: string[]
  /** 严格免费网关需要同时清理静态目录中的付费模型 */
  freeOnly?: boolean
  /** live 数据是同 ID 模型的权威成本来源 */
  replaceExisting?: boolean
}

const UNKNOWN_CONTEXT = 128_000
const UNKNOWN_OUTPUT = 32_768

function capabilitiesFrom(remote: RemoteProviderModel): Model["capabilities"] {
  const inputs = new Set(remote.inputModalities ?? ["text"])
  return {
    temperature: true,
    reasoning: true,
    attachment: inputs.has("image") || inputs.has("pdf"),
    toolcall: true,
    input: {
      text: true,
      audio: inputs.has("audio"),
      image: inputs.has("image"),
      video: inputs.has("video"),
      pdf: inputs.has("pdf"),
    },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  }
}

/**
 * 把厂商 live /models 返回的模型映射成本地 Model。
 * 返回 **全部** live 模型（不只是目录没有的）——应用方需要完整集合来做
 * 「目录有但 live 已下架」的清理（prune）。
 */
export function buildDiscoveredModels(
  config: FreeDiscoveryConfig,
  remote: RemoteProviderModel[],
): Record<string, Model> {
  const providerID = ProviderID.make(config.providerID)
  const models: Record<string, Model> = {}
  for (const item of remote) {
    const priced = freeCostFromPricing(item.pricing)
    const trulyFree = priced?.input === 0 && priced?.output === 0
    const allowlisted = config.freeModelIDs?.has(item.id) === true
    if (config.requireZeroPricing && !trulyFree && !allowlisted) continue
    const free = config.freeByDefault === true || trulyFree || allowlisted
    // 免费发现只收录能定价的模型：免费额度网关（freeByDefault）或带了定价块的。
    // 定价未知的不合入——宁缺毋滥，避免把按量计费的模型伪装成免费。
    if (!free && !priced) continue
    // 走到这里只有两种情况：免费（成本 0）或 priced 已定义
    const cost = free
      ? { input: 0, output: 0 }
      : { input: priced?.input ?? 0, output: priced?.output ?? 0 }
    models[item.id] = {
      id: ModelID.make(item.id),
      providerID,
      name: item.name,
      family: "",
      api: {
        id: item.id,
        url: config.baseURL,
        npm: "@ai-sdk/openai-compatible",
      },
      status: "active",
      headers: config.headers ?? {},
      options: {},
      cost: {
        ...cost,
        cache: { read: 0, write: 0 },
      },
      limit: {
        context: item.contextLength ?? UNKNOWN_CONTEXT,
        output: UNKNOWN_OUTPUT,
      },
      capabilities: capabilitiesFrom(item),
      release_date: "",
      variants: {},
    }
  }
  return models
}

/**
 * 通用发现函数：拉厂商 live /models 并映射成 Model 记录。
 * 失败时返回空记录（不打断 provider 列表构建），由调用方记日志。
 */
type Fetcher = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>

export async function discoverFreeProviderSnapshot(
  config: FreeDiscoveryConfig,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<FreeDiscoverySnapshot> {
  const remote = await discoverProviderModels(
    {
      baseURL: config.baseURL,
      apiKey: apiKey ?? "",
      headers: config.headers,
    },
    fetcher,
  )
  return {
    models: buildDiscoveredModels(config, remote),
    liveModelIDs: remote.map((item) => item.id),
    freeOnly: config.requireZeroPricing === true,
    replaceExisting: config.requireZeroPricing === true,
  }
}

export async function discoverFreeProviderModels(
  config: FreeDiscoveryConfig,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<Record<string, Model>> {
  return (await discoverFreeProviderSnapshot(config, apiKey, fetcher)).models
}

/**
 * 「目录有但 live 已下架」的清理条件。发现结果异常地少（比如网关按 key
 * 权限过滤、或接口抽风返回半截列表）时宁可不清理，避免误杀可用模型。
 */
export function shouldPruneStale(liveCount: number, catalogCount: number): boolean {
  if (catalogCount === 0) return false
  return liveCount >= catalogCount
}

export type DiscoveryDiff = {
  added: string[]
  removed: string[]
}

export type DiscoveryApplyOptions = {
  /** 厂商返回的原始模型 ID（含付费），仅用于清理前的数量护栏；缺省时用 discovered 的键 */
  liveIDs?: readonly string[]
  /** 清理「目录有但 live 已下架/转付费」的条目 */
  prune?: boolean
  /** 用户手动配置的模型 ID，清理不得误删 */
  protectedIDs?: ReadonlySet<string>
  /** live 数据是同 ID 模型的权威来源，直接覆盖 */
  replaceExisting?: boolean
}

/**
 * 把一次发现结果合入目录模型表，返回增删的模型 ID（变更检测用：
 * 增删均为空 ⇒ 目录没变，不需要通知客户端）。
 * 清理时以 discovered（免费过滤后的集合）为准：转付费的模型仍会出现在
 * 厂商 raw /models 里，但不在免费集合中，同样要清掉。
 */
export function applyDiscovery(
  target: Record<string, Model>,
  discovered: Record<string, Model>,
  opts: DiscoveryApplyOptions = {},
): DiscoveryDiff {
  const before = new Set(Object.keys(target))
  for (const [modelID, model] of Object.entries(discovered)) {
    if (opts.replaceExisting || !target[modelID]) target[modelID] = model
  }
  const liveIDs = opts.liveIDs ?? Object.keys(discovered)
  if (opts.prune && shouldPruneStale(liveIDs.length, before.size)) {
    const free = new Set(Object.keys(discovered))
    for (const modelID of Object.keys(target)) {
      if (free.has(modelID) || opts.protectedIDs?.has(modelID)) continue
      delete target[modelID]
    }
  }
  const after = new Set(Object.keys(target))
  return {
    added: [...after].filter((modelID) => !before.has(modelID)),
    removed: [...before].filter((modelID) => !after.has(modelID)),
  }
}
