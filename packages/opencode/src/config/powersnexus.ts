import fs from "node:fs"
import path from "node:path"
import { Schema } from "effect"
import { UpdatePolicy } from "@/powersnexus/schema"

export const IsolationMode = Schema.Literals(["logical", "os"])

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({ description: "是否启用 PowersNexus 第一方工作流" }),
  updatePolicy: Schema.optional(UpdatePolicy).annotate({ description: "PowersNexus 独立更新策略" }),
  pinnedVersion: Schema.optional(Schema.String).annotate({ description: "管理员锁定的 PowersNexus 版本" }),
  releaseManifestUrls: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "按顺序尝试的签名稳定版 Manifest 地址",
  }),
  releaseAllowedHosts: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "允许访问的 PowersNexus HTTPS 发布域名",
  }),
  developerPath: Schema.optional(Schema.String).annotate({ description: "仅本地开发构建可用的 PowersNexus 目录" }),
  workflowService: Schema.optional(Schema.Boolean).annotate({ description: "是否启用 Workflow Service" }),
  autoLocalDelivery: Schema.optional(Schema.Boolean).annotate({ description: "是否允许自动本地交付" }),
  browserQA: Schema.optional(Schema.Boolean).annotate({ description: "是否启用 Browser QA" }),
  durableBackgroundRuns: Schema.optional(Schema.Boolean).annotate({ description: "是否启用持久后台 run" }),
  osIsolation: Schema.optional(IsolationMode).annotate({ description: "执行隔离模式" }),
}).annotate({ identifier: "ConfigPowersNexus" })

export type Info = Schema.Schema.Type<typeof Info>

export function parseReleaseList(value?: string | null) {
  return (value ?? "")
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

const PLACEHOLDER_MARKERS = [
  "gitee-release-endpoint",
  "novaway-mirror",
  "example.com",
  "example.test",
  "local.test",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
]

export type StableGateCheck = {
  id: string
  title: string
  ok: boolean
  detail: string
  required: boolean
}

export type StableGateReport = {
  ready: boolean
  policy: string
  effectivePolicy: string
  checks: StableGateCheck[]
  blockers: string[]
}

function isPrivateOrLocalHost(hostname: string) {
  const host = hostname.toLowerCase()
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".local.test") ||
    host.endsWith(".example.test") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return true
  }
  // 简单 RFC1918 / link-local 判断
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number)
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true
  }
  return false
}

function looksPlaceholder(url: string, options?: { allowLocal?: boolean }) {
  if (!url || /[<>]/.test(url)) return true
  const lower = url.toLowerCase()
  const localMarkers = ["local.test", "localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]
  const markers = options?.allowLocal
    ? PLACEHOLDER_MARKERS.filter((marker) => !localMarkers.includes(marker))
    : PLACEHOLDER_MARKERS
  return markers.some((marker) => lower.includes(marker))
}

function readPublicKeyPem(publicKeyPath?: string | null) {
  if (!publicKeyPath) return { ok: false, detail: "未提供公钥路径 POWERSNEXUS_RELEASE_PUBLIC_KEY" }
  const resolved = path.resolve(publicKeyPath)
  if (!fs.existsSync(resolved)) return { ok: false, detail: `公钥文件不存在：${resolved}` }
  try {
    const pem = fs.readFileSync(resolved, "utf8")
    if (!pem.includes("BEGIN PUBLIC KEY") || !pem.includes("END PUBLIC KEY")) {
      return { ok: false, detail: "公钥文件不是有效 SPKI PEM" }
    }
    if (pem.includes("LOCAL") || pem.includes("test-only") || pem.includes("powersnexus-local")) {
      return { ok: false, detail: "检测到联调/测试公钥标记，禁止用于生产 stable" }
    }
    return { ok: true, detail: `公钥可读：${resolved}` }
  } catch (cause) {
    return { ok: false, detail: cause instanceof Error ? cause.message : "读取公钥失败" }
  }
}

/** 评估 stable 生产启用门禁（不抛错，返回清单）。 */
export function evaluateStableProductionGate(input: {
  policy?: string | null
  releaseManifestUrls?: readonly string[] | null
  releaseAllowedHosts?: readonly string[] | null
  publicKeyPath?: string | null
  keyID?: string | null
  /** 仅本机联调允许 localhost/.local.test */
  allowLocalEndpoints?: boolean
}): StableGateReport {
  const policy = input.policy ?? "bundled"
  const urls = [...(input.releaseManifestUrls ?? [])].filter(Boolean)
  const hosts = [...(input.releaseAllowedHosts ?? [])].map((h) => h.toLowerCase())
  const allowLocal = input.allowLocalEndpoints === true || process.env.POWERSNEXUS_ALLOW_LOCAL_STABLE === "1"
  const checks: StableGateCheck[] = []

  const effectivePolicy = policy === "stable" && urls.length === 0 ? "bundled" : policy

  checks.push({
    id: "default_bundled_safe",
    title: "默认策略安全",
    ok: policy !== "stable" || urls.length > 0,
    detail:
      policy === "stable" && urls.length === 0
        ? "配置为 stable 但无 URL，运行时将降级 bundled"
        : `当前策略 ${policy}，有效策略 ${effectivePolicy}`,
    required: false,
  })

  if (policy !== "stable" && effectivePolicy !== "stable") {
    checks.push({
      id: "stable_not_requested",
      title: "未请求启用 stable",
      ok: true,
      detail: "保持 bundled/manual/developer 时不要求生产端点",
      required: false,
    })
    return {
      ready: false,
      policy,
      effectivePolicy,
      checks,
      blockers: ["未启用 stable 策略（这是安全默认）"],
    }
  }

  // --- stable 路径检查 ---
  checks.push({
    id: "manifest_urls_present",
    title: "配置 releaseManifestUrls",
    ok: urls.length > 0,
    detail: urls.length > 0 ? `已配置 ${urls.length} 个 Manifest URL` : "未配置 releaseManifestUrls",
    required: true,
  })

  const urlHosts: string[] = []
  let urlsValid = urls.length > 0
  for (const url of urls) {
    // 占位符标记始终拒绝；localhost 等仅在非 allowLocal 时视为非法
    if (looksPlaceholder(url, { allowLocal })) {
      urlsValid = false
      checks.push({
        id: `url_placeholder_${urlHosts.length}`,
        title: "拒绝占位/联调 URL",
        ok: false,
        detail: `占位或联调地址：${url}`,
        required: true,
      })
      continue
    }
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "https:") {
        urlsValid = false
        checks.push({
          id: `url_https_${urlHosts.length}`,
          title: "Manifest 必须 HTTPS",
          ok: false,
          detail: `非 HTTPS：${url}`,
          required: true,
        })
        continue
      }
      if (!allowLocal && isPrivateOrLocalHost(parsed.hostname)) {
        urlsValid = false
        checks.push({
          id: `url_public_${urlHosts.length}`,
          title: "生产禁止本地/内网端点",
          ok: false,
          detail: `本地或内网主机：${parsed.hostname}（联调请设 POWERSNEXUS_ALLOW_LOCAL_STABLE=1）`,
          required: true,
        })
        continue
      }
      urlHosts.push(parsed.hostname.toLowerCase())
      checks.push({
        id: `url_ok_${urlHosts.length}`,
        title: "Manifest URL 形态合法",
        ok: true,
        detail: url,
        required: true,
      })
    } catch {
      urlsValid = false
      checks.push({
        id: `url_parse_${urlHosts.length}`,
        title: "Manifest URL 可解析",
        ok: false,
        detail: `非法 URL：${url}`,
        required: true,
      })
    }
  }

  checks.push({
    id: "allowed_hosts_present",
    title: "配置 releaseAllowedHosts",
    ok: hosts.length > 0,
    detail: hosts.length > 0 ? `白名单：${hosts.join(", ")}` : "未配置 releaseAllowedHosts",
    required: true,
  })

  let hostsCover = hosts.length > 0 && urlHosts.length > 0
  if (hosts.length > 0 && urlHosts.length > 0) {
    const missing = urlHosts.filter((h) => !hosts.includes(h))
    hostsCover = missing.length === 0
    checks.push({
      id: "hosts_cover_urls",
      title: "白名单覆盖 Manifest 主机",
      ok: hostsCover,
      detail: hostsCover ? "所有 Manifest 主机均在白名单内" : `白名单缺少：${missing.join(", ")}`,
      required: true,
    })
  }

  const keyID = (input.keyID ?? process.env.POWERSNEXUS_RELEASE_KEY_ID ?? "").trim()
  checks.push({
    id: "key_id",
    title: "配置发布 keyID",
    ok: keyID.length > 0 && !keyID.includes("local") && keyID !== "powersnexus-test-2026-01",
    detail: keyID ? `keyID=${keyID}` : "未设置 POWERSNEXUS_RELEASE_KEY_ID",
    required: true,
  })

  const pub = readPublicKeyPem(input.publicKeyPath ?? process.env.POWERSNEXUS_RELEASE_PUBLIC_KEY)
  checks.push({
    id: "public_key",
    title: "生产公钥文件可用",
    ok: pub.ok,
    detail: pub.detail,
    required: true,
  })

  const required = checks.filter((c) => c.required)
  const blockers = required.filter((c) => !c.ok).map((c) => `${c.title}：${c.detail}`)
  const ready = required.every((c) => c.ok) && urlsValid && hostsCover

  return {
    ready,
    policy,
    effectivePolicy: ready ? "stable" : effectivePolicy === "stable" ? "bundled" : effectivePolicy,
    checks,
    blockers,
  }
}

/** 正式构建发现 stable 策略下的占位发布 URL 时必须失败。 */
export function assertReleaseUrlsReady(input: {
  policy: string
  releaseManifestUrls?: readonly string[] | null
  releaseAllowedHosts?: readonly string[] | null
  publicKeyPath?: string | null
  keyID?: string | null
  allowLocalEndpoints?: boolean
}) {
  if (input.policy !== "stable") return
  const report = evaluateStableProductionGate(input)
  // 保持旧测试兼容：无 hosts/key 时仍至少校验 URL
  if ((input.releaseManifestUrls ?? []).length === 0) {
    throw new Error("stable 策略未配置真实 releaseManifestUrls，必须退回 bundled")
  }
  for (const url of input.releaseManifestUrls ?? []) {
    if (looksPlaceholder(url)) {
      throw new Error(`stable 策略包含占位发布地址，禁止启用：${url}`)
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error(`stable 策略 releaseManifestUrls 非法：${url}`)
    }
    if (parsed.protocol !== "https:") {
      throw new Error(`stable 策略仅允许 HTTPS 发布地址：${url}`)
    }
  }
  // 若调用方提供了 hosts/key 等扩展字段，则启用完整生产门禁
  const extended =
    (input.releaseAllowedHosts && input.releaseAllowedHosts.length > 0) ||
    input.publicKeyPath ||
    input.keyID ||
    process.env.POWERSNEXUS_STABLE_PRODUCTION_GATE === "1"
  if (extended && !report.ready) {
    throw new Error(`stable 生产门禁未通过：${report.blockers.join("；") || "未知原因"}`)
  }
}

/** 解析配置并得到有效更新策略；stable 不满足门禁时降级 bundled。 */
export function resolveUpdatePolicy(input: {
  policy?: string | null
  releaseManifestUrls?: readonly string[] | null
  releaseAllowedHosts?: readonly string[] | null
  publicKeyPath?: string | null
  keyID?: string | null
  strictProductionGate?: boolean
}): { policy: "bundled" | "stable" | "manual" | "developer"; gate: StableGateReport; degraded: boolean } {
  const raw = (input.policy ?? "bundled") as string
  const policy = (["bundled", "stable", "manual", "developer"].includes(raw) ? raw : "bundled") as
    | "bundled"
    | "stable"
    | "manual"
    | "developer"
  const gate = evaluateStableProductionGate({
    policy,
    releaseManifestUrls: input.releaseManifestUrls,
    releaseAllowedHosts: input.releaseAllowedHosts,
    publicKeyPath: input.publicKeyPath,
    keyID: input.keyID,
  })
  if (policy !== "stable") {
    return { policy, gate, degraded: false }
  }
  if ((input.releaseManifestUrls ?? []).length === 0) {
    return { policy: "bundled", gate, degraded: true }
  }
  if (input.strictProductionGate || process.env.POWERSNEXUS_STABLE_PRODUCTION_GATE === "1") {
    if (!gate.ready) return { policy: "bundled", gate, degraded: true }
  } else {
    // 非严格模式：仅 URL 形态合法即可保持 stable（兼容现有行为）
    try {
      assertReleaseUrlsReady({
        policy: "stable",
        releaseManifestUrls: input.releaseManifestUrls,
      })
    } catch {
      return { policy: "bundled", gate, degraded: true }
    }
  }
  return { policy: "stable", gate, degraded: false }
}

export * as ConfigPowersNexus from "./powersnexus"
