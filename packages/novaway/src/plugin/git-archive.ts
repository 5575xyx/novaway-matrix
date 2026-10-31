/**
 * 没有 git 时装 git 协议的插件。
 *
 * 兼容 Claude / npm 生态的插件常量写成 `git+https://host/owner/repo.git#ref`。
 * 这类 spec 交给 npm 的 arborist 解析时内部会起 `git` 子进程；干净机器上没有 git，
 * 装插件就只剩一句 `spawn git ENOENT`。
 *
 * 这里把仓库归档下载下来（GitHub codeload / Gitee archive），再用 `file:` spec
 * 交给 arborist —— 依赖解析、bin 链接、缓存目录都和正常安装一致，只是少了 .git。
 */
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"
import * as Log from "@novaway/core/util/log"
import { extractArchive, fetchArchive } from "@/extension/archive"

const log = Log.create({ service: "plugin.git-archive" })

const MARKER = ".novaway-git-archive.json"

/** `git+https://host/owner/repo.git#main` → 仓库地址 + ref。 */
export function splitGitSpec(spec: string) {
  const stripped = spec.replace(/^git\+/, "")
  const hash = stripped.indexOf("#")
  const url = hash === -1 ? stripped : stripped.slice(0, hash)
  const ref = hash === -1 ? undefined : stripped.slice(hash + 1).trim() || undefined
  return { url: url.replace(/\.git$/i, ""), ref }
}

function cacheDir(spec: string) {
  const hash = createHash("sha256").update(spec).digest("hex").slice(0, 16)
  return path.join(Global.Path.cache, "git-archives", hash)
}

/**
 * 把 git spec 落成磁盘目录（幂等）。
 *
 * 失败会抛出可读原因（例如「这个托管平台不支持归档下载」），由调用方转成安装失败。
 */
export async function materializeGitSpec(spec: string, signal?: AbortSignal): Promise<string> {
  const target = cacheDir(spec)
  const ready = await fs
    .access(path.join(target, MARKER))
    .then(() => true)
    .catch(() => false)
  if (ready) return target

  const { url, ref } = splitGitSpec(spec)
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("没有 git 可用，且这个插件地址不是 http(s) 仓库：" + spec)
  }

  const archive = await fetchArchive(url, ref, signal)
  const staging = target + ".tmp-" + process.pid + "-" + Date.now()
  await fs.mkdir(staging, { recursive: true })
  try {
    await extractArchive(archive.buffer, staging)
    await fs.writeFile(
      path.join(staging, MARKER),
      JSON.stringify({ spec, archive: archive.url, fetchedAt: Date.now() }, null, 2),
    )
    await fs.rm(target, { recursive: true, force: true })
    await fs.rename(staging, target)
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  log.info("materialized git plugin from archive", { spec, archive: archive.url, target })
  return target
}
