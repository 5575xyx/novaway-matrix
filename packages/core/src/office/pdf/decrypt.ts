/**
 * 加密 PDF 的解密前置层。
 *
 * pdf-lib 只能**认出**加密文件并拒绝打开，不会解密。为了让 --password
 * 和面板里的「输入密码」真正可用，这里自己做 PDF 标准安全处理器
 * （/Filter /Standard）那一层：
 *
 *   1. 扫顶层对象、读 /Encrypt 字典；
 *   2. 用用户密码（或所有者密码）按规范算出文件密钥；
 *   3. 按对象解密字符串和流（RC4 / AES-128 / AES-256）；
 *   4. 去掉 /Encrypt，重排一份**未加密**的 PDF（xref 重新生成）。
 *
 * 解出来的字节只交给 pdf-lib 解析；写回时是未加密文件，这和
 * 「另存为时去掉密码」的常见做法一致，编辑后的文件不再要求密码。
 *
 * 支持范围（与主流阅读器一致）：
 *   - R2 / R3 / R4：RC4 40/128 位、AESV2；
 *   - R5 / R6：AES-256；
 *   - 不支持的加密方式（公钥证书、未知 CFM）明确报错，不猜。
 */
import { PASSWORD_PADDING, aesCbcDecrypt, aesCbcEncrypt, bytesToHex, concatBytes, md5, rc4, sha2 } from "./cipher"

export type PdfProtection = "rc4" | "aes-128" | "aes-256"

export type PdfDecryptResult =
  | {
      ok: true
      /** 解密（或原样）后的字节。 */
      bytes: Uint8Array
      encrypted: boolean
      protection?: PdfProtection
      /** 打开文件时实际用的是哪一种密码。 */
      usedPassword?: "user" | "owner"
    }
  | {
      ok: false
      reason: "password_required" | "invalid_password" | "unsupported" | "damaged"
      message: string
      suggestion?: string
    }

// ---------------------------------------------------------------------------
// 字节 ↔ latin1 字符串
//
// PDF 的语法层是单字节的：一个字符就是一个字节。用 latin1 解码可以
// 让「字符串下标 == 字节偏移」，扫描和重建都简单可靠。
// ---------------------------------------------------------------------------

export function latin1Decode(bytes: Uint8Array): string {
  let text = ""
  const chunk = 0x8000
  for (let at = 0; at < bytes.length; at += chunk) {
    text += String.fromCharCode(...bytes.subarray(at, Math.min(bytes.length, at + chunk)))
  }
  return text
}

export function latin1Encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff
  return out
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f" || char === "\0"
}

function isDelimiter(char: string): boolean {
  return char !== "" && "()<>[]{}/%".includes(char)
}

function isRegular(char: string): boolean {
  return char !== "" && !isWhitespace(char) && !isDelimiter(char)
}

function isEol(char: string | undefined): boolean {
  return char === "\n" || char === "\r"
}

// ---------------------------------------------------------------------------
// 极简 PDF 对象解析（只解析 /Encrypt 和对象字典需要的部分）
// ---------------------------------------------------------------------------

export type PdfValue =
  | { kind: "name"; value: string }
  | { kind: "number"; value: number }
  | { kind: "string"; bytes: Uint8Array; hex: boolean }
  | { kind: "array"; items: PdfValue[] }
  | { kind: "dict"; entries: Map<string, PdfValue> }
  | { kind: "bool"; value: boolean }
  | { kind: "null" }
  | { kind: "ref"; num: number; gen: number }

export function dictGet(value: PdfValue | undefined, key: string): PdfValue | undefined {
  if (value?.kind !== "dict") return undefined
  // 字典键保存为不带斜杠的名字（/Type → "Type"），调用方两种写法都接受。
  return value.entries.get(key.startsWith("/") ? key.slice(1) : key)
}

export function asName(value: PdfValue | undefined): string | undefined {
  return value?.kind === "name" ? value.value : undefined
}

export function asNumber(value: PdfValue | undefined): number | undefined {
  return value?.kind === "number" ? value.value : undefined
}

export function asBytes(value: PdfValue | undefined): Uint8Array | undefined {
  return value?.kind === "string" ? value.bytes : undefined
}

export function asArray(value: PdfValue | undefined): PdfValue[] | undefined {
  return value?.kind === "array" ? value.items : undefined
}

export function asRef(value: PdfValue | undefined): { num: number; gen: number } | undefined {
  return value?.kind === "ref" ? { num: value.num, gen: value.gen } : undefined
}

class PdfReader {
  pos: number

  constructor(
    readonly text: string,
    start = 0,
  ) {
    this.pos = start
  }

  skipSpace(): void {
    while (this.pos < this.text.length) {
      const char = this.text[this.pos]!
      if (isWhitespace(char)) {
        this.pos += 1
        continue
      }
      if (char === "%") {
        while (this.pos < this.text.length && !isEol(this.text[this.pos])) this.pos += 1
        continue
      }
      break
    }
  }

  readValue(): PdfValue | undefined {
    this.skipSpace()
    const char = this.text[this.pos]
    if (char === undefined) return undefined
    if (char === "/") return { kind: "name", value: this.readName() }
    if (char === "<" && this.text[this.pos + 1] === "<") return { kind: "dict", entries: this.readDict() }
    if (char === "<") return { kind: "string", bytes: this.readHexString(), hex: true }
    if (char === "(") return { kind: "string", bytes: this.readLiteralString(), hex: false }
    if (char === "[") return { kind: "array", items: this.readArray() }
    if (this.text.startsWith("true", this.pos) && !isRegular(this.text[this.pos + 4] ?? "")) {
      this.pos += 4
      return { kind: "bool", value: true }
    }
    if (this.text.startsWith("false", this.pos) && !isRegular(this.text[this.pos + 5] ?? "")) {
      this.pos += 5
      return { kind: "bool", value: false }
    }
    if (this.text.startsWith("null", this.pos) && !isRegular(this.text[this.pos + 4] ?? "")) {
      this.pos += 4
      return { kind: "null" }
    }
    const number = this.readNumber()
    if (number === undefined) return undefined
    if (Number.isInteger(number)) {
      const save = this.pos
      this.skipSpace()
      const second = this.readNumber()
      if (second !== undefined && Number.isInteger(second)) {
        this.skipSpace()
        if (this.text[this.pos] === "R" && !isRegular(this.text[this.pos + 1] ?? "")) {
          this.pos += 1
          return { kind: "ref", num: number, gen: second }
        }
      }
      this.pos = save
    }
    return { kind: "number", value: number }
  }

  readNumber(): number | undefined {
    this.skipSpace()
    const start = this.pos
    let sign = 1
    if (this.text[this.pos] === "+" || this.text[this.pos] === "-") {
      if (this.text[this.pos] === "-") sign = -1
      this.pos += 1
    }
    let digits = ""
    let dot = false
    while (this.pos < this.text.length) {
      const char = this.text[this.pos]!
      if (char >= "0" && char <= "9") {
        digits += char
        this.pos += 1
        continue
      }
      if (char === "." && !dot) {
        dot = true
        digits += "."
        this.pos += 1
        continue
      }
      break
    }
    if (digits === "" || digits === ".") {
      this.pos = start
      return undefined
    }
    return sign * Number(digits)
  }

  readName(): string {
    this.pos += 1 // skip "/"
    let name = ""
    while (this.pos < this.text.length) {
      const char = this.text[this.pos]!
      if (!isRegular(char)) break
      if (char === "#" && /^[0-9a-fA-F]{2}$/.test(this.text.slice(this.pos + 1, this.pos + 3))) {
        name += String.fromCharCode(Number.parseInt(this.text.slice(this.pos + 1, this.pos + 3), 16))
        this.pos += 3
        continue
      }
      name += char
      this.pos += 1
    }
    return name
  }

  readLiteralString(): Uint8Array {
    this.pos += 1 // skip "("
    const out: number[] = []
    let depth = 1
    while (this.pos < this.text.length) {
      const char = this.text[this.pos]!
      if (char === "\\") {
        this.pos += 1
        const escape = this.text[this.pos] ?? ""
        if (escape === "n") out.push(10)
        else if (escape === "r") out.push(13)
        else if (escape === "t") out.push(9)
        else if (escape === "b") out.push(8)
        else if (escape === "f") out.push(12)
        else if (escape === "(" || escape === ")" || escape === "\\") out.push(escape.charCodeAt(0))
        else if (escape === "\r") {
          this.pos += 1
          if (this.text[this.pos] === "\n") this.pos += 1
          continue
        } else if (escape === "\n") {
          this.pos += 1
          continue
        } else if (escape >= "0" && escape <= "7") {
          let value = 0
          let count = 0
          while (count < 3) {
            const digit = this.text[this.pos] ?? ""
            if (digit < "0" || digit > "7") break
            value = value * 8 + Number(digit)
            this.pos += 1
            count += 1
          }
          out.push(value & 0xff)
          continue
        } else if (escape !== "") out.push(escape.charCodeAt(0) & 0xff)
        this.pos += 1
        continue
      }
      if (char === "(") {
        depth += 1
        out.push(40)
        this.pos += 1
        continue
      }
      if (char === ")") {
        depth -= 1
        this.pos += 1
        if (depth === 0) break
        out.push(41)
        continue
      }
      out.push(char.charCodeAt(0) & 0xff)
      this.pos += 1
    }
    return Uint8Array.from(out)
  }

  readHexString(): Uint8Array {
    this.pos += 1 // skip "<"
    let hex = ""
    while (this.pos < this.text.length && this.text[this.pos] !== ">") {
      const char = this.text[this.pos]!
      if (!isWhitespace(char)) hex += char
      this.pos += 1
    }
    if (this.text[this.pos] === ">") this.pos += 1
    if (hex.length % 2 === 1) hex += "0"
    const out = new Uint8Array(hex.length / 2)
    for (let index = 0; index < out.length; index += 1) {
      out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16) || 0
    }
    return out
  }

  readArray(): PdfValue[] {
    this.pos += 1 // skip "["
    const items: PdfValue[] = []
    while (this.pos < this.text.length) {
      this.skipSpace()
      if (this.text[this.pos] === "]") {
        this.pos += 1
        break
      }
      const value = this.readValue()
      if (!value) break
      items.push(value)
    }
    return items
  }

  readDict(): Map<string, PdfValue> {
    this.pos += 2 // skip "<<"
    const entries = new Map<string, PdfValue>()
    while (this.pos < this.text.length) {
      this.skipSpace()
      if (this.text.startsWith(">>", this.pos)) {
        this.pos += 2
        break
      }
      if (this.text[this.pos] !== "/") {
        if (!this.readValue()) break
        continue
      }
      const key = this.readName()
      this.skipSpace()
      const value = this.readValue()
      if (!value) break
      entries.set(key, value)
    }
    return entries
  }
}

/** 从 `start` 开始解析一个 PDF 对象；解析失败返回 undefined。 */
export function parsePdfValue(text: string, start = 0): PdfValue | undefined {
  return new PdfReader(text, start).readValue()
}
// ---------------------------------------------------------------------------
// 加密参数与密钥推导
// ---------------------------------------------------------------------------

export type PdfCryptMethod = "none" | "rc4" | "aes-128" | "aes-256"

type EncryptInfo = {
  filter: string
  version: number
  revision: number
  /** 文件密钥长度（字节）。 */
  keyLength: number
  owner: Uint8Array
  user: Uint8Array
  permissions: number
  encryptMetadata: boolean
  streamMethod: PdfCryptMethod
  stringMethod: PdfCryptMethod
  ownerEncrypted?: Uint8Array
  userEncrypted?: Uint8Array
}

function methodOf(cfm: string | undefined): PdfCryptMethod | undefined {
  if (cfm === undefined || cfm === "None") return "none"
  if (cfm === "V2") return "rc4"
  if (cfm === "AESV2") return "aes-128"
  if (cfm === "AESV3") return "aes-256"
  return undefined
}

function cryptFilterMethod(encrypt: PdfValue, name: string): PdfCryptMethod | undefined {
  if (name === "Identity") return "none"
  const filter = dictGet(dictGet(encrypt, "/CF"), "/" + name)
  return methodOf(asName(dictGet(filter, "/CFM")))
}

function readEncryptInfo(value: PdfValue): { ok: true; info: EncryptInfo } | { ok: false; message: string } {
  const filter = asName(dictGet(value, "/Filter"))
  if (filter !== "Standard") {
    return { ok: false, message: "不支持的公钥证书加密（/Filter 不是 /Standard）" }
  }
  const version = asNumber(dictGet(value, "/V")) ?? 0
  const revision = asNumber(dictGet(value, "/R")) ?? 0
  const owner = asBytes(dictGet(value, "/O"))
  const user = asBytes(dictGet(value, "/U"))
  if (!owner || !user) return { ok: false, message: "加密字典缺少 /O 或 /U，文件可能已损坏" }
  const permissions = asNumber(dictGet(value, "/P")) ?? 0
  const metadataEntry = dictGet(value, "/EncryptMetadata")
  const encryptMetadata = metadataEntry?.kind === "bool" ? metadataEntry.value : true

  let streamMethod: PdfCryptMethod = "rc4"
  let stringMethod: PdfCryptMethod = "rc4"
  let keyLength = 5
  if (version === 1 || version === 2) {
    keyLength =
      revision === 2 ? 5 : Math.min(16, Math.max(5, Math.floor((asNumber(dictGet(value, "/Length")) ?? 40) / 8)))
  } else if (version === 4 || version === 5) {
    streamMethod = cryptFilterMethod(value, asName(dictGet(value, "/StmF")) ?? "Identity") ?? "none"
    stringMethod = cryptFilterMethod(value, asName(dictGet(value, "/StrF")) ?? "Identity") ?? "none"
    if (version === 5) {
      keyLength = 32
      streamMethod = streamMethod === "none" ? "aes-256" : streamMethod
      stringMethod = stringMethod === "none" ? "aes-256" : stringMethod
      if (streamMethod !== "aes-256" || stringMethod !== "aes-256") {
        return { ok: false, message: "不支持的 AES-256 加密过滤器" }
      }
    } else {
      const bits = asNumber(dictGet(value, "/Length")) ?? 128
      keyLength = Math.min(16, Math.max(5, Math.floor(bits / 8)))
    }
  } else {
    return { ok: false, message: "不支持的 PDF 加密版本 /V " + version }
  }
  if (revision < 2 || revision > 6) return { ok: false, message: "不支持的 PDF 加密修订版 /R " + revision }
  if (streamMethod === "aes-128" || stringMethod === "aes-128") keyLength = 16
  if (streamMethod === "aes-256" || stringMethod === "aes-256") keyLength = 32

  return {
    ok: true,
    info: {
      filter,
      version,
      revision,
      keyLength,
      owner,
      user,
      permissions,
      encryptMetadata,
      streamMethod,
      stringMethod,
      ownerEncrypted: asBytes(dictGet(value, "/OE")),
      userEncrypted: asBytes(dictGet(value, "/UE")),
    },
  }
}

function passwordBytes(password: string): Uint8Array {
  // PDF 2.0 要求 SASLprep + UTF-8；这里按 UTF-8 编码并截到 127 字节，
  // 对 ASCII 密码与规范完全一致。
  return new TextEncoder().encode(password).subarray(0, 127)
}

function padPassword(password: Uint8Array): Uint8Array {
  const out = new Uint8Array(32)
  const length = Math.min(32, password.length)
  out.set(password.subarray(0, length), 0)
  out.set(PASSWORD_PADDING.subarray(0, 32 - length), length)
  return out
}

function littleEndianInt(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setInt32(0, value, true)
  return out
}

function xorKey(key: Uint8Array, value: number): Uint8Array {
  const out = new Uint8Array(key.length)
  for (let index = 0; index < key.length; index += 1) out[index] = key[index]! ^ value
  return out
}

function sameBytes(left: Uint8Array, right: Uint8Array, length?: number): boolean {
  const size = length ?? Math.min(left.length, right.length)
  if (left.length < size || right.length < size) return false
  for (let index = 0; index < size; index += 1) if (left[index] !== right[index]) return false
  return true
}

/** ISO 32000-1 Algorithm 2：由（补齐的）密码算出文件密钥。 */
function computeKeyR4(
  password: Uint8Array,
  owner: Uint8Array,
  permissions: number,
  id0: Uint8Array,
  keyLength: number,
  revision: number,
  encryptMetadata: boolean,
): Uint8Array {
  const parts: Uint8Array[] = [password, owner, littleEndianInt(permissions), id0]
  if (revision >= 4 && !encryptMetadata) parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]))
  let key = md5(concatBytes(...parts)).subarray(0, keyLength)
  if (revision >= 3) {
    for (let round = 0; round < 50; round += 1) key = md5(key).subarray(0, keyLength)
  }
  return key
}

/** ISO 32000-1 Algorithm 5：算出用来比对 /U 的 32 字节值。 */
function computeUValue(key: Uint8Array, id0: Uint8Array, revision: number): Uint8Array {
  if (revision === 2) return rc4(key, PASSWORD_PADDING)
  let value = md5(concatBytes(PASSWORD_PADDING, id0))
  value = rc4(key, value)
  for (let round = 1; round <= 19; round += 1) value = rc4(xorKey(key, round), value)
  return concatBytes(value, PASSWORD_PADDING)
}

/** 所有者的 O 值反推出（补齐的）用户密码，再用它验证；见 Algorithm 3 / 7。 */
function recoverUserPassword(
  ownerPassword: Uint8Array,
  owner: Uint8Array,
  keyLength: number,
  revision: number,
): Uint8Array {
  let key = md5(ownerPassword).subarray(0, keyLength)
  if (revision >= 3) {
    for (let round = 0; round < 50; round += 1) key = md5(key).subarray(0, keyLength)
  }
  let user = owner
  if (revision === 2) return rc4(key, user)
  for (let round = 19; round >= 0; round -= 1) user = rc4(xorKey(key, round), user)
  return user
}

type DerivedKey = { key: Uint8Array; kind: "user" | "owner" }

function deriveKeyR4(info: EncryptInfo, password: Uint8Array, id0: Uint8Array): DerivedKey | "wrong" {
  const padded = padPassword(password)
  const key = computeKeyR4(
    padded,
    info.owner,
    info.permissions,
    id0,
    info.keyLength,
    info.revision,
    info.encryptMetadata,
  )
  const expected = computeUValue(key, id0, info.revision)
  if (sameBytes(expected, info.user, info.revision === 2 ? 32 : 16)) return { key, kind: "user" }

  const recovered = recoverUserPassword(padded, info.owner, info.keyLength, info.revision)
  const ownerKey = computeKeyR4(
    recovered,
    info.owner,
    info.permissions,
    id0,
    info.keyLength,
    info.revision,
    info.encryptMetadata,
  )
  const ownerCheck = computeUValue(ownerKey, id0, info.revision)
  if (sameBytes(ownerCheck, info.user, info.revision === 2 ? 32 : 16)) return { key: ownerKey, kind: "owner" }
  return "wrong"
}

/**
 * ISO 32000-2 Algorithm 2.B（R6 的迭代哈希）。
 * K1 是「密码 + K + udata」重复 64 次；64 保证长度一定是 16 的倍数。
 */
async function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let key = await sha2("SHA-256", concatBytes(password, salt, udata))
  let round = 0
  while (true) {
    round += 1
    const unit = concatBytes(password, key, udata)
    const repeated = new Uint8Array(unit.length * 64)
    for (let index = 0; index < 64; index += 1) repeated.set(unit, index * unit.length)
    const encrypted = aesCbcEncrypt(key.subarray(0, 16), key.subarray(16, 32), repeated)
    let sum = 0
    for (let index = 0; index < 16; index += 1) sum += encrypted[index]!
    const algorithm = (["SHA-256", "SHA-384", "SHA-512"] as const)[sum % 3]!
    key = await sha2(algorithm, encrypted)
    if (round >= 64 && encrypted[encrypted.length - 1]! <= round - 32) break
  }
  return key.subarray(0, 32)
}

async function deriveKeyR5(info: EncryptInfo, password: Uint8Array): Promise<DerivedKey | "wrong"> {
  const pass = password.subarray(0, 127)
  const zero = new Uint8Array(16)
  const empty = new Uint8Array(0)
  const hashOf = (salt: Uint8Array, udata: Uint8Array) =>
    info.revision < 6 ? sha2("SHA-256", concatBytes(pass, salt, udata)) : hash2B(pass, salt, udata)

  if (info.user.length >= 48) {
    const validation = await hashOf(info.user.subarray(32, 40), empty)
    if (sameBytes(validation, info.user.subarray(0, 32), 32) && info.userEncrypted?.length === 32) {
      const intermediate = await hashOf(info.user.subarray(40, 48), empty)
      const key = aesCbcDecrypt(intermediate, zero, info.userEncrypted)
      if (key.length === 32) return { key, kind: "user" }
    }
  }
  if (info.owner.length >= 48 && info.ownerEncrypted?.length === 32) {
    const udata = info.user.subarray(0, 48)
    const validation = await hashOf(info.owner.subarray(32, 40), udata)
    if (sameBytes(validation, info.owner.subarray(0, 32), 32)) {
      const intermediate = await hashOf(info.owner.subarray(40, 48), udata)
      const key = aesCbcDecrypt(intermediate, zero, info.ownerEncrypted)
      if (key.length === 32) return { key, kind: "owner" }
    }
  }
  return "wrong"
}

// ---------------------------------------------------------------------------
// 按对象解密
// ---------------------------------------------------------------------------

function pkcs7Unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data
  const pad = data[data.length - 1]!
  if (pad < 1 || pad > 16 || pad > data.length) return data
  return data.subarray(0, data.length - pad)
}

class PdfCryptor {
  constructor(
    readonly fileKey: Uint8Array,
    readonly revision: number,
  ) {}

  #objectKey(num: number, gen: number, salted: boolean): Uint8Array {
    const extra = new Uint8Array([num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, gen & 0xff, (gen >> 8) & 0xff])
    // Algorithm 1：AESV2 的对象密钥要在输入末尾加 "sAlT"，RC4 不加。
    const input = salted
      ? concatBytes(this.fileKey, extra, new Uint8Array([0x73, 0x41, 0x6c, 0x54]))
      : concatBytes(this.fileKey, extra)
    return md5(input).subarray(0, Math.min(this.fileKey.length + 5, 16))
  }

  decrypt(method: PdfCryptMethod, num: number, gen: number, data: Uint8Array): Uint8Array {
    if (method === "none" || data.length === 0) return data
    if (method === "rc4") return rc4(this.#objectKey(num, gen, false), data)
    const key = method === "aes-256" ? this.fileKey : this.#objectKey(num, gen, true)
    if (data.length < 32 || (data.length - 16) % 16 !== 0) return data
    return pkcs7Unpad(aesCbcDecrypt(key, data.subarray(0, 16), data.subarray(16)))
  }
}
// ---------------------------------------------------------------------------
// 顶层对象扫描
// ---------------------------------------------------------------------------

type ScannedObject = {
  num: number
  gen: number
  /** "obj" 之后的位置。 */
  bodyStart: number
  /** "endobj" 的位置。 */
  bodyEnd: number
  /** "stream" 关键字的位置（没有流时为空）。 */
  streamAt?: number
  dataStart?: number
  dataEnd?: number
  /** 解析出的对象值（对象是字典时最有用）。 */
  dict?: PdfValue
}

function scanObjectAt(text: string, headerEnd: number): { obj: ScannedObject; next: number } | undefined {
  const reader = new PdfReader(text, headerEnd)
  reader.skipSpace()
  const value = reader.readValue()
  if (!value) return undefined
  reader.skipSpace()
  const afterValue = reader.pos
  if (text.startsWith("stream", afterValue)) {
    let at = afterValue + 6
    if (text[at] === "\r") at += 1
    if (text[at] === "\n") at += 1
    const dataStart = at
    let dataEnd: number | undefined
    const length = asNumber(dictGet(value, "/Length"))
    if (length !== undefined && Number.isInteger(length) && length >= 0 && dataStart + length <= text.length) {
      let check = dataStart + length
      if (text[check] === "\r") check += 1
      if (text[check] === "\n") check += 1
      if (text.startsWith("endstream", check)) dataEnd = dataStart + length
    }
    if (dataEnd === undefined) {
      const found = text.indexOf("endstream", dataStart)
      if (found < 0) return undefined
      let end = found
      if (text[end - 1] === "\n") end -= 1
      if (text[end - 1] === "\r") end -= 1
      dataEnd = end
    }
    const endstream = text.indexOf("endstream", dataEnd)
    if (endstream < 0) return undefined
    const endobj = text.indexOf("endobj", endstream + 9)
    if (endobj < 0) return undefined
    return {
      obj: {
        num: 0,
        gen: 0,
        bodyStart: headerEnd,
        bodyEnd: endobj,
        streamAt: afterValue,
        dataStart,
        dataEnd,
        dict: value,
      },
      next: endobj + 6,
    }
  }
  if (text.startsWith("endobj", afterValue)) {
    return { obj: { num: 0, gen: 0, bodyStart: headerEnd, bodyEnd: afterValue, dict: value }, next: afterValue + 6 }
  }
  return undefined
}

function scanObjects(text: string): ScannedObject[] {
  const objects = new Map<number, ScannedObject>()
  const pattern = /(\d+)[\x00\x09\x0a\x0c\x0d\x20]+(\d+)[\x00\x09\x0a\x0c\x0d\x20]+obj(?![A-Za-z0-9])/g
  let from = 0
  while (from < text.length) {
    pattern.lastIndex = from
    const match = pattern.exec(text)
    if (!match) break
    const headerEnd = match.index + match[0].length
    const scanned = scanObjectAt(text, headerEnd)
    if (!scanned) {
      from = headerEnd + 4
      continue
    }
    // 增量更新里同一个对象号会出现多次，最后一次才是有效的。
    objects.set(Number(match[1]), { ...scanned.obj, num: Number(match[1]), gen: Number(match[2]) })
    from = scanned.next
  }
  return [...objects.values()]
}

function findTrailer(text: string, objects: readonly ScannedObject[]): PdfValue | undefined {
  const at = text.lastIndexOf("trailer")
  if (at >= 0) {
    const reader = new PdfReader(text, at + 7)
    const value = reader.readValue()
    if (value?.kind === "dict") return value
  }
  // PDF 1.5+ 的交叉引用流把 trailer 信息放在 /Type /XRef 的字典里。
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index]!
    if (asName(dictGet(object.dict, "/Type")) === "XRef") return object.dict
  }
  return undefined
}

function readStringToken(text: string, at: number): { bytes: Uint8Array; end: number } {
  const reader = new PdfReader(text, at)
  if (text[at] === "(") return { bytes: reader.readLiteralString(), end: reader.pos }
  return { bytes: reader.readHexString(), end: reader.pos }
}

/** 把对象主体里的字符串逐个解密；其它字节原样保留。 */
function decryptStrings(text: string, cryptor: PdfCryptor, method: PdfCryptMethod, num: number, gen: number): string {
  if (method === "none" || (!text.includes("(") && !text.includes("<"))) return text
  let out = ""
  let at = 0
  while (at < text.length) {
    const char = text[at]!
    if (char === "%") {
      let end = at
      while (end < text.length && !isEol(text[end])) end += 1
      out += text.slice(at, end)
      at = end
      continue
    }
    if (char === "(" || (char === "<" && text[at + 1] !== "<")) {
      const token = readStringToken(text, at)
      out += "<" + bytesToHex(cryptor.decrypt(method, num, gen, token.bytes)) + ">"
      at = token.end
      continue
    }
    if (char === "<" && text[at + 1] === "<") {
      out += "<<"
      at += 2
      continue
    }
    out += char
    at += 1
  }
  return out
}

function setStreamLength(dictText: string, length: number): string {
  const trimmed = dictText.trim()
  if (/\/Length\s+\d+\s+\d+\s+R/.test(trimmed)) {
    return trimmed.replace(/\/Length\s+\d+\s+\d+\s+R/, "/Length " + length)
  }
  if (/\/Length\s+\d+/.test(trimmed)) return trimmed.replace(/\/Length\s+\d+/, "/Length " + length)
  const close = trimmed.lastIndexOf(">>")
  if (close < 0) return trimmed
  return trimmed.slice(0, close) + " /Length " + length + " " + trimmed.slice(close)
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array | undefined> {
  const Ctor = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream
  if (!Ctor) return undefined
  for (const format of ["deflate", "deflate-raw"] as const) {
    try {
      const stream = new Ctor(format)
      const writer = stream.writable.getWriter()
      const writing = (async () => {
        await writer.write(data.slice())
        await writer.close()
      })().catch(() => undefined)
      const chunks: Uint8Array[] = []
      const reader = stream.readable.getReader()
      while (true) {
        const next = await reader.read()
        if (next.done) break
        if (next.value) chunks.push(next.value)
      }
      await writing
      if (chunks.length > 0) return concatBytes(...chunks)
    } catch {
      continue
    }
  }
  return undefined
}

function streamFilters(dict: PdfValue | undefined): string[] | undefined {
  const value = dictGet(dict, "/Filter")
  if (value === undefined) return []
  if (value.kind === "name") return [value.value]
  if (value.kind === "array") return value.items.map((item) => (item.kind === "name" ? item.value : ""))
  return undefined
}

type ContainedObject = { num: number; text: string }

/** 对象流（/Type /ObjStm）解压后是「N 对 (对象号, 偏移) + 对象正文」。 */
function splitObjectStream(plain: Uint8Array, dict: PdfValue | undefined): ContainedObject[] {
  const text = latin1Decode(plain)
  const count = asNumber(dictGet(dict, "/N")) ?? 0
  const first = asNumber(dictGet(dict, "/First")) ?? 0
  const reader = new PdfReader(text.slice(0, Math.max(0, first)))
  const pairs: Array<{ num: number; offset: number }> = []
  for (let index = 0; index < count; index += 1) {
    const num = reader.readNumber()
    const offset = reader.readNumber()
    if (num === undefined || offset === undefined) break
    pairs.push({ num, offset })
  }
  return pairs.map((pair, index) => {
    const start = first + pair.offset
    const end = index + 1 < pairs.length ? first + pairs[index + 1]!.offset : text.length
    return { num: pair.num, text: text.slice(start, end).trim() }
  })
}

type RebuildFailure = { ok: false; message: string }

async function rebuildPdf(
  text: string,
  objects: readonly ScannedObject[],
  cryptor: PdfCryptor,
  info: EncryptInfo,
  trailer: PdfValue | undefined,
  encryptNum: number | undefined,
): Promise<Uint8Array | RebuildFailure> {
  const outputs: Array<{ num: number; gen: number; text: string }> = []
  for (const object of objects) {
    if (object.num === encryptNum) continue
    const type = asName(dictGet(object.dict, "/Type"))
    if (type === "XRef") continue
    if (object.streamAt !== undefined && object.dataStart !== undefined && object.dataEnd !== undefined) {
      const raw = latin1Encode(text.slice(object.dataStart, object.dataEnd))
      const metadataPlain = type === "Metadata" && !info.encryptMetadata
      const data = cryptor.decrypt(metadataPlain ? "none" : info.streamMethod, object.num, object.gen, raw)
      if (type === "ObjStm") {
        const filters = streamFilters(object.dict) ?? []
        if (filters.length > 0 && !(filters.length === 1 && filters[0] === "FlateDecode")) {
          return { ok: false, message: "对象流使用了不支持的压缩方式：" + filters.join(",") }
        }
        const plain = filters.length === 0 ? data : await inflateZlib(data)
        if (!plain) return { ok: false, message: "无法解开 PDF 的对象流" }
        for (const contained of splitObjectStream(plain, object.dict)) {
          if (contained.num === encryptNum) continue
          outputs.push({ num: contained.num, gen: 0, text: contained.text })
        }
        continue
      }
      const dictText = decryptStrings(
        text.slice(object.bodyStart, object.streamAt),
        cryptor,
        info.stringMethod,
        object.num,
        object.gen,
      )
      outputs.push({
        num: object.num,
        gen: object.gen,
        text: setStreamLength(dictText, data.length) + "\nstream\n" + latin1Decode(data) + "\nendstream",
      })
      continue
    }
    const body = decryptStrings(
      text.slice(object.bodyStart, object.bodyEnd),
      cryptor,
      info.stringMethod,
      object.num,
      object.gen,
    )
    outputs.push({ num: object.num, gen: object.gen, text: body.trim() })
  }

  const root = asRef(dictGet(trailer, "/Root"))
  if (!root) return { ok: false, message: "PDF 缺少 /Root，无法重建文件" }
  const infoRef = asRef(dictGet(trailer, "/Info"))

  let out = "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"
  const offsets = new Map<number, { offset: number; gen: number }>()
  for (const object of outputs) {
    offsets.set(object.num, { offset: out.length, gen: object.gen })
    out += object.num + " " + object.gen + " obj\n" + object.text + "\nendobj\n"
  }
  let size = 1
  for (const num of offsets.keys()) size = Math.max(size, num + 1)
  size = Math.max(size, root.num + 1)
  if (infoRef) size = Math.max(size, infoRef.num + 1)

  const startxref = out.length
  out += "xref\n0 " + size + "\n0000000000 65535 f \n"
  for (let num = 1; num < size; num += 1) {
    const entry = offsets.get(num)
    out += entry
      ? String(entry.offset).padStart(10, "0") + " " + String(entry.gen).padStart(5, "0") + " n \n"
      : "0000000000 65535 f \n"
  }
  let trailerText = "<< /Size " + size + " /Root " + root.num + " " + root.gen + " R"
  if (infoRef) trailerText += " /Info " + infoRef.num + " " + infoRef.gen + " R"
  const ids = asArray(dictGet(trailer, "/ID"))
  if (ids && ids.length > 0) {
    const values = ids.slice(0, 2).map((item) => "<" + bytesToHex(asBytes(item) ?? new Uint8Array()) + ">")
    if (values.length === 1) values.push(values[0]!)
    trailerText += " /ID [" + values.join(" ") + "]"
  }
  trailerText += " >>"
  out += "trailer\n" + trailerText + "\nstartxref\n" + startxref + "\n%%EOF\n"
  return latin1Encode(out)
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

/** 快速判断：文件里是否出现 /Encrypt 引用（真正结论由 decryptPdf 给出）。 */
export function isEncryptedPdf(bytes: Uint8Array): boolean {
  const needle = "/Encrypt"
  const first = needle.charCodeAt(0)
  outer: for (let at = 0; at + needle.length <= bytes.length; at += 1) {
    if (bytes[at] !== first) continue
    for (let index = 1; index < needle.length; index += 1) {
      if (bytes[at + index] !== needle.charCodeAt(index)) continue outer
    }
    return true
  }
  return false
}

/**
 * 去掉 PDF 的密码保护。
 *
 * - 没加密：原样返回 `encrypted: false`；
 * - 加密但没给密码 / 密码不对：`password_required`，调用方据此提示输入；
 * - 支持的加密方式解密成功后，返回一份可交给 pdf-lib 的未加密字节。
 */
export async function decryptPdf(bytes: Uint8Array, password?: string): Promise<PdfDecryptResult> {
  if (!isEncryptedPdf(bytes)) return { ok: true, bytes, encrypted: false }

  const text = latin1Decode(bytes)
  const objects = scanObjects(text)
  const trailer = findTrailer(text, objects)
  if (!trailer) return { ok: false, reason: "damaged", message: "PDF 结构损坏：找不到 trailer" }

  const encryptValue = dictGet(trailer, "/Encrypt")
  if (encryptValue === undefined) return { ok: true, bytes, encrypted: false }
  const encryptRef = asRef(encryptValue)
  let encryptDict: PdfValue | undefined = encryptValue
  if (encryptRef) {
    const target = objects.find((object) => object.num === encryptRef.num)
    if (!target?.dict) {
      return { ok: false, reason: "damaged", message: "PDF 结构损坏：找不到加密字典对象 " + encryptRef.num }
    }
    encryptDict = target.dict
  }

  const parsed = readEncryptInfo(encryptDict)
  if (!parsed.ok) {
    return {
      ok: false,
      reason: "unsupported",
      message: parsed.message,
      suggestion: "先用其他工具把 PDF 另存为不加密的版本，再来编辑",
    }
  }
  const info = parsed.info
  const ids = asArray(dictGet(trailer, "/ID"))
  const id0 = (ids && ids.length > 0 ? asBytes(ids[0]) : undefined) ?? new Uint8Array()
  const passwordCandidate = passwordBytes(password ?? "")

  let derived: DerivedKey | "wrong"
  if (info.version === 5) {
    if (!globalThis.crypto?.subtle) {
      return {
        ok: false,
        reason: "unsupported",
        message: "当前运行环境没有 WebCrypto，无法解密 AES-256 的 PDF",
        suggestion: "在支持 WebCrypto 的运行时里打开（Node 18+ / Bun / 浏览器）",
      }
    }
    derived = await deriveKeyR5(info, passwordCandidate)
  } else {
    derived = deriveKeyR4(info, passwordCandidate, id0)
  }
  if (derived === "wrong") {
    if (password === undefined || password === "") {
      return {
        ok: false,
        reason: "password_required",
        message: "这份 PDF 有密码保护",
        suggestion: "用 --password <密码> 打开；所有者密码也可以",
      }
    }
    return {
      ok: false,
      reason: "invalid_password",
      message: "PDF 密码不正确",
      suggestion: "确认输入的是用户密码或所有者密码",
    }
  }

  const cryptor = new PdfCryptor(derived.key, info.revision)
  const rebuilt = await rebuildPdf(text, objects, cryptor, info, trailer, encryptRef?.num)
  if (!(rebuilt instanceof Uint8Array)) {
    return { ok: false, reason: "damaged", message: rebuilt.message, suggestion: "先用其他工具修复或另存这份 PDF" }
  }
  const protection: PdfProtection =
    info.streamMethod === "aes-256" || info.stringMethod === "aes-256"
      ? "aes-256"
      : info.streamMethod === "aes-128" || info.stringMethod === "aes-128"
        ? "aes-128"
        : "rc4"
  return { ok: true, bytes: rebuilt, encrypted: true, protection, usedPassword: derived.kind }
}
