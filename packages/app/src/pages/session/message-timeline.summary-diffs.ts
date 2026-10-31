import type { SnapshotFileDiff } from "@novaway/sdk/v2"
import type { SummaryDiff } from "./message-timeline.data"

/**
 * `.novaway/` 下是应用自己的产物（浏览器验证截图、计划文件、临时产物等）。
 *
 * 它们确实写进了工作区，也会出现在快照 diff 里，但不是用户眼里的"本次调整"：
 * 一轮里只要工具截了几张图，"本次调整 9 个文件"就会被 9 张 png 占满，
 * 真正改过的源码反而被挤到"还有 N 个文件"后面。
 */
function isAppArtifact(file: string) {
  return file.replaceAll("\\", "/").startsWith(".novaway/")
}

export function uniqueSummaryDiffs(diffs: SnapshotFileDiff[] | undefined) {
  const files = new Set<string>()
  return (diffs ?? [])
    .reduceRight<SummaryDiff[]>((result, diff) => {
      if (!isSummaryDiff(diff)) return result
      const file = diff.file
      if (isAppArtifact(file)) return result
      if (files.has(file)) return result
      files.add(file)
      result.push(diff)
      return result
    }, [])
    .reverse()
}

function isSummaryDiff(diff: SnapshotFileDiff): diff is SummaryDiff {
  return typeof diff.file === "string"
}
