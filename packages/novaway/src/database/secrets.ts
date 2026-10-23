/**
 * 数据库密码的本地加密存储。
 *
 * 不引入 keytar（原生模块，11MB 且需要 ABI 匹配）：改用
 * **AES-256-GCM + 安装期随机密钥**。密钥文件权限设为 0600，
 * 与连接配置分开存放，备份连接配置时不会连带泄露密码。
 *
 * 这不能防御「攻击者已能以你的用户身份读取任意文件」的场景，
 * 但能避免密码以明文躺在便于随手分享的配置文件里。
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

const ALGORITHM = "aes-256-gcm"
const VERSION = "v1"

const keyFile = (dir: string) => path.join(dir, "secret.key")

async function loadKey(dir: string) {
  const file = keyFile(dir)
  try {
    const raw = await fs.readFile(file, "utf8")
    const key = Buffer.from(raw.trim(), "base64")
    if (key.length === 32) return key
  } catch {
    // 首次运行或密钥损坏：下面重新生成。
  }
  const key = randomBytes(32)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(file, key.toString("base64"), { encoding: "utf8", mode: 0o600 })
  return key
}

/** 加密成 `v1:<iv>:<tag>:<cipher>` 的单行字符串。 */
export async function encryptSecret(dir: string, plain: string) {
  if (!plain) return ""
  const key = await loadKey(dir)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":")
}

/** 解密；格式不对或密钥不匹配时返回空串（当作"没有密码"处理）。 */
export async function decryptSecret(dir: string, value: string | undefined) {
  if (!value) return ""
  const parts = value.split(":")
  if (parts.length !== 4 || parts[0] !== VERSION) return ""
  try {
    const key = await loadKey(dir)
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(parts[1], "base64"))
    decipher.setAuthTag(Buffer.from(parts[2], "base64"))
    const plain = Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()])
    return plain.toString("utf8")
  } catch {
    return ""
  }
}
