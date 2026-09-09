import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@novaway/core/flag/flag"
import { Installation } from "@/installation"
import { InstallationVersion } from "@novaway/core/installation/version"
import { GlobalBus } from "@/bus/global"
import { errorMessage } from "@/util/error"
import { Cause } from "effect"

// 失败原因压成一行塞进事件里:npm 的 stderr 经常是十几行,toast 只吃得下一句。
function errorStderr(error: unknown, seen = new Set<object>()): string | undefined {
  if (typeof error !== "object" || error === null || seen.has(error)) return undefined
  seen.add(error)

  if (Cause.isCause(error)) return errorStderr(Cause.squash(error), seen)
  const value = error as Record<string, unknown>
  if (typeof value.stderr === "string" && value.stderr.trim()) return value.stderr

  for (const key of ["cause", "error", "defect", "reasons"] as const) {
    const child = value[key]
    if (child !== undefined) {
      const stderr = errorStderr(child, seen)
      if (stderr) return stderr
    }
  }
  return undefined
}

function shortReason(error: unknown): string {
  const message = errorStderr(error) || errorMessage(error)
  const line = message
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean)
  if (!line || line === "UpgradeFailedError") return "原因未知，可稍后运行 novaway upgrade 重试"
  return line.length > 120 ? `${line.slice(0, 117)}...` : line
}

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  if (config.autoupdate === false || Flag.NOVAWAY_DISABLE_AUTOUPDATE) return
  const method = await Installation.method()
  const latest = await Installation.latest(method).catch(() => {})
  if (!latest) return

  if (Flag.NOVAWAY_ALWAYS_NOTIFY_UPDATE) {
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Installation.Event.UpdateAvailable.type,
        properties: { version: latest },
      },
    })
    return
  }

  if (InstallationVersion === latest) return

  const kind = Installation.getReleaseType(InstallationVersion, latest)

  if (config.autoupdate === "notify" || kind !== "patch") {
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Installation.Event.UpdateAvailable.type,
        properties: { version: latest },
      },
    })
    return
  }

  if (method === "unknown") return
  await Installation.upgrade(method, latest)
    .then(() =>
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: latest },
        },
      }),
    )
    .catch((error) =>
      // 失败不再静默:发事件让 TUI 弹 toast,不然镜像滞后这类环境问题用户永远发现不了。
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.UpdateFailed.type,
          properties: { version: latest, reason: shortReason(error) },
        },
      }),
    )
}
