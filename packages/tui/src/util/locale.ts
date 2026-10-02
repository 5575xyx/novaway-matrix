export function titlecase(str: string) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function time(input: number): string {
  const date = new Date(input)
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export function datetime(input: number): string {
  const date = new Date(input)
  const localTime = time(input)
  const localDate = date.toLocaleDateString()
  return `${localTime} · ${localDate}`
}

export function todayTimeOrDateTime(input: number): string {
  const date = new Date(input)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()

  if (isToday) {
    return time(input)
  } else {
    return datetime(input)
  }
}

export function number(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}

export function duration(input: number) {
  if (input < 1000) {
    return `${input}ms`
  }
  if (input < 60000) {
    return `${(input / 1000).toFixed(1)}s`
  }
  if (input < 3600000) {
    const minutes = Math.floor(input / 60000)
    const seconds = Math.floor((input % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }
  if (input < 86400000) {
    const hours = Math.floor(input / 3600000)
    const minutes = Math.floor((input % 3600000) / 60000)
    return `${hours}h ${minutes}m`
  }
  const days = Math.floor(input / 86400000)
  const hours = Math.floor((input % 86400000) / 3600000)
  return `${days}d ${hours}h`
}

export function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len - 1) + "…"
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/**
 * 字符串占多少**终端列**。ASCII 1 列、CJK 与 emoji 2 列。
 *
 * 为什么不能直接用 str.length:侧栏里所有宽度预算(文件名、分支名、徽标)说的都是
 * 「还能放下多少列」,而上面的 truncate/oneLine 家族数的是 UTF-16 码元 —— 一条中文路径
 * 33 个码元能占 50 列,按 33 截断就等于放任渲染器在卡片右边框上硬裁,省略号和扩展名
 * 全丢。与 prompt/display.ts 的 promptOffsetWidth 同一套量法(Intl.Segmenter 切字素 +
 * Bun.stringWidth 量宽度),分开是因为那边的口径是「textarea 的字符偏移」。
 */
export function displayWidth(value: string): number {
  let width = 0
  for (const part of graphemes.segment(value)) width += Bun.stringWidth(part.segment)
  return width
}

/**
 * 按显示列截尾,放不下就留一个省略号(占 1 列)。预算 <= 0 返回空串。
 * 「一定不超预算」是这个函数存在的全部意义 —— 它是调用方唯一能信的宽度上限。
 */
export function truncateToWidth(value: string, columns: number): string {
  if (displayWidth(value) <= columns) return value
  if (columns <= 1) return columns <= 0 ? "" : "…"
  let width = 0
  let result = ""
  for (const part of graphemes.segment(value)) {
    const next = width + Bun.stringWidth(part.segment)
    // 省略号本身占 1 列,所以正文只能用到 columns - 1
    if (next > columns - 1) break
    width = next
    result += part.segment
  }
  return result + "…"
}

/**
 * 按显示列截头,左端留省略号 —— 路径类文本用它,尾部(文件名 + 扩展名)比头部(目录)重要。
 * 和 truncateLeft 同一个意图,只是预算单位从码元换成列。
 */
export function truncateLeftToWidth(value: string, columns: number): string {
  if (displayWidth(value) <= columns) return value
  if (columns <= 1) return columns <= 0 ? "" : "…"
  const parts = [...graphemes.segment(value)]
  let width = 0
  let start = parts.length
  for (let index = parts.length - 1; index >= 0; index--) {
    const next = width + Bun.stringWidth(parts[index]!.segment)
    if (next > columns - 1) break
    width = next
    start = index
  }
  return (
    "…" +
    parts
      .slice(start)
      .map((part) => part.segment)
      .join("")
  )
}

/**
 * 把任意文本压成"保证只占一行"的形式:换行/制表/连续空白全部折成单个空格,
 * 顺便去掉 C0 控制字符,最后按 len 截断。
 *
 * 存在的理由:模型和工具产出的文本经常是整段多行的(sequential-thinking 的 thought、
 * LSP 诊断、provider 的错误体……)。这些文本被塞进一个"逻辑上是一行"的渲染行里时,
 * 里面的 \n 是硬换行,渲染器压不住,这一行就变成几十行高 —— 高度失控,行尾的字符
 * 还会被甩到下一行行首,看起来就是整个界面变形。wrapMode="none" 只能压软折行,
 * 压不住硬换行,所以必须在数据层面先抹掉。
 */
export function oneLine(str: string, len: number): string {
  const flattened = str
    // \p{Cc} = C0/C1 控制字符,换行、制表、回车都在里面,统统换成空格。
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  return truncate(flattened, len)
}

/** oneLine 的列数版本:先压平成一行,再按显示列截断(见 truncateToWidth)。 */
export function oneLineToWidth(value: string, columns: number): string {
  return truncateToWidth(oneLine(value, Number.MAX_SAFE_INTEGER), columns)
}

export function truncateLeft(str: string, len: number): string {
  if (str.length <= len) return str
  return "…" + str.slice(-(len - 1))
}

export function truncateMiddle(str: string, maxLength: number = 35): string {
  if (str.length <= maxLength) return str

  const ellipsis = "…"
  const keepStart = Math.ceil((maxLength - ellipsis.length) / 2)
  const keepEnd = Math.floor((maxLength - ellipsis.length) / 2)

  return str.slice(0, keepStart) + ellipsis + str.slice(-keepEnd)
}

export function pluralize(count: number, singular: string, plural: string): string {
  const template = count === 1 ? singular : plural
  return template.replace("{}", count.toString())
}

export * as Locale from "./locale"
