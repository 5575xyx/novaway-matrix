import { parsePatch, type StructuredPatch } from "diff"

/**
 * `diff.parsePatch` splits the input on LF but treats a literal CR inside a
 * hunk line as data inconsistently across parsing stages. Protect those data
 * characters while parsing, then restore them in the structured hunk lines.
 */
export function parsePatchPreservingCarriageReturns(patch: string): StructuredPatch[] {
  let marker = "NOVAWAY_PATCH_CR_TOKEN"
  while (patch.includes(marker)) marker += "_"

  const parsed = parsePatch(patch.replace(/\r(?!\n)/g, marker))
  for (const file of parsed) {
    for (const hunk of file.hunks) {
      hunk.lines = hunk.lines.map((line) => line.replaceAll(marker, "\r"))
    }
  }
  return parsed
}
