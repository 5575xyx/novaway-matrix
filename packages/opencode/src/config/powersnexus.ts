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

/** 正式构建发现 stable 策略下的占位发布 URL 时必须失败。 */
export function assertReleaseUrlsReady(input: {
  policy: string
  releaseManifestUrls?: readonly string[] | null
}) {
  if (input.policy !== "stable") return
  const urls = input.releaseManifestUrls ?? []
  if (urls.length === 0) {
    throw new Error("stable 策略未配置真实 releaseManifestUrls，必须退回 bundled")
  }
  for (const url of urls) {
    if (
      !url ||
      /[<>]/.test(url) ||
      url.includes("gitee-release-endpoint") ||
      url.includes("novaway-mirror") ||
      url.includes("example.com")
    ) {
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
}

export * as ConfigPowersNexus from "./powersnexus"
