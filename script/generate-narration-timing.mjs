import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [artifactPath, audioDir, outputPath] = process.argv.slice(2)
if (!artifactPath || !audioDir || !outputPath) {
  console.error("用法: bun script/generate-narration-timing.mjs <artifact.json> <audio-dir> <output.json>")
  process.exit(2)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""))
}

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
    cues.push({
      startMs: toMs(match[1], match[2], match[3], match[4]),
      endMs: toMs(match[5], match[6], match[7], match[8]),
      text: lines.slice(1).join("\n"),
    })
  }
  return cues
}

function toMs(hours, minutes, seconds, milliseconds) {
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(milliseconds)
}

const artifact = readJson(resolve(artifactPath))
const audioRoot = resolve(audioDir)
const manifest = readJson(join(audioRoot, "manifest.json"))
const bySlide = new Map(manifest.slides.map((item) => [Number(item.slide), item]))
const srtText = manifest.slides
  .map((item) => readFileSync(join(audioRoot, item.subtitle), "utf8").replace(/^\uFEFF/, ""))
  .join("\n\n")
const srtSha256 = createHash("sha256").update(srtText, "utf8").digest("hex")

const timingSlides = {}
const animationSlides = {}
for (const slide of artifact.slides ?? []) {
  const narration = bySlide.get(Number(slide.index))
  if (!narration) continue
  const cues = narration.subtitle ? parseSrt(join(audioRoot, narration.subtitle)) : []
  const key = `${String(slide.index).padStart(2, "0")}_${String(slide.title).replace(/[\\/:*?"<>|]/g, "-")}`
  const groups = cues.map((cue, index) => ({
    id: `cue-${index + 1}`,
    cue: index + 1,
    startMs: cue.startMs,
    text: cue.text,
  }))
  timingSlides[key] = {
    groups: groups.length ? groups : [{ id: "page", cue: 1 }],
  }

  const selectors = ["title", "body", "cards", "image", "chart"]
  animationSlides[slideRole(slide.index, artifact.slides.length)] = {
    groups: selectors.map((selector, index) => ({
      selector,
      effect: selector === "chart" ? "wipe" : "fade",
      duration: selector === "title" ? 0.5 : 0.4,
      delay: cues[index] ? Number((cues[index].startMs / 1000).toFixed(3)) : 0.2 + index * 0.2,
    })),
  }
}

const timing = {
  version: 1,
  srt_sha256: srtSha256,
  narration_start_floor: 0.8,
  narration_padding: 0.5,
  slides: timingSlides,
}
const animations = {
  version: 1,
  defaults: {
    transition: { effect: "fade", duration: 0.35 },
    animation: { effect: "fade", duration: 0.4, stagger: 0.2, trigger: "after-previous" },
  },
  slides: animationSlides,
}

const output = resolve(outputPath)
mkdirSync(output, { recursive: true })
writeFileSync(join(output, "narration_timing.json"), JSON.stringify(timing, null, 2), "utf8")
writeFileSync(join(output, "narration_animations.json"), JSON.stringify(animations, null, 2), "utf8")
console.log(output)

function slideRole(index, total) {
  if (index === 1) return "cover"
  if (index === total) return "closing"
  const roles = ["overview", "content", "cards", "data", "content"]
  return roles[Math.min(Math.max(0, index - 2), roles.length - 1)] ?? "content"
}
