import { describe, expect, test } from "bun:test"
import { parseRemoteProviderModels } from "@novaway/core/openai-compatible"
import {
  applyDiscovery,
  buildDiscoveredModels,
  discoverFreeProviderModels,
  discoverFreeProviderSnapshot,
  freeCostFromPricing,
  shouldPruneStale,
  type FreeDiscoveryConfig,
} from "@/provider/freeproviders"
import type { Model } from "@/provider/provider"

const config: FreeDiscoveryConfig = {
  providerID: "modelscope",
  baseURL: "https://api-inference.modelscope.cn/v1",
  freeByDefault: true,
}

describe("freeCostFromPricing", () => {
  test("prompt 和 completion 都为 0 才算免费", () => {
    expect(freeCostFromPricing({ prompt: 0, completion: 0 })).toEqual({ input: 0, output: 0 })
    // 只免费一头的按付费处理，避免误导
    expect(freeCostFromPricing({ prompt: 0, completion: 2 })).toEqual({ input: 0, output: 2 })
  })

  test("带真实价格的返回定价", () => {
    expect(freeCostFromPricing({ prompt: 0.5, completion: 1.5 })).toEqual({ input: 0.5, output: 1.5 })
  })

  test("定价缺失（null 一侧）时不判定", () => {
    expect(freeCostFromPricing({ prompt: 0, completion: null })).toBeUndefined()
    expect(freeCostFromPricing(undefined)).toBeUndefined()
  })
})

describe("buildDiscoveredModels", () => {
  test("免费额度网关：发现出的新模型按免费标 0 成本", () => {
    const remote = parseRemoteProviderModels({
      data: [{ id: "Qwen/Qwen3.9-Flash", owned_by: "qwen" }],
    })
    const models = buildDiscoveredModels(config, remote)
    expect(models["Qwen/Qwen3.9-Flash"].cost.input).toBe(0)
    expect(models["Qwen/Qwen3.9-Flash"].cost.output).toBe(0)
    expect(models["Qwen/Qwen3.9-Flash"].api.url).toBe(config.baseURL)
    expect(models["Qwen/Qwen3.9-Flash"].api.npm).toBe("@ai-sdk/openai-compatible")
  })

  test("按定价精确判定：OpenRouter 风格 payload", () => {
    const remote = parseRemoteProviderModels({
      data: [
        { id: "a/cheap:free", pricing: { prompt: "0", completion: "0" }, context_length: 1_000_000 },
        { id: "a/paid", pricing: { prompt: "0.002", completion: "0.008" } },
      ],
    })
    const paid: FreeDiscoveryConfig = { providerID: "openrouter", baseURL: "https://openrouter.ai/api/v1" }
    const models = buildDiscoveredModels(paid, remote)
    expect(models["a/cheap:free"].cost.input).toBe(0)
    expect(models["a/paid"].cost.input).toBe(0.002)
    expect(models["a/paid"].cost.output).toBe(0.008)
    // 上下文长度从 live 数据透传
    expect(models["a/cheap:free"].limit.context).toBe(1_000_000)
    expect(models["a/paid"].limit.context).toBe(128_000)
  })

  test("严格免费策略只收录输入和输出均为零的模型", () => {
    const remote = parseRemoteProviderModels({
      data: [
        { id: "free", pricing: { prompt: "0", completion: "0" } },
        { id: "input-free", pricing: { prompt: "0", completion: "0.001" } },
        { id: "output-free", pricing: { prompt: "0.001", completion: "0" } },
        { id: "unknown", pricing: { prompt: null, completion: "0" } },
        { id: "paid", pricing: { prompt: "0.001", completion: "0.002" } },
      ],
    })
    const models = buildDiscoveredModels(
      {
        providerID: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        requireZeroPricing: true,
      },
      remote,
    )
    expect(Object.keys(models)).toEqual(["free"])
    expect(models.free.cost).toMatchObject({ input: 0, output: 0 })
  })

  test("严格快照保留原始 live ID，但模型集合只包含免费模型", async () => {
    const snapshot = await discoverFreeProviderSnapshot(
      {
        providerID: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        requireZeroPricing: true,
      },
      "key",
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "free", pricing: { prompt: "0", completion: "0" } },
              { id: "paid", pricing: { prompt: "1", completion: "1" } },
            ],
          }),
          { status: 200 },
        ),
    )
    expect(Object.keys(snapshot.models)).toEqual(["free"])
    expect(snapshot.liveModelIDs.sort()).toEqual(["free", "paid"])
    expect(snapshot.freeOnly).toBe(true)
    expect(snapshot.replaceExisting).toBe(true)
  })

  test("定价未知的付费模型不合入（宁缺毋滥）", () => {
    const remote = parseRemoteProviderModels({
      data: [{ id: "a/mystery", owned_by: "a" }],
    })
    const mixed: FreeDiscoveryConfig = { providerID: "kilo", baseURL: "https://api.kilo.ai/api/gateway" }
    const models = buildDiscoveredModels(mixed, remote)
    expect(Object.keys(models)).toEqual([])
  })

  test("多模态输入映射进能力位", () => {
    const remote = parseRemoteProviderModels({
      data: [{ id: "m/vision", input_modalities: ["text", "image", "pdf"] }],
    })
    const models = buildDiscoveredModels(config, remote)
    const caps = models["m/vision"].capabilities
    expect(caps.input.image).toBe(true)
    expect(caps.input.pdf).toBe(true)
    expect(caps.input.audio).toBe(false)
    expect(caps.attachment).toBe(true)
  })

  test("混合免费池按显式白名单保留有标价但免费层可用的模型", () => {
    const remote = parseRemoteProviderModels({
      data: [
        { id: "pool/free", pricing: { prompt: "0.1", completion: "0.2" } },
        { id: "pool/paid", pricing: { prompt: "0.1", completion: "0.2" } },
        { id: "catalog/free", pricing: { prompt: "0", completion: "0" } },
      ],
    })
    const models = buildDiscoveredModels(
      {
        providerID: "kilo",
        baseURL: "https://api.kilo.ai/api/gateway",
        requireZeroPricing: true,
        freeModelIDs: new Set(["pool/free"]),
      },
      remote,
    )
    expect(Object.keys(models)).toEqual(["pool/free", "catalog/free"])
    expect(models["pool/free"].cost).toMatchObject({ input: 0, output: 0 })
  })

  test("返回全量 live 模型（含目录已有的），供调用方做合并与清理", () => {
    const remote = parseRemoteProviderModels({
      data: [{ id: "existing" }, { id: "brand-new" }],
    })
    const models = buildDiscoveredModels(config, remote)
    expect(Object.keys(models).sort()).toEqual(["brand-new", "existing"])
  })
})

describe("shouldPruneStale", () => {
  test("live 数量不少于目录时才清理", () => {
    expect(shouldPruneStale(50, 7)).toBe(true)
    expect(shouldPruneStale(3, 7)).toBe(false)
    expect(shouldPruneStale(7, 7)).toBe(true)
  })

  test("空目录不清理", () => {
    expect(shouldPruneStale(10, 0)).toBe(false)
  })
})

describe("discoverFreeProviderModels", () => {
  test("把厂商响应映射成 Model 记录，fetcher 注入不打真实网络", async () => {
    const payload = {
      object: "list",
      data: [{ id: "deepseek-ai/DeepSeek-V4-Pro", owned_by: "deepseek" }],
    }
    const models = await discoverFreeProviderModels(config, "test-key", async () => {
      return new Response(JSON.stringify(payload), { status: 200 })
    })
    expect(models["deepseek-ai/DeepSeek-V4-Pro"].cost.input).toBe(0)
    expect(String(models["deepseek-ai/DeepSeek-V4-Pro"].providerID)).toBe("modelscope")
  })

  test("厂商返回错误时抛出 ModelDiscoveryError，由调用方兜底", async () => {
    const failing: FreeDiscoveryConfig = {
      providerID: "iflowcn",
      baseURL: "https://apis.iflow.cn/v1",
      freeByDefault: true,
    }
    let calls = 0
    const run = discoverFreeProviderModels(failing, "key", async () => {
      calls += 1
      return new Response('{"error":{"message":"Not Found"}}', { status: 404 })
    })
    await expect(run).rejects.toThrow()
    expect(calls).toBe(1)
  })
})

describe("applyDiscovery", () => {
  const stubModel = (id: string): Model =>
    ({
      id,
      providerID: "modelscope",
      name: id,
      family: "",
      api: { id, url: "https://api-inference.modelscope.cn/v1", npm: "@ai-sdk/openai-compatible" },
      status: "active",
      headers: {},
      options: {},
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 8192, output: 4096 },
      capabilities: {},
      release_date: "",
      variants: {},
    }) as Model

  test("补入新模型并报告新增（厂商上新免费模型）", () => {
    const target = { existing: stubModel("existing") }
    const diff = applyDiscovery(target, { fresh: stubModel("fresh") })
    expect(Object.keys(target).sort()).toEqual(["existing", "fresh"])
    expect(diff.added).toEqual(["fresh"])
    expect(diff.removed).toEqual([])
  })

  test("非 replaceExisting 时同 ID 条目保留目录版", () => {
    const catalogVersion = stubModel("m")
    const target = { m: catalogVersion }
    const diff = applyDiscovery(target, { m: stubModel("m") })
    expect(target.m).toBe(catalogVersion)
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
  })

  test("replaceExisting 时 live 数据覆盖同 ID 条目", () => {
    const liveVersion = stubModel("m")
    const target = { m: stubModel("m") }
    applyDiscovery(target, { m: liveVersion }, { replaceExisting: true })
    expect(target.m).toBe(liveVersion)
  })

  test("prune 清理被转付费的条目（仍在 raw live 列表但不在免费集合）", () => {
    const target = { gone: stubModel("gone"), kept: stubModel("kept") }
    const diff = applyDiscovery(
      target,
      { kept: stubModel("kept") },
      { prune: true, liveIDs: ["gone", "kept", "paid", "new"] },
    )
    expect(Object.keys(target)).toEqual(["kept"])
    expect(diff.removed).toEqual(["gone"])
    expect(diff.added).toEqual([])
  })

  test("raw live 列表异常地少时不清理（防误杀）", () => {
    const target = { a: stubModel("a"), b: stubModel("b") }
    const diff = applyDiscovery(target, { a: stubModel("a") }, { prune: true, liveIDs: ["a"] })
    expect(Object.keys(target).sort()).toEqual(["a", "b"])
    expect(diff.removed).toEqual([])
  })

  test("用户手动配置的模型在清理中受保护", () => {
    const target = { stale: stubModel("stale"), mine: stubModel("mine") }
    const diff = applyDiscovery(
      target,
      { fresh: stubModel("fresh") },
      { prune: true, liveIDs: ["fresh", "raw1", "raw2"], protectedIDs: new Set(["mine"]) },
    )
    expect(Object.keys(target).sort()).toEqual(["fresh", "mine"])
    expect(diff.removed).toEqual(["stale"])
  })

  test("目录无变化时增删均为空（不触发 catalog.updated）", () => {
    const target = { m: stubModel("m") }
    const diff = applyDiscovery(target, { m: stubModel("m") }, { replaceExisting: true })
    expect(diff).toEqual({ added: [], removed: [] })
  })
})
