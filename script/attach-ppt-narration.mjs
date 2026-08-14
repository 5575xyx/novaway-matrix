import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [artifactPath, audioDir, outputPath] = process.argv.slice(2)
if (!artifactPath || !audioDir) {
  console.error("用法: bun script/attach-ppt-narration.mjs <artifact.json> <audio-dir> [output.json]")
  process.exit(2)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""))
}

const artifact = readJson(resolve(artifactPath))
const manifest = readJson(join(resolve(audioDir), "manifest.json"))
const bySlide = new Map(manifest.slides.map((item) => [Number(item.slide), item]))

artifact.slides = artifact.slides.map((slide) => {
  const narration = bySlide.get(Number(slide.index))
  if (!narration) return slide
  const bytes = readFileSync(join(resolve(audioDir), narration.file))
  const subtitles = narration.subtitle ? parseSrt(join(resolve(audioDir), narration.subtitle)) : undefined
  return {
    ...slide,
    audio: {
      mime: "audio/wav",
      dataBase64: bytes.toString("base64"),
      name: narration.title || `第 ${slide.index} 页旁白`,
      startFloor: 0.8,
      padding: 0.5,
      ...(subtitles ? { subtitles } : {}),
    },
  }
})
artifact.narration = {
  provider: manifest.provider,
  language: manifest.language,
  voice: manifest.voice,
  generatedAt: manifest.generatedAt,
}

const target = outputPath ? resolve(outputPath) : artifactPath
writeFileSync(target, JSON.stringify(artifact, null, 2), "utf8")
console.log(target)

function parseSrt(path) {
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "")
  const blocks = text.split(/\r?\n\r?\n/).filter(Boolean)
  const cues = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/)
    const match = lines
      .find((line) => line.includes("-->"))
      ?.match(/(\d+):(\d+):(\d+),(\d+)\s+-->\s+(\d+):(\d+):(\d+),(\d+)/)
    if (!match) continue
    const startMs = toMs(match[1], match[2], match[3], match[4])
    const endMs = toMs(match[5], match[6], match[7], match[8])
    cues.push({ startMs, endMs, text: lines.slice(1).join("\n") })
  }
  return cues
}

function toMs(hours, minutes, seconds, milliseconds) {
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(milliseconds)
}
