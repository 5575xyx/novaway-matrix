import { checksum } from "@novaway/core/util/encode"

export function sessionAutoSubmitKey(text: string, submit: string | undefined, now = Date.now()) {
  if (submit !== "1") return undefined
  return `${checksum(text) ?? text.length}-${now}`
}
