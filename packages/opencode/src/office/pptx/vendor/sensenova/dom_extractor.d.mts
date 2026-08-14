export type SenseNovaExtractedPage = {
  path: string
  ir: Record<string, unknown> | null
  error?: string
}

export function extractPages(htmlPaths: string[]): Promise<SenseNovaExtractedPage[]>
