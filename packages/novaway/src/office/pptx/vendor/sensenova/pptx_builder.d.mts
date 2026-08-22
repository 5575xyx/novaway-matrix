import type { SenseNovaExtractedPage } from "./dom_extractor.mjs"

export type SenseNovaBuildResult = {
  successCount: number
  failCount: number
  totalPages: number
  failures: Array<{ path: string; message: string }>
}

export function buildPptx(
  pages: SenseNovaExtractedPage[],
  deckDir: string,
  outputPath: string,
): Promise<SenseNovaBuildResult>
