import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

describe("ppt narration video mix", () => {
  test("mixes slide narration and burns subtitles", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ppt-mix-test-"))
    const audioDir = path.join(root, "audio")
    const soundDir = path.join(root, "sound")
    await mkdir(audioDir, { recursive: true })
    await mkdir(soundDir, { recursive: true })
    const require = createRequire(import.meta.url)
    const ffmpegValue = require("ffmpeg-static")
    const ffprobeValue = require("ffprobe-static")
    if (typeof ffmpegValue !== "string") throw new Error("ffmpeg-static 未提供二进制路径")
    if (!isRecord(ffprobeValue) || typeof ffprobeValue.path !== "string")
      throw new Error("ffprobe-static 未提供二进制路径")
    const ffmpeg = ffmpegValue
    const ffprobe = ffprobeValue.path
    const video = path.join(root, "input.mp4")
    const first = path.join(audioDir, "01_first.wav")
    const second = path.join(audioDir, "02_second.wav")
    const firstSrt = path.join(audioDir, "01_first.srt")
    const secondSrt = path.join(audioDir, "02_second.srt")
    const output = path.join(root, "mixed.mp4")
    const transition = path.join(soundDir, "transition.wav")
    const click = path.join(soundDir, "click.wav")
    const mixScript = path.resolve(fileURLToPath(new URL("../../../../../script/mix-ppt-video.mjs", import.meta.url)))

    try {
      run(ffmpeg, ["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=3:r=10", "-an", video])
      run(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", first])
      run(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=660:duration=1", second])
      run(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=0.12", transition])
      run(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=1320:duration=0.08", click])
      await writeFile(firstSrt, "1\n00:00:00,000 --> 00:00:01,000\n第一页\n", "utf8")
      await writeFile(secondSrt, "1\n00:00:00,000 --> 00:00:01,000\n第二页\n", "utf8")
      await writeFile(
        path.join(audioDir, "manifest.json"),
        JSON.stringify({
          version: 1,
          slides: [
            { slide: 1, file: "01_first.wav", subtitle: "01_first.srt", durationMs: 1200 },
            { slide: 2, file: "02_second.wav", subtitle: "02_second.srt", durationMs: 1300 },
          ],
        }),
        "utf8",
      )
      await writeFile(
        path.join(soundDir, "manifest.json"),
        JSON.stringify({
          version: 1,
          slides: [
            {
              slide: 1,
              transition: { file: "transition.wav", startMs: 0, volume: 0.3 },
              objects: [{ file: "click.wav", startMs: 500, volume: 0.2 }],
            },
            {
              slide: 2,
              transition: { file: "transition.wav", startMs: 1300, volume: 0.3 },
              objects: [],
            },
          ],
        }),
        "utf8",
      )

      const result = spawnSync(
        process.execPath,
        [mixScript, video, audioDir, output, "--burn-subtitles", "--sound-effects", soundDir],
        { encoding: "utf8" },
      )
      expect(result.status).toBe(0)

      const probe = spawnSync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", output], {
        encoding: "utf8",
      })
      expect(probe.status).toBe(0)
      const streams = JSON.parse(probe.stdout).streams.map((stream: { codec_type: string }) => stream.codec_type)
      expect(streams).toContain("video")
      expect(streams).toContain("audio")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function run(executable: string, args: string[]) {
  const result = spawnSync(executable, args, { encoding: "utf8" })
  expect(result.status).toBe(0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function fileURLToPath(url: URL) {
  if (url.protocol !== "file:") throw new Error("不是本地文件 URL")
  return decodeURIComponent(url.pathname.replace(/^\/([A-Za-z]:)/, "$1"))
}
