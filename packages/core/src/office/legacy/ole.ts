/**
 * OLE 复合文档（Compound File Binary）最小读取器。
 *
 * `.doc / .xls / .ppt`（Office 97-2003）都是这种容器：一个 FAT 文件系统，
 * 里面的「流」才是真正的正文。这里只实现读：
 *
 *   - 512 / 4096 字节扇区、FAT / DIFAT 链；
 *   - 目录项（名字、类型、起始扇区、大小）；
 *   - 小于 4096 字节的流走 mini FAT + 根目录的 mini stream。
 *
 * 不写回、不修复：坏文件直接报错，由调用方提示用户另存为新格式。
 */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const END_OF_CHAIN = 0xfffffffe
const FREE_SECTOR = 0xffffffff
const MAX_SECTORS = 1 << 22

export type OleEntry = {
  name: string
  type: number
  start: number
  size: number
}

export type OleFile = {
  entries: OleEntry[]
  streams: Map<string, Uint8Array>
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true) >>> 0
}

function isOle(bytes: Uint8Array): boolean {
  return SIGNATURE.every((value, index) => bytes[index] === value)
}

/** 目录项名字是 UTF-16LE，长度含结尾的 NUL。 */
function readName(view: DataView, offset: number, length: number): string {
  const units: number[] = []
  for (let index = 0; index + 1 < length; index += 2) {
    const code = view.getUint16(offset + index, true)
    if (code === 0) break
    units.push(code)
  }
  let out = ""
  for (let index = 0; index < units.length; index += 1) out += String.fromCharCode(units[index]!)
  return out
}

function chain(fat: Uint32Array, start: number, limit: number): number[] {
  const sectors: number[] = []
  let current = start
  while (current !== END_OF_CHAIN && current !== FREE_SECTOR && sectors.length < limit) {
    if (current >= fat.length) break
    sectors.push(current)
    current = fat[current]!
  }
  return sectors
}

export function readOle(bytes: Uint8Array): OleFile | undefined {
  if (!isOle(bytes) || bytes.length < 512) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sectorShift = u16(view, 0x1e)
  const miniShift = u16(view, 0x20)
  if (sectorShift < 9 || sectorShift > 12 || miniShift < 6 || miniShift > 6) return undefined
  const sectorSize = 1 << sectorShift
  const miniSize = 1 << miniShift
  const fatCount = u32(view, 0x2c)
  const dirStart = u32(view, 0x30)
  const miniCutoff = u32(view, 0x38)
  const miniFatStart = u32(view, 0x3c)
  const difatStart = u32(view, 0x44)
  const difatCount = u32(view, 0x48)
  if (fatCount > MAX_SECTORS) return undefined

  const sectorOffset = (sector: number) => 512 + sector * sectorSize
  const readSector = (sector: number): Uint8Array => {
    const start = sectorOffset(sector)
    if (start < 0 || start >= bytes.length) return new Uint8Array(0)
    return bytes.subarray(start, Math.min(start + sectorSize, bytes.length))
  }

  // DIFAT：头部 109 个，加上 DIFAT 扇区里的后续项。
  const difat: number[] = []
  for (let index = 0; index < 109; index += 1) {
    const value = u32(view, 0x4c + index * 4)
    if (value === FREE_SECTOR) break
    difat.push(value)
  }
  let difatSector = difatStart
  for (let count = 0; count < difatCount && difatSector !== END_OF_CHAIN && difatSector !== FREE_SECTOR; count += 1) {
    const sector = readSector(difatSector)
    if (sector.length < sectorSize) break
    const sectorView = new DataView(sector.buffer, sector.byteOffset, sector.byteLength)
    const perSector = sectorSize / 4 - 1
    for (let index = 0; index < perSector; index += 1) {
      const value = sectorView.getUint32(index * 4, true) >>> 0
      if (value !== FREE_SECTOR) difat.push(value)
    }
    difatSector = sectorView.getUint32(sectorSize - 4, true) >>> 0
  }

  const fat = new Uint32Array(Math.max(1, fatCount) * (sectorSize / 4))
  difat.forEach((sector, index) => {
    const data = readSector(sector)
    if (data.length < 4) return
    const sectorView = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let entry = 0; entry < sectorSize / 4; entry += 1) {
      const position = index * (sectorSize / 4) + entry
      if (position >= fat.length) break
      fat[position] = sectorView.getUint32(entry * 4, true) >>> 0
    }
  })

  // 目录：每项 128 字节，串成一条 FAT 链。
  const directorySectors = chain(fat, dirStart, MAX_SECTORS)
  const entries: OleEntry[] = []
  const directory: Uint8Array[] = directorySectors.map((sector) => readSector(sector))
  const directoryLength = directory.reduce((sum, part) => sum + part.length, 0)
  const dirBytes = new Uint8Array(directoryLength)
  let dirOffset = 0
  for (const part of directory) {
    dirBytes.set(part, dirOffset)
    dirOffset += part.length
  }
  if (dirBytes.length >= 128) {
    const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength)
    for (let offset = 0; offset + 128 <= dirBytes.length; offset += 128) {
      const nameLength = dirView.getUint16(offset + 64, true)
      const type = dirView.getUint8(offset + 66)
      if (type !== 1 && type !== 2 && type !== 5) continue
      const name = readName(dirView, offset, Math.min(nameLength, 64))
      const start = u32(dirView, offset + 116)
      const size = u32(dirView, offset + 120)
      entries.push({ name, type, start, size })
    }
  }

  const root = entries.find((entry) => entry.type === 5)
  const miniStreamSectors = root ? chain(fat, root.start, MAX_SECTORS) : []
  const miniStream = new Uint8Array(miniStreamSectors.length * sectorSize)
  miniStreamSectors.forEach((sector, index) => miniStream.set(readSector(sector), index * sectorSize))

  const miniFat: number[] = []
  for (const sector of chain(fat, miniFatStart, MAX_SECTORS)) {
    const data = readSector(sector)
    const sectorView = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let entry = 0; entry < sectorSize / 4; entry += 1) miniFat.push(sectorView.getUint32(entry * 4, true) >>> 0)
  }

  const streams = new Map<string, Uint8Array>()
  for (const entry of entries) {
    if (entry.type !== 2) continue
    if (entry.size === 0) {
      streams.set(entry.name, new Uint8Array(0))
      continue
    }
    let data: Uint8Array
    if (entry.size < miniCutoff) {
      const sectors = chainMini(miniFat, entry.start, entry.size, miniSize)
      data = new Uint8Array(entry.size)
      let cursor = 0
      for (const sector of sectors) {
        const start = sector * miniSize
        const part = miniStream.subarray(start, Math.min(start + miniSize, miniStream.length, start + data.length - cursor))
        data.set(part, cursor)
        cursor += part.length
        if (cursor >= data.length) break
      }
    } else {
      const sectors = chain(fat, entry.start, MAX_SECTORS)
      data = new Uint8Array(Math.min(entry.size, sectors.length * sectorSize))
      let cursor = 0
      for (const sector of sectors) {
        const part = readSector(sector)
        data.set(part.subarray(0, Math.min(part.length, data.length - cursor)), cursor)
        cursor += part.length
        if (cursor >= data.length) break
      }
    }
    streams.set(entry.name, data.subarray(0, entry.size))
  }

  return { entries, streams }
}

function chainMini(fat: number[], start: number, size: number, miniSize: number): number[] {
  const sectors: number[] = []
  let current = start
  const limit = Math.ceil(size / miniSize) + 1
  while (current !== END_OF_CHAIN && current !== FREE_SECTOR && sectors.length < limit) {
    if (current >= fat.length) break
    sectors.push(current)
    current = fat[current]!
  }
  return sectors
}

/** 只判断是不是 OLE 容器；`readOle` 太重时用于格式嗅探。 */
export function isOleCompound(bytes: Uint8Array): boolean {
  return isOle(bytes)
}
