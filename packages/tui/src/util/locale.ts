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
