import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { pluginError, type SecretStore } from "@novaway/plugin-api"

/** Local at-rest protection, not a sandbox against code running as the same OS user. */
export function createSecretStore(directory: string): SecretStore {
  const root = path.resolve(directory)
  const keyFile = path.join(root, ".key")
  const file = (name: string) => path.join(root, `${createHash("sha256").update(name).digest("hex")}.secret`)
  const read = (target: string) =>
    fs.readFile(target).catch((error: unknown) => {
      if (hasCode(error, "ENOENT")) return undefined
      throw error
    })

  const key = async (create: boolean) => {
    const existing = await read(keyFile)
    if (existing !== undefined) return validateKey(existing)
    if (!create) throw pluginError("storage_conflict", "插件密钥缺失，不能解密已有 secret")
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    const temporary = path.join(root, `.key-${randomUUID()}`)
    await fs.writeFile(temporary, randomBytes(32), { flag: "wx", mode: 0o600 })
    try {
      // Install a completely written key without overwriting a concurrent creator's key.
      await fs.link(temporary, keyFile).catch((error: unknown) => {
        if (!hasCode(error, "EEXIST")) throw error
      })
    } finally {
      await fs.rm(temporary, { force: true })
    }
    return validateKey(await fs.readFile(keyFile))
  }

  return {
    async read(name) {
      const encrypted = await read(file(name))
      if (encrypted === undefined) return undefined
      if (encrypted.length < 29 || encrypted[0] !== 1) {
        throw pluginError("storage_conflict", "插件 secret 格式损坏或版本不受支持")
      }
      const decipher = createDecipheriv("aes-256-gcm", await key(false), encrypted.subarray(1, 13))
      decipher.setAAD(Buffer.from(name, "utf8"))
      decipher.setAuthTag(encrypted.subarray(13, 29))
      return Buffer.concat([decipher.update(encrypted.subarray(29)), decipher.final()]).toString("utf8")
    },
    async write(name, value) {
      const iv = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", await key(true), iv)
      cipher.setAAD(Buffer.from(name, "utf8"))
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
      const temporary = path.join(root, `.secret-${randomUUID()}`)
      try {
        await fs.writeFile(temporary, Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]), {
          flag: "wx",
          mode: 0o600,
        })
        await fs.rename(temporary, file(name))
      } finally {
        await fs.rm(temporary, { force: true })
      }
    },
    async remove(name) {
      await fs.rm(file(name), { force: true })
    },
  }
}

function validateKey(value: Buffer) {
  if (value.length !== 32) throw pluginError("storage_conflict", "插件密钥损坏；拒绝重新生成以免覆盖已有 secrets")
  return value
}

function hasCode(error: unknown, code: string) {
  return error !== null && typeof error === "object" && "code" in error && error.code === code
}
