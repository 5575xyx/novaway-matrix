import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { writeLocalFileBase64Atomically } from "./conditional-file-write"

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

async function withFixture<T>(contents: string, run: (file: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "novaway-local-write-"))
  const file = path.join(dir, "document.bin")
  writeFileSync(file, contents)
  try {
    return await run(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("desktop conditional binary file writes", () => {
  test("refuses a stale baseline and preserves external bytes", async () => {
    await withFixture("external version", async (file) => {
      const expected = sha256(new TextEncoder().encode("editor baseline"))
      const written = await writeLocalFileBase64Atomically(
        file,
        Buffer.from("editor save").toString("base64"),
        expected,
      )

      expect(written).toBe(false)
      expect(await readFileSync(file, "utf8")).toBe("external version")
    })
  })

  test("atomically writes when the approved baseline still matches", async () => {
    await withFixture("approved version", async (file) => {
      const initial = new TextEncoder().encode("approved version")
      const written = await writeLocalFileBase64Atomically(
        file,
        Buffer.from("edited version").toString("base64"),
        sha256(initial),
      )

      expect(written).toBe(true)
      expect(await readFileSync(file, "utf8")).toBe("edited version")
    })
  })

  test("keeps backward-compatible unconditional writes for export actions", async () => {
    await withFixture("before", async (file) => {
      const written = await writeLocalFileBase64Atomically(file, Buffer.from("after").toString("base64"))

      expect(written).toBe(true)
      expect(await readFileSync(file, "utf8")).toBe("after")
    })
  })
})
