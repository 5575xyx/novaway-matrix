import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { writeLocalFileBase64Atomically } from "./conditional-file-write"

const dirs: string[] = []

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

async function fixture(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "novaway-local-write-"))
  dirs.push(dir)
  const file = path.join(dir, "document.bin")
  await writeFile(file, contents)
  return file
}

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

describe("desktop conditional binary file writes", () => {
  test("refuses a stale baseline and preserves external bytes", async () => {
    const file = await fixture("external version")
    const expected = sha256(new TextEncoder().encode("editor baseline"))
    const written = await writeLocalFileBase64Atomically(file, Buffer.from("editor save").toString("base64"), expected)

    expect(written).toBe(false)
    expect(await readFile(file, "utf8")).toBe("external version")
  })

  test("atomically writes when the approved baseline still matches", async () => {
    const initial = new TextEncoder().encode("approved version")
    const file = await fixture("approved version")
    const written = await writeLocalFileBase64Atomically(
      file,
      Buffer.from("edited version").toString("base64"),
      sha256(initial),
    )

    expect(written).toBe(true)
    expect(await readFile(file, "utf8")).toBe("edited version")
  })

  test("keeps backward-compatible unconditional writes for export actions", async () => {
    const file = await fixture("before")
    const written = await writeLocalFileBase64Atomically(file, Buffer.from("after").toString("base64"))

    expect(written).toBe(true)
    expect(await readFile(file, "utf8")).toBe("after")
  })
})
