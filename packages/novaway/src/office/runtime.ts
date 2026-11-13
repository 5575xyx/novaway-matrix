import type { OfficeEngine, OfficeFormat } from "@novaway/core/office/engine/contract"
import { officeFormatOf } from "@novaway/core/office/engine/registry"
import type { OfficeEngineContribution, Registry } from "@novaway/plugin-api"

/** The instance-scoped office registry exposed by the Runtime Host. */
export type RuntimeOfficeRegistry = Pick<Registry<OfficeEngineContribution>, "resolve" | "list">

export function extensionOfPath(filepath: string): string {
  const name = filepath.split(/[\/]/).pop() ?? filepath
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase()
}

/** Resolve Core formats first, then the active instance's builtin plugin engines. */
export function runtimeOfficeFormatOf(filepath: string, registry?: RuntimeOfficeRegistry): OfficeFormat | undefined {
  const builtIn = officeFormatOf(filepath)
  if (registry === undefined || builtIn !== "text" || extensionOfPath(filepath) === "txt") return builtIn
  const extension = extensionOfPath(filepath)
  return (
    registry
      .list()
      .find((item) => item.extensions.some((candidate) => candidate.replace(/^\./, "").toLowerCase() === extension))
      ?.format ?? builtIn
  )
}

export function runtimeEngineFor(
  format: OfficeFormat,
  registry?: RuntimeOfficeRegistry,
): OfficeEngine<unknown> | undefined {
  const dynamic = registry?.resolve(format)?.engine
  return (dynamic as OfficeEngine<unknown> | undefined) ?? undefined
}
