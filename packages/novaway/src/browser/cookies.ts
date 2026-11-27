import type { BrowserCookieParam } from "./cdp"

export type CookieTextFormat = "json" | "netscape"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Parse browser-exported JSON or Netscape cookies.txt without ever logging values. */
export function parseCookieText(text: string, format?: CookieTextFormat): BrowserCookieParam[] {
  const source = text.trim()
  if (!source) throw new Error("Cookie 文本为空")
  const selected = format ?? (source.startsWith("[") || source.startsWith("{") ? "json" : "netscape")
  if (selected === "json") {
    let value: unknown
    try {
      value = JSON.parse(source)
    } catch {
      throw new Error("Cookie JSON 格式无效")
    }
    const rows = Array.isArray(value)
      ? value
      : isRecord(value) && Array.isArray(value.cookies)
        ? value.cookies
        : undefined
    if (!rows) throw new Error("Cookie JSON 必须是数组，或包含 cookies 数组")
    return rows.map((row) => {
      if (!isRecord(row) || typeof row.name !== "string" || typeof row.value !== "string") {
        throw new Error("Cookie JSON 缺少 name 或 value")
      }
      return {
        name: row.name,
        value: row.value,
        ...(typeof row.url === "string" ? { url: row.url } : {}),
        ...(typeof row.domain === "string" ? { domain: row.domain } : {}),
        ...(typeof row.path === "string" ? { path: row.path } : {}),
        ...(typeof row.secure === "boolean" ? { secure: row.secure } : {}),
        ...(typeof row.httpOnly === "boolean" ? { httpOnly: row.httpOnly } : {}),
        ...(row.sameSite === "Strict" || row.sameSite === "Lax" || row.sameSite === "None"
          ? { sameSite: row.sameSite }
          : {}),
        ...(typeof row.expires === "number" ? { expires: row.expires } : {}),
      }
    })
  }
  return source
    .split(/\r?\n/)
    .filter((line) => line.trim() && (!line.startsWith("#") || line.startsWith("#HttpOnly_")))
    .map((line) => {
      const httpOnly = line.startsWith("#HttpOnly_")
      const row = (httpOnly ? line.slice("#HttpOnly_".length) : line).split("\t")
      const [domain, _includeSubdomains, path, secure, expires, name, ...valueParts] = row
      if (!domain || !path || !name || valueParts.length === 0) throw new Error("Netscape Cookie 行格式无效")
      return {
        name,
        value: valueParts.join("\t"),
        domain,
        path,
        secure: secure?.toUpperCase() === "TRUE",
        ...(httpOnly ? { httpOnly: true } : {}),
        ...(Number(expires) > 0 ? { expires: Number(expires) } : {}),
      }
    })
}
