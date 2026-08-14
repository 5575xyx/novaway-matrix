import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const option = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const outputDir = resolve(positional[0] ?? "validation/sound-effects")
const narrationManifestPath = option("--narration-manifest")
const animationsPath = option("--animations")
const configPath = option("--config")
const transitionLevel = Number(option("--transition-level") ?? 0.35)
const objectLevel = Number(option("--object-level") ?? 0.25)

const ffmpeg = resolveExecutable("FFMPEG_PATH", "ffmpeg", "ffmpeg-static")
if (!ffmpeg) {
  console.error("未找到 ffmpeg，无法生成音效。请安装 ffmpeg-static 或设置 FFMPEG_PATH。")
  process.exit(2)
}

mkdirSync(outputDir, { recursive: true })
generateWav(ffmpeg, join(outputDir, "transition.wav"), [
  "-f",
  "lavfi",
  "-i",
  "aevalsrc=0.16*sin(2*PI*(220+520*t)*t):s=44100:d=0.45",
  "-af",
  "afade=t=in:st=0:d=0.05,afade=t=out:st=0.32:d=0.13",
])
generateWav(ffmpeg, join(outputDir, "click.wav"), [
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=1100:duration=0.08:sample_rate=44100",
  "-af",
  "volume=0.18,afade=t=out:st=0.04:d=0.04",
])
generateWav(ffmpeg, join(outputDir, "whoosh.wav"), [
  "-f",
  "lavfi",
  "-i",
  "aevalsrc=0.14*sin(2*PI*(260+760*t)*t):s=44100:d=0.48",
  "-af",
  "afade=t=in:st=0:d=0.06,afade=t=out:st=0.36:d=0.12",
])
generateWav(ffmpeg, join(outputDir, "pop.wav"), [
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=520:duration=0.14:sample_rate=44100",
  "-af",
  "volume=0.2,afade=t=in:st=0:d=0.015,afade=t=out:st=0.1:d=0.04",
])
generateWav(ffmpeg, join(outputDir, "tap.wav"), [
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=1480:duration=0.07:sample_rate=44100",
  "-af",
  "volume=0.16,afade=t=out:st=0.035:d=0.035",
])
generateWav(ffmpeg, join(outputDir, "ding.wav"), [
  "-f",
  "lavfi",
  "-i",
  "aevalsrc=0.2*(sin(2*PI*880*t)+0.35*sin(2*PI*1760*t))*exp(-4*t):s=44100:d=0.7",
  "-af",
  "afade=t=in:st=0:d=0.02,afade=t=out:st=0.52:d=0.18",
])

const narration = narrationManifestPath ? readJson(resolve(narrationManifestPath)) : undefined
const animations = animationsPath ? readJson(resolve(animationsPath)) : undefined
const config = configPath ? readJson(resolve(configPath)) : undefined
const slideCount = narration?.slides?.length ?? slideCountFromAnimations(animations)
const slides = []
let cursorMs = 0
for (let index = 1; index <= slideCount; index += 1) {
  const role = slideRole(index, slideCount)
  const groups = animations?.slides?.[role]?.groups ?? []
  const configured = config?.slides?.find((item) => Number(item.slide) === index)
  const transition = configured?.transition
    ? {
        file: configured.transition.file ?? "transition.wav",
        startMs: Number(configured.transition.startMs ?? cursorMs),
        volume: Number(configured.transition.volume ?? transitionLevel),
      }
    : {
        file: "transition.wav",
        startMs: Math.max(0, cursorMs),
        volume: transitionLevel,
      }
  const objects = configured?.objects?.length
    ? configured.objects.map((object, objectIndex) => {
        const fallbackStartMs =
          cursorMs + Math.round(Number(groups[objectIndex]?.delay ?? 0.2 + objectIndex * 0.2) * 1000 || 0)
        return {
          file: object.file ?? "click.wav",
          startMs: object.startMs === undefined || object.startMs === "" ? fallbackStartMs : Number(object.startMs),
          volume: Number(object.volume ?? objectLevel),
        }
      })
    : groups.slice(0, 6).map((group, groupIndex) => ({
        file: "click.wav",
        startMs: cursorMs + Math.round(Number(group.delay ?? 0.2 + groupIndex * 0.2) * 1000 || 0),
        volume: objectLevel,
      }))
  validateSoundFiles(outputDir, [transition, ...objects])
  slides.push({
    slide: index,
    transition,
    objects,
  })
  const durationMs = Number(narration?.slides?.[index - 1]?.durationMs ?? 10000)
  cursorMs += durationMs
}

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  slides,
}
const manifestPath = join(outputDir, "manifest.json")
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
console.log(manifestPath)

function generateWav(executable, output, args) {
  const result = spawnSync(executable, ["-y", ...args, "-c:a", "pcm_s16le", output], { stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

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

function slideCountFromAnimations(animations) {
  if (!animations?.slides) return 8
  const values = Object.values(animations.slides)
  if (values.length) return values.length
  return 8
}

function slideRole(index, total) {
  if (index === 1) return "cover"
  if (index === total) return "closing"
  const roles = ["overview", "content", "cards", "data", "content"]
  return roles[Math.min(Math.max(0, index - 2), roles.length - 1)] ?? "content"
}

function validateSoundFiles(outputDir, entries) {
  const builtinFiles = new Set(["transition.wav", "click.wav", "whoosh.wav", "pop.wav", "tap.wav", "ding.wav"])
  for (const entry of entries) {
    if (!entry.file || builtinFiles.has(entry.file)) continue
    const filePath = resolve(entry.file)
    if (!existsSync(filePath) && !existsSync(join(outputDir, entry.file))) {
      console.error(`音效文件不存在：${entry.file}`)
      process.exit(2)
    }
  }
}
