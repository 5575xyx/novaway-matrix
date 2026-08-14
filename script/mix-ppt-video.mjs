import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const burnSubtitles = process.argv.includes("--burn-subtitles")
const optionValue = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const soundEffectsDir = optionValue("--sound-effects")
const [videoPath, audioDir, outputPath] = positional
if (!videoPath || !audioDir || !outputPath) {
  console.error(
    "用法: bun script/mix-ppt-video.mjs <video.mp4> <audio-dir> <output.mp4> [--burn-subtitles] [--sound-effects <dir>]",
  )
  process.exit(2)
}

const ffmpeg = resolveExecutable("FFMPEG_PATH", "ffmpeg", "ffmpeg-static")
const ffprobe = resolveExecutable("FFPROBE_PATH", "ffprobe", "ffprobe-static")
if (!ffmpeg) {
  console.error("未找到 ffmpeg。请安装系统 ffmpeg，或设置 FFMPEG_PATH，或安装 ffmpeg-static。")
  process.exit(2)
}

const manifest = readJson(join(resolve(audioDir), "manifest.json"))
const soundManifest = soundEffectsDir ? readJson(join(resolve(soundEffectsDir), "manifest.json")) : undefined
const inputs = [resolve(videoPath)]
const filters = []
const labels = []
let cursorMs = 0
let temporaryDir
let subtitlePath
let exitCode = 0

function addAudio(file, delayMs, volume = 1) {
  inputs.push(file)
  const label = `n${labels.length}`
  filters.push(`[${inputs.length - 1}:a]aresample=44100,volume=${volume},adelay=${delayMs}:all=1[${label}]`)
  labels.push(`[${label}]`)
}

try {
  if (burnSubtitles) {
    temporaryDir = mkdtempSync(join(tmpdir(), "ppt-video-mix-"))
    subtitlePath = buildCombinedSrt(manifest, resolve(audioDir), temporaryDir)
  }

  for (const [index, item] of manifest.slides.entries()) {
    addAudio(join(resolve(audioDir), item.file), cursorMs)
    cursorMs += Number(item.durationMs ?? 10000)
  }

  if (soundManifest) {
    for (const item of soundManifest.slides ?? []) {
      const transition = item.transition
      if (transition?.file) {
        addAudio(
          join(resolve(soundEffectsDir), transition.file),
          Number(transition.startMs ?? 0),
          Number(transition.volume ?? 0.35),
        )
      }
      for (const object of item.objects ?? []) {
        if (!object?.file) continue
        addAudio(
          join(resolve(soundEffectsDir), object.file),
          Number(object.startMs ?? 0),
          Number(object.volume ?? 0.25),
        )
      }
    }
  }

  const mix = labels.length
    ? `${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest[aout]`
    : "anull[aout]"
  const filterGraph = filters.length ? `${filters.join(";")};${mix}` : mix
  const durationSeconds = ffprobe ? probeDurationSeconds(resolve(videoPath), ffprobe) : undefined
  const args = [
    "-y",
    ...inputs.flatMap((file) => ["-i", file]),
    "-filter_complex",
    filterGraph,
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    ...(subtitlePath ? ["-vf", `subtitles=${escapeFilterPath(subtitlePath)}`] : []),
    ...(subtitlePath ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"] : ["-c:v", "copy"]),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    ...(durationSeconds ? ["-t", String(durationSeconds)] : []),
    "-movflags",
    "+faststart",
    resolve(outputPath),
  ]
  const result = spawnSync(ffmpeg, args, { stdio: "inherit" })
  if (result.status !== 0) exitCode = result.status ?? 1
} finally {
  if (temporaryDir) rmSync(temporaryDir, { recursive: true, force: true })
}

if (exitCode) process.exit(exitCode)
console.log(resolve(outputPath))

function resolveExecutable(envName, commandName, packageName) {
  if (process.env[envName]) return process.env[envName]
  const checked = spawnSync(commandName, ["-version"], { stdio: "ignore" })
  if (checked.status === 0) return commandName
  try {
    const require = createRequire(import.meta.url)
    const resolved = require(packageName)
    if (typeof resolved === "string") return resolved
    if (typeof resolved?.path === "string") return resolved.path
  } catch {}
  return undefined
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""))
}

function probeDurationSeconds(filePath, executable) {
  const result = spawnSync(executable, ["-v", "error", "-show_entries", "format=duration", "-of", "json", filePath], {
    encoding: "utf8",
  })
  if (result.status !== 0) return undefined
  try {
    const duration = Number(JSON.parse(result.stdout).format?.duration)
    return Number.isFinite(duration) ? duration : undefined
  } catch {
    return undefined
  }
}

function buildCombinedSrt(manifest, audioRoot, outputDir) {
  const blocks = []
  let cursorMs = 0
  let cueIndex = 0
  for (const item of manifest.slides ?? []) {
    if (item.subtitle) {
      for (const cue of parseSrt(join(audioRoot, item.subtitle))) {
        cueIndex += 1
        blocks.push(
          `${cueIndex}\n${formatTime(cue.startMs + cursorMs)} --> ${formatTime(cue.endMs + cursorMs)}\n${cue.text}`,
        )
      }
    }
    cursorMs += Number(item.durationMs ?? 10000)
  }
  const output = join(outputDir, "subtitles.srt")
  writeFileSync(output, blocks.length ? `${blocks.join("\n\n")}\n` : "", "utf8")
  return output
}

function parseSrt(filePath) {
  const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")
  const cues = []
  for (const block of text.split(/\r?\n\r?\n/).filter(Boolean)) {
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

function formatTime(milliseconds) {
  const total = Math.max(0, Math.round(milliseconds))
  const hours = Math.floor(total / 3600000)
  const minutes = Math.floor((total % 3600000) / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const millis = total % 1000
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`
}

function escapeFilterPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\\\:").replace(/'/g, "\\'")
}
