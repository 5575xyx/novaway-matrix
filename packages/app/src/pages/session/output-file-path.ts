/**
 * 聊天正文里的文件链接 → 面板真能读到的项目内路径。
 *
 * 正文里的路径大多出自模型手打，常见形态是一个**裸文件名**
 * （`product_promo_20261101_134706.pptx`）。而 `/file/content` 接的是项目根相对路径
 * 或绝对路径：裸文件名会被当成根目录下的文件，一定读不到 —— 侧栏文件树打开同一个
 * 文件却没事，因为它给的是带目录的真实相对路径。
 *
 * 「先解析、再打开」：把裸名交给按名搜索，只在**唯一命中**时自动纠正；
 * 多个同名候选时不猜，保留原路径，让预览面板把失败原因说清楚。
 */

/** 看起来只是个文件名，没有目录信息（既不是绝对路径，也不带相对目录）。 */
export function isBareFileName(path: string | undefined) {
  if (!path) return false
  const value = path.trim()
  if (!value) return false
  if (/^[A-Za-z]:/.test(value) || value.startsWith("/") || value.startsWith("\\") || value.startsWith("~")) return false
  return !value.includes("/") && !value.includes("\\")
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

/**
 * 从搜索结果里挑出「文件名正好等于它」的路径。
 *
 * 搜索是模糊的（fzf 式打分），`a.pptx` 也会召回 `aa.pptx`、`a.pptx.bak`；
 * 只有逐段比对过文件名的结果才敢拿来改写用户点的那个链接。
 * 命中 0 条或不止 1 条都返回 undefined —— 宁可不改，也不要打开另一个文件。
 */
export function matchUniqueFileName(basename: string, results: readonly string[]): string | undefined {
  const want = basename.trim().toLowerCase()
  if (!want) return undefined
  const hits = [...new Set(results.filter((item) => baseName(item).toLowerCase() === want))]
  return hits.length === 1 ? hits[0] : undefined
}
