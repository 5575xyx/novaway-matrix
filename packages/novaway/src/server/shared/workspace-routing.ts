import { SessionID } from "@/session/schema"
import { Schema } from "effect"

type Rule = { method?: string; path: string; exact?: boolean; action: "local" | "forward" }

const RULES: Array<Rule> = [
  { path: "/experimental/workspace", action: "local" },
  { path: "/session/status", action: "forward" },
  { method: "GET", path: "/session", action: "local" },
]

export function isLocalWorkspaceRoute(method: string, path: string) {
  for (const rule of RULES) {
    if (rule.method && rule.method !== method) continue
    const match = rule.exact ? path === rule.path : path === rule.path || path.startsWith(rule.path + "/")
    if (match) return rule.action === "local"
  }
  return false
}

/**
 * Extract the session id from a `/session/<id>...` path.
 *
 * Literal sub-routes such as `/session/status` and `/session/import` have the
 * same shape, so the segment is only treated as an id when it actually parses
 * as a SessionID. `SessionID.make` throws on a bad brand, and this runs inside
 * router middleware where a throw turns into a 500 instead of a route miss.
 */
export function getWorkspaceRouteSessionID(url: URL) {
  if (url.pathname === "/session/status") return null

  const id = url.pathname.match(/^\/session\/([^/]+)(?:\/|$)/)?.[1]
  if (!id || !Schema.is(SessionID)(id)) return null

  return id as SessionID
}

export function workspaceProxyURL(target: string | URL, requestURL: URL) {
  const proxyURL = new URL(target)
  proxyURL.pathname = `${proxyURL.pathname.replace(/\/$/, "")}${requestURL.pathname}`
  proxyURL.search = requestURL.search
  proxyURL.hash = requestURL.hash
  proxyURL.searchParams.delete("workspace")
  return proxyURL
}
