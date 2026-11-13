import { createSignal } from "solid-js"
import type { SummaryDiff } from "./message-timeline.data"

const STORAGE_KEY = "novaway-turn-review.v1"
const [version, setVersion] = createSignal(0)

function readAll(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === "string"))
  } catch {
    return {}
  }
}

function writeAll(map: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    setVersion((value) => value + 1)
    return true
  } catch {
    return false
  }
}

export function turnDiffSignature(diffs: SummaryDiff[]) {
  return JSON.stringify(diffs)
}

export function isTurnApproved(sessionID: string, messageID: string, diffs: SummaryDiff[]) {
  version()
  return readAll()[JSON.stringify([sessionID, messageID])] === turnDiffSignature(diffs)
}

export function approveTurn(sessionID: string, messageID: string, diffs: SummaryDiff[]) {
  return writeAll({ ...readAll(), [JSON.stringify([sessionID, messageID])]: turnDiffSignature(diffs) })
}

export function undoTurnApproval(sessionID: string, messageID: string) {
  const map = readAll()
  delete map[JSON.stringify([sessionID, messageID])]
  return writeAll(map)
}
