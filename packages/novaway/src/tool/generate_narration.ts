import { Effect, Schema } from "effect"
import { writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { Tool } from "./tool"
import { Config } from "@/config/config"
import { ConfigProvider } from "@/config/provider"
import { Auth } from "@/auth"

const Parameters = Schema.Struct({
  text: Schema.String,
  output: Schema.String,
  provider: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  voice: Schema.optional(Schema.String),
  rate: Schema.optional(Schema.Number),
  language: Schema.optional(Schema.String),
})

export const TTS_PROVIDERS = new Set([
  "openai",
  "dashscope",
  "qwen",
  "cosyvoice",
  "minimax",
  "elevenlabs",
  "siliconflow",
])

export const GenerateNarrationTool = Tool.define(
  "generate_narration",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service

    return {
      description:
        "Generate spoken narration audio from text using a configured provider. Reuses existing provider API keys and base URLs.",
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const cfg = yield* config.get()
          const candidate = yield* resolveNarrationProvider(cfg, args, auth)
          if (!candidate) {
            throw new Error(
              "No narration provider configured. Add a provider with an API key (openai, dashscope, qwen, minimax, elevenlabs, siliconflow).",
            )
          }

          const { bytes, extension, subtitles } = yield* Effect.promise(() => synthesizeSpeech(candidate, args))
          const output = path.resolve(args.output)
          yield* Effect.promise(() => mkdir(path.dirname(output), { recursive: true }))
          yield* Effect.promise(() => writeFile(output, bytes))

          const lastCue = subtitles?.length ? subtitles[subtitles.length - 1] : undefined
          const durationMs = lastCue
            ? Math.max(100, Math.round(lastCue.endMs))
            : extension === "wav"
              ? wavDurationMs(bytes)
              : estimateDurationMs(args.text)
          const srt = path.resolve(`${output.slice(0, output.lastIndexOf("."))}.srt`)
          yield* Effect.promise(() => writeFile(srt, buildSrt(args.text, durationMs, subtitles), "utf8"))

          return {
            title: `Generated narration: ${args.text.slice(0, 50)}`,
            output,
            metadata: {
              provider: candidate.providerId,
              model: candidate.model,
              voice: candidate.voice,
              file: output,
              srt,
              durationMs,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function resolveNarrationProvider(
  cfg: { provider?: Record<string, ConfigProvider.Info> },
  args: Schema.Schema.Type<typeof Parameters>,
  auth: Auth.Interface,
) {
  return Effect.gen(function* () {
    const resolveApiKey = (pid: string, pcfg: ConfigProvider.Info) =>
      Effect.gen(function* () {
        if (pcfg.options?.apiKey) return pcfg.options.apiKey
        const authInfo = yield* auth.get(pid)
        if (authInfo?.type === "api") return authInfo.key
        if (authInfo?.type === "wellknown") return authInfo.token
        return undefined
      })

    const entries = Object.entries(cfg.provider ?? {})
    const ordered = args.provider ? entries.filter(([pid]) => pid === args.provider) : entries
    for (const [providerId, pcfg] of ordered) {
      if (!TTS_PROVIDERS.has(providerId)) continue
      const apiKey = yield* resolveApiKey(providerId, pcfg)
      if (!apiKey) continue
      const baseURL = pcfg.options?.baseURL ?? pcfg.options?.endpoint
      return {
        providerId,
        apiKey,
        baseURL,
        model: args.model ?? defaultTtsModel(providerId),
        voice: args.voice ?? defaultTtsVoice(providerId),
        rate: args.rate,
        language: args.language,
      }
    }

    for (const env of [
      "OPENAI_API_KEY",
      "COSYVOICE_API_KEY",
      "DASHSCOPE_API_KEY",
      "MINIMAX_API_KEY",
      "ELEVENLABS_API_KEY",
      "SILICONFLOW_API_KEY",
    ]) {
      const key = process.env[env]
      if (!key) continue
      const providerId = env.replace("_API_KEY", "").toLowerCase()
      return {
        providerId,
        apiKey: key,
        baseURL: undefined,
        model: args.model ?? defaultTtsModel(providerId),
        voice: args.voice ?? defaultTtsVoice(providerId),
        rate: args.rate,
        language: args.language,
      }
    }
    return undefined
  })
}

async function synthesizeSpeech(
  candidate: {
    providerId: string
    apiKey: string
    baseURL?: string
    model: string
    voice: string
    rate?: number
    language?: string
  },
  args: Schema.Schema.Type<typeof Parameters>,
) {
  if (candidate.providerId === "elevenlabs") {
    return synthesizeElevenLabs(candidate, args.text)
  }

  if (candidate.providerId === "dashscope" || candidate.providerId === "qwen") {
    return synthesizeDashScope(candidate, args.text)
  }
  if (candidate.providerId === "cosyvoice") {
    return synthesizeCosyVoice(candidate, args.text)
  }
  if (candidate.providerId === "minimax") {
    return synthesizeMiniMax(candidate, args.text)
  }

  const base = ensureV1(candidate.baseURL ?? defaultTtsBaseURL(candidate.providerId))
  const url = `${base}/audio/speech`
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${candidate.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: candidate.model,
      input: args.text,
      voice: candidate.voice,
      response_format: "wav",
      speed: candidate.rate ?? 1,
    }),
  })
  if (!response.ok) throw new Error(`${candidate.providerId} TTS failed: ${response.status} ${await response.text()}`)
  return { bytes: new Uint8Array(await response.arrayBuffer()), extension: "wav", subtitles: undefined }
}

async function synthesizeElevenLabs(
  candidate: {
    apiKey: string
    model: string
    voice: string
  },
  text: string,
) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${candidate.voice}/with-timestamps`, {
    method: "POST",
    headers: {
      "xi-api-key": candidate.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: candidate.model,
      output_format: "mp3_44100_128",
    }),
  })
  if (!response.ok) throw new Error(`ElevenLabs TTS failed: ${response.status} ${await response.text()}`)
  const audio = parseElevenLabsPayload(await response.json())
  if (!audio) throw new Error("ElevenLabs TTS 返回中缺少时间戳音频")
  const subtitles = compactWordCues(buildWordCues(audio.characters, audio.starts, audio.ends))
  return {
    bytes: base64ToBytes(audio.audioBase64),
    extension: "mp3",
    subtitles: subtitles.length ? subtitles : undefined,
  }
}

async function synthesizeDashScope(
  candidate: {
    apiKey: string
    baseURL?: string
    model: string
    voice: string
    language?: string
  },
  text: string,
) {
  const base = (candidate.baseURL ?? defaultTtsBaseURL("dashscope")).replace(/\/+$/, "")
  const url = `${base}${base.endsWith("/api/v1") ? "" : "/api/v1"}/services/aigc/multimodal-generation/generation`
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${candidate.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: candidate.model,
      input: {
        text,
        voice: candidate.voice,
        ...(candidate.language ? { language_type: candidate.language } : {}),
      },
    }),
  })
  if (!response.ok) throw new Error(`dashscope TTS failed: ${response.status} ${await response.text()}`)
  const audio = parseDashScopeAudio(await response.json())
  if (!audio.data && !audio.url) throw new Error("dashscope TTS 返回中缺少音频数据")
  let bytes: Uint8Array
  if (audio.data) bytes = base64ToBytes(audio.data)
  else if (audio.url) bytes = new Uint8Array(await (await fetch(audio.url)).arrayBuffer())
  else throw new Error("dashscope TTS 返回中缺少音频数据")
  return { bytes, extension: "wav", subtitles: undefined }
}

async function synthesizeCosyVoice(
  candidate: {
    apiKey: string
    baseURL?: string
    model: string
    voice: string
    rate?: number
    language?: string
  },
  text: string,
) {
  const url = resolveCosyVoiceUrl(candidate.baseURL)
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${candidate.apiKey}`,
      "content-type": "application/json",
      "x-dashscope-sse": "enable",
    },
    body: JSON.stringify({
      model: candidate.model,
      input: {
        text,
        voice: candidate.voice,
        format: "mp3",
        sample_rate: 24000,
        word_timestamp_enabled: true,
        ...(candidate.rate !== undefined ? { rate: candidate.rate } : {}),
        ...(candidate.language ? { language_hints: [candidate.language] } : {}),
      },
    }),
  })
  if (!response.ok) throw new Error(`cosyvoice TTS failed: ${response.status} ${await response.text()}`)
  const events = parseSseEvents(await response.text())
  const parsed = parseCosyVoiceEvents(events)
  if (!parsed.audioUrl) throw new Error("cosyvoice TTS 返回中缺少音频 URL")
  if (!parsed.words.length) throw new Error("cosyvoice TTS 返回中缺少词级时间戳")
  const audioResponse = await fetch(parsed.audioUrl)
  if (!audioResponse.ok) {
    throw new Error(`cosyvoice audio download failed: ${audioResponse.status} ${await audioResponse.text()}`)
  }
  const bytes = new Uint8Array(await audioResponse.arrayBuffer())
  return { bytes, extension: "mp3", subtitles: compactWordCues(parsed.words) }
}

async function synthesizeMiniMax(
  candidate: {
    apiKey: string
    baseURL?: string
    model: string
    voice: string
    rate?: number
    language?: string
  },
  text: string,
) {
  const base = ensureV1(candidate.baseURL ?? defaultTtsBaseURL("minimax"))
  const response = await fetch(`${base}/t2a_v2`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${candidate.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: candidate.model,
      text,
      stream: false,
      output_format: "hex",
      language_boost: candidate.language ?? "auto",
      subtitle_enable: true,
      subtitle_type: "word",
      voice_setting: {
        voice_id: candidate.voice,
        speed: candidate.rate ?? 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: "mp3",
        channel: 1,
      },
    }),
  })
  if (!response.ok) throw new Error(`minimax TTS failed: ${response.status} ${await response.text()}`)
  const audio = parseMiniMaxAudio(await response.json())
  if (!audio) throw new Error("minimax TTS 返回中缺少音频数据")
  if (!audio.subtitleFile) throw new Error("minimax TTS 返回中缺少 word 字幕文件")
  const subtitleUrl = audio.subtitleFile.startsWith("http")
    ? audio.subtitleFile
    : new URL(audio.subtitleFile, base).toString()
  const subtitleResponse = await fetch(subtitleUrl, {
    headers: { accept: "application/json" },
  })
  if (!subtitleResponse.ok) {
    throw new Error(`minimax subtitle download failed: ${subtitleResponse.status} ${await subtitleResponse.text()}`)
  }
  const wordCues = parseMiniMaxSubtitles(await subtitleResponse.json()) ?? []
  const subtitles = wordCues.length ? compactWordCues(wordCues) : undefined
  return { bytes: hexToBytes(audio.audio), extension: "mp3", subtitles }
}

function defaultTtsBaseURL(providerId: string) {
  if (providerId === "dashscope" || providerId === "qwen") return "https://dashscope.aliyuncs.com"
  if (providerId === "cosyvoice") return "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer"
  if (providerId === "minimax") return "https://api.minimax.io/v1"
  if (providerId === "siliconflow") return "https://api.siliconflow.cn/v1"
  return "https://api.openai.com/v1"
}

function ensureV1(baseURL: string) {
  const base = baseURL.replace(/\/+$/, "")
  return base.endsWith("/v1") ? base : `${base}/v1`
}

function resolveCosyVoiceUrl(baseURL?: string) {
  const base = (baseURL ?? defaultTtsBaseURL("cosyvoice")).replace(/\/+$/, "")
  return base.endsWith("/SpeechSynthesizer") ? base : `${base}/api/v1/services/audio/tts/SpeechSynthesizer`
}

function parseDashScopeAudio(value: unknown): { data?: string; url?: string } {
  if (!isRecord(value)) return {}
  const output = value.output
  if (!isRecord(output)) return {}
  const audio = output.audio
  if (!isRecord(audio)) return {}
  return {
    data: typeof audio.data === "string" ? audio.data : undefined,
    url: typeof audio.url === "string" ? audio.url : undefined,
  }
}

function parseMiniMaxAudio(value: unknown): { audio: string; subtitleFile?: string } | undefined {
  if (!isRecord(value)) return undefined
  const data = value.data
  if (!isRecord(data) || typeof data.audio !== "string") return undefined
  return {
    audio: data.audio,
    subtitleFile: typeof data.subtitle_file === "string" ? data.subtitle_file : undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function base64ToBytes(input: string) {
  const binary = atob(input)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function hexToBytes(input: string) {
  const normalized = input.trim()
  const bytes = new Uint8Array(Math.ceil(normalized.length / 2))
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error("minimax TTS 返回了无效的音频 hex")
    bytes[index] = byte
  }
  return bytes
}

function defaultTtsModel(providerId: string) {
  if (providerId === "elevenlabs") return "eleven_multilingual_v2"
  if (providerId === "dashscope" || providerId === "qwen") return "qwen3-tts-flash"
  if (providerId === "cosyvoice") return "cosyvoice-v3-flash"
  if (providerId === "minimax") return "speech-2.8-hd"
  if (providerId === "siliconflow") return "FunAudioLLM/CosyVoice2-0.5B"
  return "gpt-4o-mini-tts"
}

function defaultTtsVoice(providerId: string) {
  if (providerId === "elevenlabs") return "21m00Tcm4TlvDq8ikWAM"
  if (providerId === "dashscope" || providerId === "qwen") return "Cherry"
  if (providerId === "cosyvoice") return "longanyang"
  if (providerId === "minimax") return "male-qn-qingse"
  if (providerId === "siliconflow") return "FunAudioLLM/CosyVoice2-0.5B:alex"
  return "alloy"
}

function wavDurationMs(bytes: Uint8Array) {
  if (bytes.length < 44) return 10000
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const byteRate = view.getUint32(28, true)
  const dataSize = view.getUint32(40, true)
  return byteRate && dataSize ? Math.max(100, Math.round((dataSize / byteRate) * 1000)) : 10000
}

function estimateDurationMs(text: string) {
  return Math.max(1000, Math.round(text.length / 3.2) * 1000)
}

export function buildSrt(
  text: string,
  durationMs: number,
  subtitles?: Array<{ startMs: number; endMs: number; text: string }>,
) {
  const cues = subtitles?.length ? subtitles : [{ startMs: 0, endMs: durationMs, text }]
  return cues
    .map((cue, index) => `${index + 1}\n${formatTime(cue.startMs)} --> ${formatTime(cue.endMs)}\n${cue.text}\n`)
    .join("\n")
}

export function parseMiniMaxSubtitles(
  value: unknown,
): Array<{ startMs: number; endMs: number; text: string }> | undefined {
  const words: Array<{ startMs: number; endMs: number; text: string }> = []
  for (const sentence of collectMiniMaxSentences(value)) {
    const timestamped = asArray(sentence.timestamped_words)
    if (timestamped.length) {
      for (const item of timestamped) {
        if (!isRecord(item)) continue
        const word = asText(item.word ?? item.text ?? item.content)
        const startMs = asMilliseconds(item.time_begin ?? item.start_time ?? item.start)
        const endMs = asMilliseconds(item.time_end ?? item.end_time ?? item.end)
        if (word && startMs !== undefined && endMs !== undefined) {
          words.push(normalizeCue({ startMs, endMs, text: word }))
        }
      }
      continue
    }
    const text = asText(sentence.text ?? sentence.content)
    const startMs = asMilliseconds(sentence.start_time ?? sentence.start)
    const endMs = asMilliseconds(sentence.end_time ?? sentence.end)
    if (text && startMs !== undefined && endMs !== undefined) {
      words.push(normalizeCue({ startMs, endMs, text }))
    }
  }
  return words.length ? words : undefined
}

export function parseSseEvents(body: string): unknown[] {
  const events: unknown[] = []
  const hasDataLines = body.split(/\r?\n/).some((line) => line.startsWith("data:"))
  if (!hasDataLines) {
    try {
      const parsed = JSON.parse(body) as unknown
      return isRecord(parsed) ? [parsed] : []
    } catch {
      return []
    }
  }
  let dataLines: string[] = []
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart())
      continue
    }
    if (!line && dataLines.length) {
      pushSseEvent(events, dataLines)
      dataLines = []
    }
  }
  if (dataLines.length) pushSseEvent(events, dataLines)
  return events
}

export function parseCosyVoiceEvents(events: unknown[]): {
  audioUrl?: string
  words: Array<{ startMs: number; endMs: number; text: string }>
} {
  const sentenceTexts = new Map<number, string>()
  const sentenceWords = new Map<number, Array<{ startMs: number; endMs: number; text: string }>>()
  let audioUrl: string | undefined
  for (const event of events) {
    if (!isRecord(event)) continue
    const code = event.code
    const message = event.message
    if (code || message) {
      throw new Error(`cosyvoice TTS failed: ${[code, message].filter(Boolean).join(": ")}`)
    }
    const output = event.output
    if (!isRecord(output)) continue
    const audio = output.audio
    if (isRecord(audio) && typeof audio.url === "string") audioUrl = audio.url
    const sentence = output.sentence
    if (!isRecord(sentence)) continue
    const index = sentence.index
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) continue
    if (typeof output.original_text === "string" && output.original_text) {
      sentenceTexts.set(index, output.original_text)
    }
    const originalText = sentenceTexts.get(index) ?? ""
    const words = asArray(sentence.words)
    const cues: Array<{ startMs: number; endMs: number; text: string }> = []
    for (const item of words) {
      if (!isRecord(item)) continue
      let word = asText(item.text)
      const beginIndex = asIndex(item.begin_index)
      const endIndex = asIndex(item.end_index)
      if (
        originalText &&
        beginIndex !== undefined &&
        endIndex !== undefined &&
        0 <= beginIndex &&
        beginIndex < endIndex &&
        endIndex <= originalText.length
      ) {
        word = originalText.slice(beginIndex, endIndex).trim() || word
      }
      const startMs = asMilliseconds(item.begin_time)
      const endMs = asMilliseconds(item.end_time)
      if (word && startMs !== undefined && endMs !== undefined) {
        cues.push(normalizeCue({ startMs, endMs, text: word }))
      }
    }
    if (cues.length) sentenceWords.set(index, cues)
  }
  const words = [...sentenceWords.entries()].sort(([left], [right]) => left - right).flatMap(([, cues]) => cues)
  return { audioUrl, words }
}

function parseElevenLabsPayload(value: unknown) {
  if (!isRecord(value) || typeof value.audio_base64 !== "string") return undefined
  const alignment = value.alignment
  if (!isRecord(alignment)) return undefined
  const characters = alignment.characters
  const starts = alignment.character_start_times_seconds
  const ends = alignment.character_end_times_seconds
  if (!isStringArray(characters) || !isNumberArray(starts) || !isNumberArray(ends)) return undefined
  if (characters.length !== starts.length || characters.length !== ends.length) return undefined
  return {
    audioBase64: value.audio_base64,
    characters,
    starts,
    ends,
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number")
}

function buildWordCues(characters: string[], starts: number[], ends: number[]) {
  const cues: Array<{ startMs: number; endMs: number; text: string }> = []
  let text = ""
  let startMs = 0
  let endMs = 0
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]
    if (character.trim()) {
      if (!text) startMs = starts[index] * 1000
      text += character
      endMs = ends[index] * 1000
      continue
    }
    if (text) {
      cues.push({
        startMs: Math.round(startMs),
        endMs: Math.max(Math.round(endMs), Math.round(startMs) + 1),
        text: text.trim(),
      })
      text = ""
    }
  }
  if (text)
    cues.push({
      startMs: Math.round(startMs),
      endMs: Math.max(Math.round(endMs), Math.round(startMs) + 1),
      text: text.trim(),
    })
  return cues
}

export function compactWordCues(words: Array<{ startMs: number; endMs: number; text: string }>) {
  const cues: Array<{ startMs: number; endMs: number; text: string }> = []
  let text = ""
  let startMs = 0
  let endMs = 0
  for (const word of words) {
    const candidate = joinNarrationWords(text, word.text)
    if (text && (candidate.length > 20 || /[。！？.!?]$/.test(text))) {
      cues.push({ startMs, endMs, text: text.trim() })
      text = ""
      startMs = word.startMs
    }
    text = text ? candidate : word.text
    endMs = word.endMs
  }
  if (text) cues.push({ startMs, endMs, text: text.trim() })
  return cues
}

function collectMiniMaxSentences(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) return []
  const data = isRecord(value.data) ? value.data : value
  const sentences = data.sentences ?? (Array.isArray(value) ? value : data)
  if (Array.isArray(sentences)) return sentences.filter(isRecord)
  if (isRecord(sentences)) return [sentences]
  return []
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asText(value: unknown) {
  if (typeof value !== "string") return undefined
  const text = value.trim()
  return text || undefined
}

function asMilliseconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value))
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : undefined
  }
  return undefined
}

function asIndex(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && !Number.isNaN(value) ? value : undefined
}

function pushSseEvent(events: unknown[], dataLines: string[]) {
  const payload = dataLines.join("\n").trim()
  if (!payload || payload === "[DONE]") return
  try {
    const parsed = JSON.parse(payload) as unknown
    if (isRecord(parsed)) events.push(parsed)
  } catch {
    // 忽略无法解析的 SSE 数据段，保持与上游行为一致。
  }
}

function normalizeCue(cue: { startMs: number; endMs: number; text: string }) {
  const startMs = Math.max(0, Math.round(cue.startMs))
  const endMs = Math.max(startMs + 1, Math.round(cue.endMs))
  return { startMs, endMs, text: cue.text }
}

function joinNarrationWords(previous: string, next: string) {
  if (!previous) return next
  const prevTail = previous.slice(-1)
  const nextHead = next.slice(0, 1)
  const joinedCjkOrPunctuation =
    /[\u3400-\u9fff，。！？、；：]/.test(prevTail) && /[\u3400-\u9fff，。！？、；：]/.test(nextHead)
  return joinedCjkOrPunctuation ? `${previous}${next}` : `${previous} ${next}`
}

function formatTime(milliseconds: number) {
  const total = Math.max(0, Math.round(milliseconds))
  const hours = Math.floor(total / 3600000)
  const minutes = Math.floor((total % 3600000) / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const millis = total % 1000
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`
}
