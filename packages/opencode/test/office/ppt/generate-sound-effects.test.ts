import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

describe("generate-ppt-sound-effects", () => {
  test("writes configured cue-level sound effects into the manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ppt-sound-effects-test-"))
    const soundDir = path.join(root, "sound")
    const configPath = path.join(root, "config.json")
    const script = path.resolve(
      fileURLToPath(new URL("../../../../../script/generate-ppt-sound-effects.mjs", import.meta.url)),
    )
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        slides: [
          {
            slide: 1,
            transition: { file: "ding.wav", startMs: 250, volume: 0.4 },
            objects: [{ file: "pop.wav", startMs: 0, volume: 0.5 }],
          },
        ],
      }),
      "utf8",
    )

    try {
      const result = spawnSync(process.execPath, [script, soundDir, "--config", configPath], { encoding: "utf8" })
      expect(result.status).toBe(0)
      const manifest = JSON.parse(await readFile(path.join(soundDir, "manifest.json"), "utf8"))
      expect(manifest.slides[0]).toMatchObject({
        slide: 1,
        transition: { file: "ding.wav", startMs: 250, volume: 0.4 },
        objects: [{ file: "pop.wav", startMs: 0, volume: 0.5 }],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function fileURLToPath(url: URL) {
  if (url.protocol !== "file:") throw new Error("不是本地文件 URL")
  return decodeURIComponent(url.pathname.replace(/^\/([A-Za-z]:)/, "$1"))
}
