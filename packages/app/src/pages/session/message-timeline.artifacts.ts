import type { AssistantMessage, Part, UserMessage } from "@novaway/sdk/v2"
import { LOCAL_URL, normalizeLocalUrl, stripAnsi } from "@/utils/dev-server-detect"
import { isExcludedPath, resolveWorkspacePath } from "@/utils/preview-sources"
import { uniqueSummaryDiffs } from "./message-timeline.summary-diffs"
import { buildPreviewCardCandidates, selectPrimaryDeliverables } from "./preview-card-extract"
import { collectTurnWrittenPaths } from "./written-files"

export function previewCandidatesForTurn(
  message: UserMessage,
  assistants: readonly AssistantMessage[],
  directory: string,
  partsOf: (id: string) => readonly Part[],
) {
  // Don't read streaming parts until the whole turn has finished.
  if (!assistants.length || assistants.some((item) => typeof item.time.completed !== "number")) return
  const parts = assistants.flatMap((message) => partsOf(message.id))
  const text: string[] = []
  const urls = new Set<string>()
  for (const part of parts) {
    if (part.type === "text" && !part.synthetic && !part.ignored && part.text) text.push(part.text)
    if (part.type !== "tool" || !("output" in part.state) || typeof part.state.output !== "string") continue
    if (!part.state.output) continue
    for (const match of stripAnsi(part.state.output).matchAll(LOCAL_URL)) {
      const url = normalizeLocalUrl(match[0])
      if (url) urls.add(url)
    }
  }

  // HTML/Markdown cards need write evidence from either the turn diff or the write tool.
  // Non-Git workspaces can still supply the second kind of evidence.
  const changedFilePaths = [...new Set([
    ...uniqueSummaryDiffs(message.summary?.diffs).map((diff) => resolveWorkspacePath(diff.file, directory)),
    ...collectTurnWrittenPaths(parts, directory),
  ])].filter((path) => !!path && !isExcludedPath(path))
  const candidates = selectPrimaryDeliverables(buildPreviewCardCandidates({
    turnText: text.join("\n\n"),
    workspacePath: directory,
    changedFilePaths,
    bashUrls: [...urls],
  })).filter((candidate) => !candidate.path || !isExcludedPath(candidate.path))
  if (!candidates.length) return
  return { signature: JSON.stringify([directory, candidates]), candidates }
}
