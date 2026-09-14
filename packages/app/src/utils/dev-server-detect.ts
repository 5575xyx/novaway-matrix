// 从终端原始输出里识别本地 dev server 地址。
// 纯逻辑、无副作用，便于单测；调用方（context/dev-server）负责滚动缓冲的去重与触发时机。

const BUFFER_SIZE = 4096

// C1 控制序列 + CSI 序列（SGR 颜色、光标移动等）。不剥离会导致彩色 URL 整体漏匹配。
const ANSI_ESCAPE = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

// 只匹配回环与 RFC1918 内网地址。刻意排除公网：终端里打印的外部 URL 大量存在，
// 全部当成"预览建议"会制造噪声。尾段要求以 / 开头，避免把 :3000abc 这类脏尾巴吃进来。
const LOCAL_URL =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(?::\d{1,5})?(?:\/[^\s"'<>]*)?/g

export function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE, "")
}

export function normalizeLocalUrl(match: string): string | undefined {
  let url: URL
  try {
    url = new URL(match)
  } catch {
    return undefined
  }

  // new URL("localhost:3000") 会把 localhost: 当作协议解析出 "localhost://"，必须显式校验
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined

  const port = Number(url.port)
  if (url.port && (!Number.isSafeInteger(port) || port < 1 || port > 65535)) return undefined

  // 0.0.0.0 是监听地址而非可达目标，转成 localhost 才能正常预览
  const host = url.hostname === "0.0.0.0" ? "localhost" : url.hostname
  return `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`
}

export interface DevServerDetector {
  /** 喂入一段终端输出，返回本轮新发现且未报告过的地址 */
  report(chunk: string): string[]
}

export function createDevServerDetector(): DevServerDetector {
  let buffer = ""
  const reported = new Set<string>()

  return {
    report(chunk: string): string[] {
      // PTY 分块边界任意，URL 可能跨两个 chunk。保留滚动窗口而非逐块匹配。
      buffer = `${buffer}${stripAnsi(chunk)}`.slice(-BUFFER_SIZE)

      const found: string[] = []
      for (const match of buffer.matchAll(LOCAL_URL)) {
        const url = normalizeLocalUrl(match[0])
        if (!url) continue
        if (reported.has(url)) continue
        reported.add(url)
        found.push(url)
      }
      return found
    },
  }
}
