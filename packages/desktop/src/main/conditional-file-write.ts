import { createHash } from "node:crypto"
import { readFile, rename, rm, writeFile } from "node:fs/promises"

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/** Atomic local-file replacement with an optional best-effort external-writer CAS guard. */
export async function writeLocalFileBase64Atomically(
  filePath: string,
  data: string,
  expectedBaselineSha256?: string,
): Promise<boolean> {
  let temp: string | undefined
  try {
    if (expectedBaselineSha256 && !/^[0-9a-f]{64}$/i.test(expectedBaselineSha256)) return false
    if (expectedBaselineSha256) {
      const current = new Uint8Array(await readFile(filePath))
      if (sha256(current) !== expectedBaselineSha256.toLowerCase()) return false
    }

    temp = `${filePath}.novaway-write-${Date.now()}`
    await writeFile(temp, Buffer.from(data, "base64"))

    // Recheck after creating the temp file to narrow the external process race window.
    if (expectedBaselineSha256) {
      const current = new Uint8Array(await readFile(filePath))
      if (sha256(current) !== expectedBaselineSha256.toLowerCase()) return false
    }

    await rename(temp, filePath)
    temp = undefined
    return true
  } catch {
    return false
  } finally {
    if (temp) await rm(temp, { force: true }).catch(() => undefined)
  }
}
