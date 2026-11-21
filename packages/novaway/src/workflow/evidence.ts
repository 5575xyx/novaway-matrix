import type { AddInput } from "@/memory/schema"
import type { SessionID } from "@/session/schema"

export function memoryInput(input: { sessionID: SessionID; source: string; evidence: Record<string, unknown> }): AddInput {
  return {
    sessionID: input.sessionID,
    scope: "session",
    target: "memory",
    kind: "lesson",
    source: "tool",
    content: JSON.stringify({ source: input.source, evidence: input.evidence }),
    summary: "Workflow verification evidence",
    tags: ["workflow-evidence"],
  }
}
