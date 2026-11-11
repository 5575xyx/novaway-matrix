/** Decode the bfchar/bfrange subset of a PDF ToUnicode CMap (UTF-16BE destinations). */
export function parseToUnicode(source: string): Map<string, string> {
  const result = new Map<string, string>()
  const clean = source.replace(/%[^\r\n]*/g, "")
  const hex = (value: string) => value.replace(/\s/g, "").toUpperCase()
  const unicode = (value: string) => {
    const text = hex(value)
    let out = ""
    for (let i = 0; i + 3 < text.length; i += 4) out += String.fromCharCode(parseInt(text.slice(i, i + 4), 16))
    return out
  }
  for (const block of clean.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const match of block[1]!.matchAll(/<([\da-f\s]+)>\s*<([\da-f\s]+)>/gi)) {
      result.set(hex(match[1]!), unicode(match[2]!))
    }
  }
  for (const block of clean.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const match of block[1]!.matchAll(/<([\da-f\s]+)>\s*<([\da-f\s]+)>\s*(<([\da-f\s]+)>|\[([^\]]*)\])/gi)) {
      const first = hex(match[1]!)
      const last = hex(match[2]!)
      const start = parseInt(first, 16)
      const end = parseInt(last, 16)
      // Bound expansion for malformed or hostile documents.
      if (first.length !== last.length || end < start || end - start > 65535) continue
      const values =
        match[5] === undefined ? undefined : Array.from(match[5].matchAll(/<([\da-f\s]+)>/gi), (item) => item[1]!)
      const base = match[4] === undefined ? undefined : hex(match[4])
      for (let code = start; code <= end; code++) {
        const offset = code - start
        const value = values
          ? values[offset]
          : base === undefined
            ? undefined
            : (BigInt("0x" + base) + BigInt(offset)).toString(16).padStart(base.length, "0")
        if (value === undefined) break
        result.set(code.toString(16).padStart(first.length, "0").toUpperCase(), unicode(value))
      }
    }
  }
  return result
}

export function decodeToUnicode(bytes: Uint8Array, mapping: Map<string, string>): string {
  const lengths = [...new Set(Array.from(mapping.keys(), (key) => key.length / 2))].sort((a, b) => b - a)
  let result = ""
  for (let i = 0; i < bytes.length; ) {
    let matched = false
    for (const length of lengths) {
      if (i + length > bytes.length) continue
      const key = Array.from(bytes.subarray(i, i + length), (byte) => byte.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
      const value = mapping.get(key)
      if (value === undefined) continue
      result += value
      i += length
      matched = true
      break
    }
    if (!matched) {
      result += "�"
      i++
    }
  }
  return result
}
