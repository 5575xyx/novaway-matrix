/**
 * 平台接口请求：**必须走 Electron 的 net 模块，不能用 Node 的全局 fetch**。
 *
 * 这些平台（小红书 edith、抖音 creator、视频号 channels）会按 UA + TLS/HTTP2
 * 指纹判定请求来源，裸的 Node `fetch` 会被直接回 406/空响应 —— 旧版 XYMT-AUTO
 * 用 `net.request` 一直正常，迁移到 Node fetch 后账号昵称/头像就全空了
 * （登录本身能成，因为登录是真实浏览器窗口）。
 *
 * 这里统一成一层薄封装：Chromium 网络栈（跟随系统代理、Brotli、HTTP/2）、
 * 默认带浏览器 UA、支持超时与 JSON 宽松解析。
 */
import { net } from "electron"

/** 和登录窗口保持一致的桌面 UA；平台看到"别的浏览器"会直接拒。 */
export const PLATFORM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"

const DEFAULT_TIMEOUT_MS = 15_000

export interface PlatformRequestInit {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  headers?: Record<string, string | undefined>
  /** 字符串按原样发送（调用方自己控制 Content-Type），对象按 JSON 发送。 */
  body?: string | Record<string, unknown>
  timeoutMs?: number
}

export interface PlatformResponse<T = unknown> {
  status: number
  ok: boolean
  headers: Record<string, string | string[]>
  /** 已尝试 JSON.parse 的响应体；解析失败时是原始文本。 */
  data: T
  text: string
}

/**
 * 发一个平台请求。失败（网络错误/超时）会 reject，HTTP 非 2xx 不 reject ——
 * 调用方通常需要读响应体里的 `code`/`errCode` 判断业务结果。
 */
export function requestJson<T = any>(url: string, init: PlatformRequestInit = {}): Promise<PlatformResponse<T>> {
  const method = init.method ?? "GET"
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const headers: Record<string, string> = {
    "User-Agent": PLATFORM_USER_AGENT,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
  }
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    if (value) headers[key] = value
  }

  let body: string | undefined
  if (init.body !== undefined) {
    if (typeof init.body === "string") {
      body = init.body
    } else {
      body = JSON.stringify(init.body)
      headers["Content-Type"] ??= "application/json"
    }
    headers["Content-Length"] = Buffer.byteLength(body).toString()
  }

  return new Promise<PlatformResponse<T>>((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn()
    }

    try {
      const req = net.request({ method, url, headers, redirect: "follow" })
      for (const [key, value] of Object.entries(headers)) req.setHeader(key, value)

      timer = setTimeout(() => {
        finish(() => {
          try {
            req.abort()
          } catch {}
          reject(new Error(`请求超时（${timeoutMs}ms）：${url}`))
        })
      }, timeoutMs)
      timer.unref?.()

      req.on("response", (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8")
          let data: unknown = text
          try {
            data = text ? JSON.parse(text) : null
          } catch {
            /* 不是 JSON：保留文本，交给调用方判定 */
          }
          const status = response.statusCode ?? 0
          finish(() =>
            resolve({
              status,
              ok: status >= 200 && status < 300,
              headers: response.headers as Record<string, string | string[]>,
              data: data as T,
              text,
            }),
          )
        })
        response.on("error", (error) => finish(() => reject(error)))
      })

      req.on("error", (error) => finish(() => reject(error)))

      if (body !== undefined) req.write(body)
      req.end()
    } catch (error) {
      finish(() => reject(error))
    }
  })
}
