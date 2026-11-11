import { expect, test } from "bun:test"
import { readOle } from "../../src/office/legacy/ole"

function miniOle(size: number) {
  const bytes = new Uint8Array(512 * 5)
  const view = new DataView(bytes.buffer)
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  view.setUint16(0x1e, 9, true)
  view.setUint16(0x20, 6, true)
  view.setUint32(0x2c, 1, true)
  view.setUint32(0x30, 1, true)
  view.setUint32(0x38, 4096, true)
  view.setUint32(0x3c, 3, true)
  view.setUint32(0x44, 0xfffffffe, true)
  for (let i = 0; i < 109; i++) view.setUint32(0x4c + i * 4, 0xffffffff, true)
  view.setUint32(0x4c, 0, true)
  for (let i = 0; i < 128; i++) view.setUint32(512 + i * 4, i < 4 ? 0xfffffffe : 0xffffffff, true)
  const entry = (index: number, name: string, type: number, start: number, length: number) => {
    const offset = 1024 + index * 128
    for (let i = 0; i < name.length; i++) view.setUint16(offset + i * 2, name.charCodeAt(i), true)
    view.setUint16(offset + 64, (name.length + 1) * 2, true)
    view.setUint8(offset + 66, type)
    view.setUint32(offset + 116, start, true)
    view.setUint32(offset + 120, length, true)
  }
  entry(0, "Root Entry", 5, 2, 512)
  entry(1, "Small", 2, 0, size)
  for (let i = 0; i < size; i++) bytes[1536 + i] = (i + 1) % 251
  for (let i = 0; i < 128; i++) view.setUint32(2048 + i * 4, 0xffffffff, true)
  for (let i = 0; i < Math.ceil(size / 64); i++)
    view.setUint32(2048 + i * 4, i === Math.ceil(size / 64) - 1 ? 0xfffffffe : i + 1, true)
  return bytes
}

for (const size of [3, 64, 65, 127]) {
  test(`OLE mini-stream preserves an unpadded ${size}-byte directory size`, () => {
    const stream = readOle(miniOle(size))!.streams.get("Small")!
    expect(stream).toHaveLength(size)
    expect(Array.from(stream)).toEqual(Array.from({ length: size }, (_, i) => (i + 1) % 251))
  })
}
