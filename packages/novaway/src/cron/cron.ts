// 5 字段 cron 的解析与「下次触发」计算，对齐 CC 的 `src/utils/cron.ts`。
//
// 支持：通配符、单个值、步进（`*/N`）、区间（`N-M`、`N-M/S`）、列表（`N,M`）。
// 不支持 `L` / `W` / `?` / 月份英文缩写。所有时间按进程本地时区解释：
// `0 9 * * *` 就是本地时间 9 点。

export type CronFields = {
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  month: number[]
  dayOfWeek: number[]
}

type FieldRange = { min: number; max: number }

const FIELD_RANGES: FieldRange[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // day of week (0 = Sunday; 7 accepted as an alias)
]

function expandField(field: string, range: FieldRange): number[] | undefined {
  const { min, max } = range
  const out = new Set<number>()

  for (const part of field.split(",")) {
    const step = part.match(/^\*(?:\/(\d+))?$/)
    if (step) {
      const size = step[1] ? Number.parseInt(step[1], 10) : 1
      if (size < 1) return undefined
      for (let value = min; value <= max; value += size) out.add(value)
      continue
    }

    const span = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/)
    if (span) {
      const low = Number.parseInt(span[1]!, 10)
      const high = Number.parseInt(span[2]!, 10)
      const size = span[3] ? Number.parseInt(span[3], 10) : 1
      // day of week: accept 7 as Sunday inside ranges (5-7 = Fri, Sat, Sun)
      const isDow = min === 0 && max === 6
      const limit = isDow ? 7 : max
      if (low > high || size < 1 || low < min || high > limit) return undefined
      for (let value = low; value <= high; value += size) out.add(isDow && value === 7 ? 0 : value)
      continue
    }

    const single = part.match(/^\d+$/)
    if (single) {
      let value = Number.parseInt(part, 10)
      if (min === 0 && max === 6 && value === 7) value = 0
      if (value < min || value > max) return undefined
      out.add(value)
      continue
    }

    return undefined
  }

  if (out.size === 0) return undefined
  return [...out].sort((a, b) => a - b)
}

/** 解析 5 字段表达式；语法不支持时返回 undefined。 */
export function parse(expression: string): CronFields | undefined {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return undefined

  const expanded: number[][] = []
  for (let index = 0; index < 5; index++) {
    const result = expandField(parts[index]!, FIELD_RANGES[index]!)
    if (!result) return undefined
    expanded.push(result)
  }

  return {
    minute: expanded[0]!,
    hour: expanded[1]!,
    dayOfMonth: expanded[2]!,
    month: expanded[3]!,
    dayOfWeek: expanded[4]!,
  }
}

/** 校验表达式；合法时返回 undefined。 */
export function validate(expression: string) {
  return parse(expression)
    ? undefined
    : `Invalid cron expression: "${expression}". Use the standard 5-field form (minute hour day-of-month month day-of-week), e.g. "*/5 * * * *" or "0 9 * * 1-5".`
}

/**
 * 计算严格晚于 `from` 的下一次触发时间。
 *
 * 同时约束 day-of-month 与 day-of-week 时按标准 cron 的「任一匹配」语义。
 * 逐分钟推进，最多找 366 天。
 */
export function nextRun(fields: CronFields, from: Date): Date | undefined {
  const minutes = new Set(fields.minute)
  const hours = new Set(fields.hour)
  const days = new Set(fields.dayOfMonth)
  const months = new Set(fields.month)
  const weekdays = new Set(fields.dayOfWeek)

  const domWild = fields.dayOfMonth.length === 31
  const dowWild = fields.dayOfWeek.length === 7

  const at = new Date(from.getTime())
  at.setSeconds(0, 0)
  at.setMinutes(at.getMinutes() + 1)

  const limit = 366 * 24 * 60
  for (let step = 0; step < limit; step++) {
    if (!months.has(at.getMonth() + 1)) {
      at.setMonth(at.getMonth() + 1, 1)
      at.setHours(0, 0, 0, 0)
      continue
    }

    const dayMatches =
      domWild && dowWild
        ? true
        : domWild
          ? weekdays.has(at.getDay())
          : dowWild
            ? days.has(at.getDate())
            : days.has(at.getDate()) || weekdays.has(at.getDay())

    if (!dayMatches) {
      at.setDate(at.getDate() + 1)
      at.setHours(0, 0, 0, 0)
      continue
    }

    if (!hours.has(at.getHours())) {
      at.setHours(at.getHours() + 1, 0, 0, 0)
      continue
    }

    if (!minutes.has(at.getMinutes())) {
      at.setMinutes(at.getMinutes() + 1)
      continue
    }

    return at
  }

  return undefined
}

/** 下一次触发时间的毫秒时间戳；表达式非法或找不到时返回 undefined。 */
export function nextRunAt(expression: string, from: Date) {
  const fields = parse(expression)
  if (!fields) return undefined
  return nextRun(fields, from)?.getTime()
}
