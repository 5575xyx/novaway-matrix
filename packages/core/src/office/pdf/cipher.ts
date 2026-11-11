/**
 * PDF 标准安全处理器要用的密码学原语。
 *
 * 这里**不引第三方库**：PDF 加密只用到 MD5、RC4、AES-128/256-CBC、SHA-2，
 * 前三个各几十行就够，SHA-2 直接用运行时自带的 WebCrypto。这样 core 仍然
 * 是「纯 TS、在浏览器 / Node / Bun 里行为一致」，也不多一个依赖。
 *
 * 参考 ISO 32000-1 §7.6.3（Algorithm 2/3/4/5）与 ISO 32000-2 §7.6.4.3
 * （Algorithm 2.A / 2.B），逐条实现；测试里带 NIST 向量。
 */

/** 32 字节的密码填充串（ISO 32000-1，Algorithm 2 步骤 a）。 */
export const PASSWORD_PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00,
  0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
])

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let length = 0
  for (const part of parts) length += part.length
  const out = new Uint8Array(length)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export function bytesToHex(bytes: Uint8Array): string {
  let text = ""
  for (const byte of bytes) text += byte.toString(16).padStart(2, "0")
  return text
}

// ---------------------------------------------------------------------------
// MD5（RFC 1321）
// ---------------------------------------------------------------------------

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4,
  11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

/** K[i] = floor(|sin(i + 1)| * 2^32)，按 RFC 直接算，不背常量表。 */
const MD5_K = Array.from(
  { length: 64 },
  (_item, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0,
)

export function md5(input: Uint8Array): Uint8Array {
  const length = input.length
  const total = (((length + 8) >> 6) + 1) << 6
  const buffer = new Uint8Array(total)
  buffer.set(input)
  buffer[length] = 0x80
  const view = new DataView(buffer.buffer)
  view.setUint32(total - 8, (length * 8) >>> 0, true)
  view.setUint32(total - 4, Math.floor((length * 8) / 0x100000000), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let offset = 0; offset < total; offset += 64) {
    const words = new Array<number>(16)
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, true)
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i += 1) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const sum = (a + f + MD5_K[i]! + words[g]!) >>> 0
      const shift = MD5_SHIFTS[i]!
      a = d
      d = c
      c = b
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }

  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, a0, true)
  outView.setUint32(4, b0, true)
  outView.setUint32(8, c0, true)
  outView.setUint32(12, d0, true)
  return out
}

// ---------------------------------------------------------------------------
// RC4
// ---------------------------------------------------------------------------

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (key.length === 0) throw new Error("RC4 密钥不能为空")
  const state = new Uint8Array(256)
  for (let i = 0; i < 256; i += 1) state[i] = i
  let j = 0
  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i]! + key[i % key.length]!) & 0xff
    const swap = state[i]!
    state[i] = state[j]!
    state[j] = swap
  }
  const out = new Uint8Array(data.length)
  let i = 0
  j = 0
  for (let at = 0; at < data.length; at += 1) {
    i = (i + 1) & 0xff
    j = (j + state[i]!) & 0xff
    const swap = state[i]!
    state[i] = state[j]!
    state[j] = swap
    out[at] = data[at]! ^ state[(state[i]! + state[j]!) & 0xff]!
  }
  return out
}

// ---------------------------------------------------------------------------
// AES（只用 ECB / CBC，无填充）
// ---------------------------------------------------------------------------

const SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76, 0xca, 0x82, 0xc9,
  0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0, 0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f,
  0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15, 0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07,
  0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75, 0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3,
  0x29, 0xe3, 0x2f, 0x84, 0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58,
  0xcf, 0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8, 0x51, 0xa3,
  0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2, 0xcd, 0x0c, 0x13, 0xec, 0x5f,
  0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73, 0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88,
  0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb, 0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac,
  0x62, 0x91, 0x95, 0xe4, 0x79, 0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a,
  0xae, 0x08, 0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a, 0x70,
  0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e, 0xe1, 0xf8, 0x98, 0x11,
  0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf, 0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42,
  0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
])

const INV_SBOX = new Uint8Array([
  0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb, 0x7c, 0xe3, 0x39,
  0x82, 0x9b, 0x2f, 0xff, 0x87, 0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb, 0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2,
  0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e, 0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76,
  0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25, 0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xd4, 0xa4, 0x5c, 0xcc,
  0x5d, 0x65, 0xb6, 0x92, 0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d,
  0x84, 0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06, 0xd0, 0x2c,
  0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, 0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b, 0x3a, 0x91, 0x11, 0x41, 0x4f,
  0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73, 0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85,
  0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e, 0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, 0x6f, 0xb7, 0x62,
  0x0e, 0xaa, 0x18, 0xbe, 0x1b, 0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd,
  0x5a, 0xf4, 0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f, 0x60,
  0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, 0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef, 0xa0, 0xe0, 0x3b, 0x4d,
  0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61, 0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6,
  0x26, 0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d,
])

function xtime(value: number): number {
  return ((value << 1) ^ (value & 0x80 ? 0x1b : 0)) & 0xff
}

function gmul(a: number, b: number): number {
  let left = a
  let right = b
  let result = 0
  while (right !== 0) {
    if (right & 1) result ^= left
    left = xtime(left)
    right >>= 1
  }
  return result
}

export type AesKey = { rounds: number; keys: Uint8Array }

export function aesExpandKey(key: Uint8Array): AesKey {
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    throw new Error("AES 密钥长度只能是 16 / 24 / 32 字节")
  }
  const rounds = key.length / 4 + 6
  const keys = new Uint8Array((rounds + 1) * 16)
  keys.set(key)
  const temp = new Uint8Array(4)
  let rcon = 1
  for (let at = key.length; at < keys.length; at += 4) {
    temp.set(keys.subarray(at - 4, at))
    if (at % key.length === 0) {
      const first = temp[0]!
      temp[0] = SBOX[temp[1]!]! ^ rcon
      temp[1] = SBOX[temp[2]!]!
      temp[2] = SBOX[temp[3]!]!
      temp[3] = SBOX[first]!
      rcon = xtime(rcon)
    } else if (key.length === 32 && at % key.length === 16) {
      for (let i = 0; i < 4; i += 1) temp[i] = SBOX[temp[i]!]!
    }
    for (let i = 0; i < 4; i += 1) keys[at + i] = keys[at - key.length + i]! ^ temp[i]!
  }
  return { rounds, keys }
}

function addRoundKey(state: Uint8Array, keys: Uint8Array, round: number): void {
  const offset = round * 16
  for (let i = 0; i < 16; i += 1) state[i] = state[i]! ^ keys[offset + i]!
}

function subBytes(state: Uint8Array, table: Uint8Array): void {
  for (let i = 0; i < 16; i += 1) state[i] = table[state[i]!]!
}

/** 行移位：第 r 行左移 r 格；state 按「列优先」存放（下标 = 4*列 + 行）。 */
function shiftRows(state: Uint8Array, inverse: boolean): void {
  const copy = state.slice()
  for (let row = 1; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const source = inverse ? (column - row + 4) % 4 : (column + row) % 4
      state[4 * column + row] = copy[4 * source + row]!
    }
  }
}

function mixColumns(state: Uint8Array, inverse: boolean): void {
  const factors = inverse ? [0x0e, 0x0b, 0x0d, 0x09] : [0x02, 0x03, 0x01, 0x01]
  for (let column = 0; column < 4; column += 1) {
    const at = column * 4
    const a0 = state[at]!
    const a1 = state[at + 1]!
    const a2 = state[at + 2]!
    const a3 = state[at + 3]!
    state[at] = gmul(a0, factors[0]!) ^ gmul(a1, factors[1]!) ^ gmul(a2, factors[2]!) ^ gmul(a3, factors[3]!)
    state[at + 1] = gmul(a0, factors[3]!) ^ gmul(a1, factors[0]!) ^ gmul(a2, factors[1]!) ^ gmul(a3, factors[2]!)
    state[at + 2] = gmul(a0, factors[2]!) ^ gmul(a1, factors[3]!) ^ gmul(a2, factors[0]!) ^ gmul(a3, factors[1]!)
    state[at + 3] = gmul(a0, factors[1]!) ^ gmul(a1, factors[2]!) ^ gmul(a2, factors[3]!) ^ gmul(a3, factors[0]!)
  }
}

export function aesEncryptBlock(key: AesKey, block: Uint8Array): Uint8Array {
  const state = block.slice(0, 16)
  addRoundKey(state, key.keys, 0)
  for (let round = 1; round < key.rounds; round += 1) {
    subBytes(state, SBOX)
    shiftRows(state, false)
    mixColumns(state, false)
    addRoundKey(state, key.keys, round)
  }
  subBytes(state, SBOX)
  shiftRows(state, false)
  addRoundKey(state, key.keys, key.rounds)
  return state
}

export function aesDecryptBlock(key: AesKey, block: Uint8Array): Uint8Array {
  const state = block.slice(0, 16)
  addRoundKey(state, key.keys, key.rounds)
  for (let round = key.rounds - 1; round >= 1; round -= 1) {
    shiftRows(state, true)
    subBytes(state, INV_SBOX)
    addRoundKey(state, key.keys, round)
    mixColumns(state, true)
  }
  shiftRows(state, true)
  subBytes(state, INV_SBOX)
  addRoundKey(state, key.keys, 0)
  return state
}

/** CBC 解密，不处理填充（PDF 的 AES 对象数据前面自带 16 字节 IV）。 */
export function aesCbcDecrypt(keyBytes: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length % 16 !== 0) throw new Error("AES-CBC 数据长度必须是 16 的倍数")
  const key = aesExpandKey(keyBytes)
  const out = new Uint8Array(data.length)
  let previous = iv
  for (let at = 0; at < data.length; at += 16) {
    const block = aesDecryptBlock(key, data.subarray(at, at + 16))
    for (let i = 0; i < 16; i += 1) out[at + i] = block[i]! ^ previous[i]!
    previous = data.subarray(at, at + 16)
  }
  return out
}

export function aesCbcEncrypt(keyBytes: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length % 16 !== 0) throw new Error("AES-CBC 数据长度必须是 16 的倍数")
  const key = aesExpandKey(keyBytes)
  const out = new Uint8Array(data.length)
  let previous = iv
  for (let at = 0; at < data.length; at += 16) {
    const block = new Uint8Array(16)
    for (let i = 0; i < 16; i += 1) block[i] = data[at + i]! ^ previous[i]!
    const encrypted = aesEncryptBlock(key, block)
    out.set(encrypted, at)
    previous = encrypted
  }
  return out
}

export function aesEcbDecrypt(keyBytes: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length % 16 !== 0) throw new Error("AES-ECB 数据长度必须是 16 的倍数")
  const key = aesExpandKey(keyBytes)
  const out = new Uint8Array(data.length)
  for (let at = 0; at < data.length; at += 16) out.set(aesDecryptBlock(key, data.subarray(at, at + 16)), at)
  return out
}

// ---------------------------------------------------------------------------
// SHA-2（走运行时自带的 WebCrypto）
// ---------------------------------------------------------------------------

export async function sha2(algorithm: "SHA-256" | "SHA-384" | "SHA-512", data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error("当前运行环境没有 WebCrypto，无法解密 AES-256 加密的 PDF")
  const copy = data.slice()
  return new Uint8Array(await subtle.digest(algorithm, copy.buffer as ArrayBuffer))
}
