import { describe, expect, test } from "bun:test"
import {
  buildSrt,
  compactWordCues,
  parseCosyVoiceEvents,
  parseMiniMaxSubtitles,
  parseSseEvents,
} from "../../../src/tool/generate_narration"

describe("buildSrt", () => {
  test("writes a single cue when provider timestamps are absent", () => {
    const srt = buildSrt("第一页", 2000)
    expect(srt).toContain("00:00:00,000 --> 00:00:02,000")
    expect(srt).toContain("第一页")
  })

  test("uses provider word cues when available", () => {
    const srt = buildSrt("hello world", 5000, [
      { startMs: 0, endMs: 500, text: "hello" },
      { startMs: 600, endMs: 1200, text: "world" },
    ])
    expect(srt).toContain("00:00:00,600 --> 00:00:01,200")
    expect(srt).toContain("world")
  })
})

describe("parseMiniMaxSubtitles", () => {
  test("parses word-level timestamped subtitles from MiniMax JSON", () => {
    const cues = parseMiniMaxSubtitles({
      sentences: [
        {
          timestamped_words: [
            { word: "hello", time_begin: 0, time_end: 500 },
            { word: "world", time_begin: 600, time_end: 1200 },
          ],
        },
      ],
    })
    expect(cues).toEqual([
      { startMs: 0, endMs: 500, text: "hello" },
      { startMs: 600, endMs: 1200, text: "world" },
    ])
  })

  test("falls back to sentence-level cues when word timestamps are absent", () => {
    const cues = parseMiniMaxSubtitles({
      sentences: [
        { text: "第一句", start_time: 0, end_time: 900 },
        { text: "第二句", start_time: 1000, end_time: 1800 },
      ],
    })
    expect(cues).toEqual([
      { startMs: 0, endMs: 900, text: "第一句" },
      { startMs: 1000, endMs: 1800, text: "第二句" },
    ])
  })
})

describe("compactWordCues", () => {
  test("keeps Chinese words together without inserting spaces", () => {
    const cues = compactWordCues([
      { startMs: 0, endMs: 300, text: "你好" },
      { startMs: 300, endMs: 700, text: "世界" },
      { startMs: 700, endMs: 1100, text: "。" },
    ])
    expect(cues).toEqual([{ startMs: 0, endMs: 1100, text: "你好世界。" }])
  })

  test("splits long English cues at the previous word boundary", () => {
    const cues = compactWordCues([
      { startMs: 0, endMs: 400, text: "word" },
      { startMs: 400, endMs: 800, text: "internationalization" },
      { startMs: 800, endMs: 1200, text: "standardization" },
    ])
    expect(cues[0].text).toBe("word")
    expect(cues[0].endMs).toBe(400)
    expect(cues[1].text).toBe("internationalization")
  })
})

describe("parseSseEvents", () => {
  test("parses DashScope SSE data frames", () => {
    const events = parseSseEvents(
      'data: {"output":{"sentence":{"index":0}}}\n\ndata: {"output":{"audio":{"url":"https://audio.example/mp3"}}}\n\ndata: [DONE]\n\n',
    )
    expect(events).toHaveLength(2)
  })
})

describe("parseCosyVoiceEvents", () => {
  test("collects word timestamps and aligns them with the original text", () => {
    const parsed = parseCosyVoiceEvents([
      {
        output: {
          original_text: "hello world",
          sentence: {
            index: 0,
            words: [
              { text: "hello", begin_index: 0, end_index: 5, begin_time: 0, end_time: 500 },
              { text: "world", begin_index: 6, end_index: 11, begin_time: 600, end_time: 1200 },
            ],
          },
        },
      },
    ])
    expect(parsed.words).toEqual([
      { startMs: 0, endMs: 500, text: "hello" },
      { startMs: 600, endMs: 1200, text: "world" },
    ])
  })

  test("keeps audio url from the SSE stream", () => {
    const parsed = parseCosyVoiceEvents([{ output: { audio: { url: "https://audio.example/output.mp3" } } }])
    expect(parsed.audioUrl).toBe("https://audio.example/output.mp3")
  })
})
