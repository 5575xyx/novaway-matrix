const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi },
  { name: "basic", re: /\bBasic\s+[A-Za-z0-9+/]+=*/gi },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  { name: "aws", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "openai", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  {
    name: "assignment",
    re: /\b(api[_-]?key|access[_-]?token|secret|password|passwd|authorization)\b\s*[:=]\s*([^\s"'`]+)/gi,
  },
]

export function redactSecrets(input: string): string {
  let text = input
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.name === "assignment") {
      text = text.replace(pattern.re, (_match, key: string) => `${key}=***REDACTED***`)
      continue
    }
    text = text.replace(pattern.re, "***REDACTED***")
  }
  return text
}

export function redactBytes(input: Uint8Array | Buffer): Buffer {
  return Buffer.from(redactSecrets(Buffer.from(input).toString("utf8")), "utf8")
}

export function redactUrl(input: string): string {
  try {
    const url = new URL(input)
    for (const key of [...url.searchParams.keys()]) {
      if (/(token|secret|password|passwd|api[_-]?key|authorization)/i.test(key)) {
        url.searchParams.set(key, "***REDACTED***")
      }
    }
    if (url.username) url.username = "***REDACTED***"
    if (url.password) url.password = "***REDACTED***"
    return redactSecrets(url.toString())
  } catch {
    return redactSecrets(input)
  }
}

export function redactEvidence(input: readonly string[]): string[] {
  return input.map((value) => redactUrl(value))
}

export function redactArgv(argv: readonly string[]): string[] {
  return argv.map((value, index) => {
    const previous = (argv[index - 1] ?? "").toLowerCase()
    if (/^--?(api[_-]?key|access[_-]?token|token|secret|password|passwd|authorization)$/.test(previous)) {
      return "***REDACTED***"
    }
    return redactSecrets(value)
  })
}

export * as PowersNexusRedact from "./redact"
