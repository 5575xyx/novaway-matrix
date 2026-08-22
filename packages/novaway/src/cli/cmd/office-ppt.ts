import path from "node:path"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { exportHtmlDeckToPptx, listHtmlSlides } from "@/office/pptx/html-export"
import { reviewHtmlSlides } from "@/office/pptx/html-review"
import { cmd } from "./cmd"

type Args = {
  deck: string
  output?: string
  force?: boolean
  reviewOnly?: boolean
  browserChannel?: string
  visualBaseline?: string
  video?: boolean
  narrationAudio?: string
  soundEffects?: string
  burnSubtitles?: boolean
  maxRmse?: number
  maxDhash?: number
}

export const OfficePptCommand = cmd<object, Args>({
  command: "office-ppt <deck>",
  describe: "审查 HTML 幻灯片并导出为可编辑 PPTX",
  builder: (yargs) =>
    yargs
      .positional("deck", {
        type: "string",
        demandOption: true,
        describe: "包含 pages/page_*.html 的 PPT 工作区",
      })
      .option("output", {
        alias: "o",
        type: "string",
        describe: "输出 PPTX 路径；相对路径基于 PPT 工作区",
      })
      .option("review-only", {
        type: "boolean",
        default: false,
        describe: "只执行画布、文字溢出、图片与截图审查，不导出 PPTX",
      })
      .option("browser-channel", {
        type: "string",
        describe: "Playwright 浏览器通道；默认依次尝试 chrome、msedge",
      })
      .option("force", {
        type: "boolean",
        default: false,
        describe: "明确跳过缺失、无法识别或过期的视觉审查状态",
      })
      .option("visual-baseline", {
        type: "string",
        describe: "真实模板预览目录；传入后导出完成会自动执行视觉基准验收",
      })
      .option("video", {
        type: "boolean",
        default: false,
        describe: "导出完成后调用本机 PowerPoint 生成带旁白/动画的 MP4",
      })
      .option("narration-audio", {
        type: "string",
        describe: "旁白音频目录（包含 manifest.json）；配合 --video 自动混音",
      })
      .option("sound-effects", {
        type: "string",
        describe: "转场/对象音效目录（包含 manifest.json）；配合 --video 自动混入音轨",
      })
      .option("burn-subtitles", {
        type: "boolean",
        default: false,
        describe: "混音时把旁白目录内的 SRT 按页偏移烧录为字幕",
      })
      .option("max-rmse", {
        type: "number",
        default: 45,
        describe: "视觉基准 RMSE 阈值",
      })
      .option("max-dhash", {
        type: "number",
        default: 12,
        describe: "视觉基准 dHash 阈值",
      }),
  handler: async (args) => {
    if (args.reviewOnly) {
      const deckDir = path.resolve(args.deck)
      const htmlFiles = await listHtmlSlides(path.join(deckDir, "pages"))
      const review = await reviewHtmlSlides({ deckDir, htmlFiles, browserChannel: args.browserChannel })
      await printJson({ success: review.status === "passed", review })
      if (review.status !== "passed") process.exitCode = 1
      return
    }

    const result = await exportHtmlDeckToPptx({
      deckDir: args.deck,
      output: args.output,
      force: args.force,
      browserChannel: args.browserChannel,
    })
    const validations: Record<string, unknown> = {}
    if (args.visualBaseline) {
      validations.visualBaseline = await runPowerShellScript(resolveScript("verify-ppt-visual-baseline.ps1"), [
        "-TemplateDir",
        path.resolve(args.visualBaseline),
        "-GeneratedPptx",
        result.output,
        "-OutputDir",
        path.join(path.dirname(result.output), "validation", "visual"),
        "-MaxRmse",
        String(args.maxRmse ?? 45),
        "-MaxDhash",
        String(args.maxDhash ?? 12),
      ])
    }
    if (args.video) {
      const videoName = `${path.basename(result.output, ".pptx")}.mp4`
      const videoDir = path.join(path.dirname(result.output), "validation", "video")
      const videoExport = await runPowerShellScript(resolveScript("export-ppt-video.ps1"), [
        "-PptxPath",
        result.output,
        "-OutputMp4",
        path.join(videoDir, videoName),
      ])
      const videoValidation: Record<string, unknown> = { ...videoExport, mp4: path.join(videoDir, videoName) }
      if (args.narrationAudio) {
        const mixedName = `${path.basename(result.output, ".pptx")}.mixed.mp4`
        const mixArgs = [
          resolveScript("mix-ppt-video.mjs"),
          path.join(videoDir, videoName),
          path.resolve(args.narrationAudio),
          path.join(videoDir, mixedName),
        ]
        if (args.soundEffects) mixArgs.push("--sound-effects", path.resolve(args.soundEffects))
        if (args.burnSubtitles) mixArgs.push("--burn-subtitles")
        videoValidation.mixed = await runNodeScript(process.execPath, mixArgs)
      }
      validations.video = videoValidation
    }
    await printJson({ success: true, ...result, validations })
  },
})

async function printJson(value: unknown) {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(value)}\n`, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function runPowerShellScript(script: string, args: string[]) {
  const shell =
    process.platform === "win32" ? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" : "powershell"
  const { stdout, stderr } = await promisify(execFile)(shell, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    ...args,
  ])
  const output = stdout.trim() || stderr.trim()
  if (!output) return { ok: true }
  try {
    return { ok: true, output: JSON.parse(output) }
  } catch {
    return { ok: true, output }
  }
}

async function runNodeScript(executable: string, args: string[]) {
  const { stdout, stderr } = await promisify(execFile)(executable, args)
  const output = stdout.trim() || stderr.trim()
  if (!output) return { ok: true }
  return { ok: true, output }
}

function resolveScript(name: string) {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(currentDir, "../../../../../script", name)
}
