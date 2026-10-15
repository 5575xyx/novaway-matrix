/**
 * 插件商店的数据契约。
 *
 * 对齐 ZCode 的插件商店架构：它的目录**不内置**，而是来自可配置的 *marketplace 源*
 * （`settings/PluginStoreSourcesDialog.tsx` + `AddMarketplaceSourceDialog.tsx`）——
 * 每个源是一个返回 JSON 目录的 URL。这样商店内容可以独立发布，不用改客户端。
 *
 * 这里刻意**不内置任何插件清单**：凭空写一堆 npm 包名只会在用户点「安装」时失败，
 * 比没有商店更糟。默认没有任何源，UI 用空态引导用户添加源。
 *
 * 一个源返回的 JSON 形如：
 *
 * ```json
 * [
 *   { "name": "example", "spec": "example-plugin@1.2.3", "description": "...", "author": "...", "tags": ["git"] }
 * ]
 * ```
 *
 * `spec` 就是写进 config `plugin[]` 的那个值（npm 包名 / `pkg@git+https://...`），
 * 与 CLI `novaway plugin <module>` 完全一致。
 */
export type PluginCatalogEntry = {
  name: string
  spec: string
  description?: string
  author?: string
  homepage?: string
  tags?: string[]
}

const asString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

/**
 * 从任意 JSON 里挑出合法条目。
 *
 * 源是外部输入，必须防御性解析：缺 `spec` 的条目直接丢弃（没有它无法安装），
 * 其余字段缺失就当作没有。`tags` 只接受字符串数组。
 */
export function parsePluginCatalog(value: unknown): PluginCatalogEntry[] {
  if (!Array.isArray(value)) return []
  const entries: PluginCatalogEntry[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue
    const record = item as Record<string, unknown>
    const spec = asString(record.spec)
    if (!spec || seen.has(spec)) continue
    seen.add(spec)
    entries.push({
      name: asString(record.name) ?? spec,
      spec,
      description: asString(record.description),
      author: asString(record.author),
      homepage: asString(record.homepage),
      tags: Array.isArray(record.tags)
        ? record.tags.filter((tag): tag is string => typeof tag === "string")
        : undefined,
    })
  }
  return entries
}

/** 规范化用户输入的源地址：只接受 http(s)，顺便去掉尾部斜杠。 */
export function normalizeSourceUrl(raw: string): string | undefined {
  const value = raw.trim().replace(/\/+$/, "")
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return url.toString().replace(/\/+$/, "")
  } catch {
    return undefined
  }
}
