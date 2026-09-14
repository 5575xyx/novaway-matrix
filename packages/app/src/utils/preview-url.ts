// 预览地址归一化。纯函数，无副作用。
// 从 preview-panel.tsx 上提：V2 分屏后，dev server 建议与标题栏也需要写入预览地址，
// 归一化逻辑不能只留在面板内部。

const HTTP_PROTOCOLS = new Set(["http:", "https:"])

function parsePreviewUrl(candidate: string): URL | undefined {
  if (!URL.canParse(candidate, "http://localhost")) return undefined

  const parsed = new URL(candidate, "http://localhost")
  if (HTTP_PROTOCOLS.has(parsed.protocol)) return parsed

  // file: 必须落到根之外的真实路径，file:/// 打开没有意义
  if (parsed.protocol === "file:" && parsed.pathname.length > 1) return parsed
  return undefined
}

export function normalizePreviewUrl(input: string): string | undefined {
  const path = input.trim().replace(/\\/g, "/")
  if (!path) return undefined

  // Windows 盘符路径（C:/...）不是协议，必须先于协议判断处理
  if (/^[a-zA-Z]:\//.test(path)) {
    return parsePreviewUrl(`file:///${path}`)?.toString()
  }

  // 裸地址也必须先于通用协议判断：new URL 会把 "localhost:" 当成协议解析
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0):\d{1,5}$/i.test(path)) {
    return parsePreviewUrl(`http://${path}`)?.toString()
  }

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(path)
  if (scheme) return parsePreviewUrl(path)?.toString()

  // 其余按本地文件路径处理；出现 :// 说明是未支持的协议
  if (path.includes("://")) return undefined
  return parsePreviewUrl(`file:///${path.startsWith("/") ? path.slice(1) : path}`)?.toString()
}
