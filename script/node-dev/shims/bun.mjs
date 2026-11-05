/**
 * `Bun` 全局的 Node 近似实现。
 *
 * 只在 `node script/node-dev/*` 这条「用 Node 跑开发模式」的路径上注入，
 * 不改变 bun 运行时下的任何行为。目的是让源码里那几个 Bun 专有 API 在 Node 上
 * 也有等价物，而不是要求源码为 Node 再写一套分支。
 *
 * 覆盖范围以源码实际用到的为准（见脚本末尾的注释），不代表完整 Bun API。
 */
import { createReadStream, createWriteStream, promises as fsp, statSync } from "node:fs"
import { constants as fsConstants } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { pathToFileURL } from "node:url"
import stringWidth from "string-width"
import { glob } from "glob"

const ANSI = /\x1b\[[0-9;]*m/g

/** Bun.file() 的返回值：只实现被用到的方法，形状对齐 Bun。 */
class BunFile {
  constructor(filePath) {
    this.name = filePath
    this.path = filePath
  }

  get size() {
    try {
      return statSync(this.path).size
    } catch {
      return 0
    }
  }

  get lastModified() {
    try {
      return statSync(this.path).mtimeMs
    } catch {
      return 0
    }
  }

  async exists() {
    try {
      await fsp.access(this.path, fsConstants.F_OK)
      return true
    } catch {
      return false
    }
  }

  async text() {
    return fsp.readFile(this.path, "utf8")
  }

  async json() {
    return JSON.parse(await fsp.readFile(this.path, "utf8"))
  }

  async arrayBuffer() {
    const buf = await fsp.readFile(this.path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }

  async bytes() {
    return new Uint8Array(await fsp.readFile(this.path))
  }

  async blob() {
    return new Blob([await fsp.readFile(this.path)])
  }

  stream() {
    return createReadStream(this.path).iterator({ destroyOnReturn: true })
  }

  async delete() {
    await fsp.unlink(this.path)
  }
}

/**
 * Bun.write(dest, data)。data 可以是字符串、二进制、Blob，或者 Bun.file()。
 * 返回写入的字节数，与 Bun 一致。
 */
async function write(dest, data) {
  const target = typeof dest === "string" ? dest : (dest?.name ?? dest?.path)
  if (typeof target !== "string") throw new TypeError("Bun.write: destination must be a path")
  if (data instanceof BunFile) {
    const source = data.path
    if (path.resolve(source) === path.resolve(target)) return statSync(source).size
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.copyFile(source, target)
    return statSync(target).size
  }
  if (typeof data === "string" || data instanceof Uint8Array) {
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, data)
    return Buffer.byteLength(data)
  }
  if (data instanceof Blob) {
    const buf = Buffer.from(await data.arrayBuffer())
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, buf)
    return buf.byteLength
  }
  if (data?.pipe) {
    // Node 流：Bun 也接受，这里用 pipeline 落盘。
    const { pipeline } = await import("node:stream/promises")
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await pipeline(data, createWriteStream(target))
    return statSync(target).size
  }
  if (data instanceof ArrayBuffer) {
    const buf = Buffer.from(data)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, buf)
    return buf.byteLength
  }
  throw new TypeError(`Bun.write: unsupported data type ${Object.prototype.toString.call(data)}`)
}

/**
 * Bun.stringWidth()。
 *
 * 默认不把 ANSI 转义算进宽度（Bun 也是这样），传 countAnsiEscapeCodes 时才算。
 * 宽度计算交给 string-width，它和 Bun 用的是同一套 East Asian Width + emoji 规则。
 */
function stringWidthOf(value, options) {
  const text = String(value ?? "")
  if (options?.countAnsiEscapeCodes) {
    const stripped = text.replace(ANSI, "")
    return stringWidth(stripped) + (text.length - stripped.length)
  }
  return stringWidth(text.replace(ANSI, ""))
}

/** Bun.Glob：只用得到构造、scan()、scanSync()、match()。 */
class Glob {
  #pattern
  constructor(pattern) {
    if (typeof pattern !== "string") throw new TypeError("Bun.Glob: pattern must be a string")
    this.#pattern = pattern
  }

  scan({ cwd = process.cwd(), onlyFiles = true, dot = false, absolute = false } = {}) {
    const matches = glob.sync(this.#pattern, { cwd, dot, nodir: onlyFiles, absolute })
    return (async function* () {
      for (const m of matches) yield m
    })()
  }

  scanSync({ cwd = process.cwd(), onlyFiles = true, dot = false, absolute = false } = {}) {
    return glob.sync(this.#pattern, { cwd, dot, nodir: onlyFiles, absolute })
  }

  match(value) {
    return glob.sync(this.#pattern, { cwd: "/", nodir: false }).includes(String(value))
  }
}

/** 读空 stdin，对齐 Bun.stdin.text()。 */
async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

/** 在 PATH 里找可执行文件，对齐 Bun.which()。 */
function which(name, { PATH } = {}) {
  const dirs = (PATH ?? process.env.PATH ?? "").split(path.delimiter).filter(Boolean)
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""]
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext)
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {
        continue
      }
    }
  }
  return null
}

export const bun = {
  file: (filePath) => new BunFile(String(filePath)),
  write,
  stringWidth: stringWidthOf,
  Glob,
  stdin: { text: readStdin },
  which,
  env: process.env,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  version: process.env.NOVAWAY_NODE_BUN_SHIM_VERSION ?? "0.0.0-node-shim",
  spawnSync: (command, args, options) => {
    return spawnSync(command, args, options)
  },
}

export default bun
export { BunFile }
