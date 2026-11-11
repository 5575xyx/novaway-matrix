import type { Instance } from "./host"
import type { PluginErrorRecord } from "./state.sql"
import type { Entry } from "./catalog"

export type Diagnostic = {
  pluginID: string
  scope: Instance["scope"]
  severity: "error" | "warning" | "info"
  code: string
  message: string
  field?: string
  capability?: string
  contribution?: Pick<Entry, "kind" | "name" | "localName" | "status">
}

export function collect(
  instances: readonly Instance[],
  errors: readonly { pluginID: string; scope: Instance["scope"]; error: PluginErrorRecord }[] = [],
  contributions: readonly Entry[] = [],
): Diagnostic[] {
  const result: Diagnostic[] = []

  for (const item of instances) {
    for (const issue of item.issues) {
      result.push({
        pluginID: item.id,
        scope: item.scope,
        severity: issue.level,
        code: issue.code,
        message: issue.message,
        ...(issue.field === undefined ? {} : { field: issue.field }),
      })
    }
    for (const issue of item.diagnostics) {
      result.push({
        pluginID: item.id,
        scope: item.scope,
        severity: issue.level,
        code: issue.code,
        message: issue.message,
        ...(issue.field === undefined ? {} : { field: issue.field }),
      })
    }
  }

  for (const item of contributions) {
    result.push({
      pluginID: item.pluginID,
      scope: item.scope,
      severity: "info",
      code: "contribution.declared",
      message: `${item.kind} contribution "${item.name}" is declared`,
      contribution: {
        kind: item.kind,
        name: item.name,
        localName: item.localName,
        status: item.status,
      },
    })
  }

  for (const item of errors) {
    const capability =
      item.error.code === "capability_denied" ? item.error.message.match(/capabilities\.([\w-]+)/)?.[1] : undefined
    result.push({
      pluginID: item.pluginID,
      scope: item.scope,
      severity: "error",
      code: item.error.code,
      message: item.error.message,
      ...(capability === undefined ? {} : { capability }),
    })
  }

  return result.sort((a, b) => a.pluginID.localeCompare(b.pluginID) || a.code.localeCompare(b.code))
}

export * as PluginDiagnostics from "./diagnostics"
