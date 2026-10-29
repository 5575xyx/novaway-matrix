import { Effect, Schema } from "effect"
import { Parser } from "htmlparser2"
import * as Tool from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { isImageAttachment } from "@/util/media"
import { Provider } from "@/provider/provider"

/** 单次下载的字节上限，对齐 CC 的 MAX_HTTP_CONTENT_LENGTH。 */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes
/** 交给二次模型前截断到 10 万字符，避免 prompt 过长。 */
const MAX_MARKDOWN_LENGTH = 100_000
/** 同主机重定向的最大跳数，防止恶意服务器构造重定向环。 */
const MAX_REDIRECTS = 10

/**
 * 会话内 15 分钟缓存，对齐 CC WebFetch 的 URL_CACHE。
 * key 里带上 prompt：同一页面不同 prompt 的抽取结果不能互相顶替。
 */
const CACHE_TTL = 15 * 60 * 1000
const CACHE_MAX_ENTRIES = 50
type Cached = { output: string; title: string; metadata: Record<string, unknown> }
const cache = new Map<string, { at: number; result: Cached }>()

function cacheKey(sessionID: string, url: string, prompt: string, format: string) {
  return [sessionID, url, format, prompt].join("\n")
}

function cacheGet(key: string) {
  const hit = cache.get(key)
  if (!hit) return
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key)
    return
  }
  return hit.result
}

function cacheSet(key: string, result: Cached) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Oldest insertion first: Map keeps insertion order, so the first key is
    // the least recently added entry.
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), result })
}

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to fetch content from" }),
  prompt: Schema.optional(Schema.String).annotate({
    description: "The prompt to run on the fetched content. When omitted the raw converted content is returned.",
  }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({
      description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
      default: "markdown",
    })
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 120)" }),
})

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

/** http:// 一律升级到 https://，但本地地址保持原样（本地开发服务器通常没有证书）。 */
export function upgradeProtocol(input: string) {
  const parsed = new URL(input)
  if (parsed.protocol === "http:" && !LOCAL_HOSTS.has(parsed.hostname) && !parsed.hostname.endsWith(".local")) {
    parsed.protocol = "https:"
  }
  return parsed.toString()
}

function sameHost(left: string, right: string) {
  const strip = (host: string) => host.replace(/^www\./, "").toLowerCase()
  return strip(left) === strip(right)
}

type Fetched =
  | {
      kind: "content"
      url: string
      bytes: Uint8Array
      contentType: string
      code: number
      codeText: string
    }
  | { kind: "redirect"; originalUrl: string; redirectUrl: string; code: number; codeText: string }

const statusText = (code: number, fallback: string) => {
  switch (code) {
    case 301:
      return "Moved Permanently"
    case 302:
      return "Found"
    case 307:
      return "Temporary Redirect"
    case 308:
      return "Permanent Redirect"
    default:
      return fallback
  }
}

/**
 * 手动跟随重定向：同主机（忽略 www.）或仅协议/路径变化时继续，跨主机时把目标
 * 交给调用方 —— 跨域自动跟随等于替服务器执行一次开放重定向。
 */
async function fetchContent(input: {
  url: string
  headers: Record<string, string>
  signal: AbortSignal
  timeoutMs: number
}): Promise<Fetched> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)])
  let current = upgradeProtocol(input.url)
  const origin = new URL(current).hostname

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, { redirect: "manual", headers: input.headers, signal })
    const location = response.headers.get("location")
    const redirected = response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)

    if (redirected) {
      // Node 的手动重定向返回不透明响应（没有 status/headers），只能退化为
      // 跟随一次再看最终 URL 的主机，结果一样但多花一个请求。
      if (!location) {
        const followed = await fetch(current, { headers: input.headers, signal })
        const final = new URL(followed.url)
        if (!sameHost(origin, final.hostname)) {
          return { kind: "redirect", originalUrl: input.url, redirectUrl: followed.url, code: 302, codeText: "Found" }
        }
        return contentOf(followed)
      }
      const target = new URL(location, current).toString()
      if (!sameHost(origin, new URL(target).hostname)) {
        return {
          kind: "redirect",
          originalUrl: input.url,
          redirectUrl: target,
          code: response.status,
          codeText: statusText(response.status, response.statusText || "Redirect"),
        }
      }
      current = target
      continue
    }

    return contentOf(response)
  }

  throw new Error(`Too many redirects (exceeded ${MAX_REDIRECTS})`)
}

async function contentOf(response: Response): Promise<Fetched> {
  const declared = Number(response.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_SIZE) {
    throw new Error(`Response too large (exceeds ${MAX_RESPONSE_SIZE / (1024 * 1024)}MB limit)`)
  }
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.byteLength > MAX_RESPONSE_SIZE) {
    throw new Error(`Response too large (exceeds ${MAX_RESPONSE_SIZE / (1024 * 1024)}MB limit)`)
  }
  return {
    kind: "content",
    url: response.url,
    bytes: buffer,
    contentType: response.headers.get("content-type") ?? "",
    code: response.status,
    codeText: response.statusText,
  }
}

/** CC 的二次模型提示词：内容在前，用户问题在后，末尾附带引用约束。 */
export function makeSecondaryModelPrompt(content: string, prompt: string) {
  return [
    "Web page content:",
    "---",
    content,
    "---",
    "",
    prompt,
    "",
    `Provide a concise response based only on the content above. In your response:
 - Enforce a strict 125-character maximum for quotes from any source document. Open Source Software is ok as long as we respect the license.
 - Use quotation marks for exact language from articles; any language outside of the quotation should never be word-for-word the same.
 - You are not a lawyer and never comment on the legality of your own prompts and responses.
 - Never produce or reproduce exact song lyrics.`,
  ].join("\n")
}

/**
 * 把抓到的内容交给一次性的小模型处理，对齐 CC 的 `applyPromptToMarkdown`。
 * 没有可用模型（例如测试环境或未配置 provider）时退回原始内容，而不是让
 * 整个抓取失败 —— 模型至少还能自己读页面。
 */
const applyPrompt = Effect.fn("WebFetchTool.applyPrompt")(function* (input: {
  content: string
  prompt: string
  abort: AbortSignal
}) {
  const truncated =
    input.content.length > MAX_MARKDOWN_LENGTH
      ? input.content.slice(0, MAX_MARKDOWN_LENGTH) + "\n\n[Content truncated due to length...]"
      : input.content

  const text = yield* Effect.gen(function* () {
    const option = yield* Effect.serviceOption(Provider.Service)
    if (option._tag === "None") return undefined
    const provider = option.value
    const model = yield* provider.defaultModel().pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!model) return undefined
    const resolved = yield* provider
      .getModel(model.providerID, model.modelID)
      .pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!resolved) return undefined
    const language = yield* provider.getLanguage(resolved).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!language) return undefined
    const { generateText } = yield* Effect.promise(() => import("ai"))
    const result = yield* Effect.tryPromise({
      try: () =>
        generateText({
          model: language,
          prompt: makeSecondaryModelPrompt(truncated, input.prompt),
          maxOutputTokens: 4_000,
          abortSignal: input.abort,
        }),
      catch: (error) => error,
    })
    return result.text.trim() || undefined
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))

  return text
})

const TURNDOWN_OPTIONS = {
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
} as const

function convertHTMLToMarkdown(html: string, base?: string) {
  const turndownService = new TurndownService(TURNDOWN_OPTIONS)
  turndownService.remove(["script", "style", "meta", "link"])
  // 相对链接在 markdown 里会失效；按最终 URL 补全，模型点开就能用。
  if (base) {
    const resolve = (value: string) => {
      try {
        return new URL(value, base).toString()
      } catch {
        return value
      }
    }
    turndownService.addRule("absolute-links", {
      filter: ["a"],
      replacement: (_content, node) => {
        const element = node as unknown as { getAttribute?: (name: string) => string | null; textContent?: string }
        const href = element.getAttribute?.("href")
        const label = (element.textContent ?? "").trim()
        if (!href) return label
        if (href.startsWith("#")) return `[${label}](${resolve(base + href)})`
        return `[${label}](${resolve(href)})`
      },
    })
  }
  return turndownService.turndown(html)
}

function extractTextFromHTML(html: string) {
  let text = ""
  let skipDepth = 0

  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) {
        skipDepth++
      }
    },
    ontext(input) {
      if (skipDepth === 0) text += input
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--
    },
  })

  parser.write(html)
  parser.end()

  return text.trim()
}

export const WebFetchTool = Tool.define(
  "webfetch",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          yield* ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: {
              url: params.url,
              prompt: params.prompt,
              format: params.format,
              timeout: params.timeout,
            },
          })

          const key = cacheKey(ctx.sessionID, params.url, params.prompt ?? "", params.format ?? "markdown")
          const cached = cacheGet(key)
          if (cached) {
            return { ...cached, metadata: { ...cached.metadata, cached: true } }
          }

          const reply = (result: Cached) => {
            cacheSet(key, result)
            return result
          }

          const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

          // 请求头按目标格式加权，同时保留浏览器化 UA：不少站点会对默认 UA
          // 直接返回 403 或精简页面。
          const acceptHeader = params.prompt
            ? "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
            : params.format === "html"
              ? "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
              : params.format === "text"
                ? "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
                : "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
          const headers: Record<string, string> = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            Accept: acceptHeader,
            "Accept-Language": "en-US,en;q=0.9",
          }

          const started = Date.now()
          const fetched = yield* Effect.tryPromise({
            try: () => fetchContent({ url: params.url, headers, signal: ctx.abort, timeoutMs: timeout }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          })

          // 跨域重定向不自动跟随：把目标 URL 交回模型，让它显式再发一次请求。
          if (fetched.kind === "redirect") {
            const message = [
              "REDIRECT DETECTED: The URL redirects to a different host.",
              "",
              `Original URL: ${fetched.originalUrl}`,
              `Redirect URL: ${fetched.redirectUrl}`,
              `Status: ${fetched.code} ${fetched.codeText}`,
              "",
              "To complete your request, I need to fetch content from the redirected URL. Please use WebFetch again with these parameters:",
              `- url: "${fetched.redirectUrl}"`,
              `- prompt: "${params.prompt ?? ""}"`,
            ].join("\n")
            return reply({
              title: `${params.url} (${fetched.code} ${fetched.codeText})`,
              output: message,
              metadata: {
                url: params.url,
                redirect: fetched.redirectUrl,
                code: fetched.code,
                codeText: fetched.codeText,
                durationMs: Date.now() - started,
              },
            })
          }

          const contentType = fetched.contentType
          const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
          const title = `${params.url} (${contentType})`

          if (isImageAttachment(mime)) {
            const base64Content = Buffer.from(fetched.bytes).toString("base64")
            return {
              title,
              output: "Image fetched successfully",
              metadata: { url: params.url, code: fetched.code, codeText: fetched.codeText },
              attachments: [
                {
                  type: "file" as const,
                  mime,
                  url: `data:${mime};base64,${base64Content}`,
                },
              ],
            }
          }

          const content = new TextDecoder().decode(fetched.bytes)
          const base = fetched.url || params.url
          const markdown = contentType.includes("text/html") ? convertHTMLToMarkdown(content, base) : content
          const capped =
            markdown.length > MAX_MARKDOWN_LENGTH
              ? `${markdown.slice(0, MAX_MARKDOWN_LENGTH)}\n\n[Content truncated due to length...]`
              : markdown
          const metadata = {
            url: params.url,
            code: fetched.code,
            codeText: fetched.codeText,
            bytes: fetched.bytes.byteLength,
            durationMs: Date.now() - started,
          }

          // 带 prompt：交给二次模型抽取答案（CC 的主路径）；拿不到模型时退回原文。
          if (params.prompt) {
            const answer = yield* applyPrompt({ content: markdown, prompt: params.prompt, abort: ctx.abort })
            return reply({
              title,
              output: answer ?? capped,
              metadata: { ...metadata, processed: Boolean(answer) },
            })
          }

          switch (params.format) {
            case "markdown":
              return reply({ output: capped, title, metadata })
            case "text":
              return reply({
                output: contentType.includes("text/html") ? extractTextFromHTML(content) : content,
                title,
                metadata,
              })
            case "html":
              return reply({ output: content, title, metadata })
            default:
              return reply({ output: capped, title, metadata })
          }
        }).pipe(Effect.orDie),
    }
  }),
)
