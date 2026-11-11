import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { csvEngine } from "../../src/office/csv/engine"

const encoder = new TextEncoder()

describe("CSV engine file round-trip", () => {
  test("writes edited BOM/CRLF CSV bytes to disk and reopens the saved file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "novaway-csv-roundtrip-"))
    const path = join(directory, "sample.csv")
    const original = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("name;amount\r\nAlice;12\r\n")])
    try {
      await writeFile(path, original)
      const opened = await csvEngine.open(new Uint8Array(await readFile(path)))
      expect(opened.ok).toBe(true)
      if (!opened.ok) return

      const applied = await csvEngine.apply(
        opened.data,
        [{ op: "setCellValue", sheet: "Sheet1", ref: { row: 1, col: 0 }, value: "王五" }],
        original,
      )
      expect(applied.ok).toBe(true)
      if (!applied.ok) return

      await writeFile(path, applied.data.bytes)
      const savedBytes = new Uint8Array(await readFile(path))
      expect(Array.from(savedBytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
      expect(new TextDecoder().decode(savedBytes.slice(3))).toBe("name;amount\r\n王五;12\r\n")

      const reopened = await csvEngine.open(savedBytes)
      expect(reopened.ok).toBe(true)
      if (reopened.ok) expect(reopened.data.rows[1]?.[0]?.value).toBe("王五")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
