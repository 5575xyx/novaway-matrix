#!/usr/bin/env node
/**
 * 将已签名 PowersNexus 发布物发布到 Gitee Release。
 *
 * 默认只生成计划，不访问网络：
 *   bun packages/desktop/scripts/publish-powersnexus-gitee-release.mjs
 *
 * 真正发布：
 *   $env:GITEE_ACCESS_TOKEN = "<在本机安全设置，不要写进仓库>"
 *   bun packages/desktop/scripts/publish-powersnexus-gitee-release.mjs --execute
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "../../..")

export function giteeDownloadUrl(owner, repo, tag, filename) {
  return `https://gitee.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex")
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

function option(argv, name, fallback) {
  const prefix = `${name}=`
  const inline = argv.find((item) => item.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}

export function createPublishPlan(input) {
  const manifest = readJson(input.manifestPath)
  const artifactName = `powersnexus-${manifest.version}.zip`
  const artifactPath = path.join(input.releaseDirectory, artifactName)
  const filesPath = path.join(input.releaseDirectory, "files.sha256")
  const versionTag = input.versionTag || `v${manifest.version}`
  const channelTag = input.channelTag || "powersnexus-stable"
  const expectedArtifactUrl = giteeDownloadUrl(input.owner, input.repo, versionTag, artifactName)
  const stableManifestUrl = giteeDownloadUrl(input.owner, input.repo, channelTag, "manifest.json")
  const blockers = []

  if (!existsSync(artifactPath)) blockers.push(`缺少 ZIP：${artifactPath}`)
  if (!existsSync(filesPath)) blockers.push(`缺少 files.sha256：${filesPath}`)
  if (!manifest.signature) blockers.push("Manifest 尚未签名")
  if (manifest.channel !== "stable") blockers.push(`Manifest channel 必须为 stable，当前为 ${manifest.channel}`)
  if (manifest.artifactUrl !== expectedArtifactUrl) {
    blockers.push(`artifactUrl 不匹配；当前=${manifest.artifactUrl}；期望=${expectedArtifactUrl}`)
  }
  if (existsSync(artifactPath)) {
    const actual = sha256(readFileSync(artifactPath))
    if (actual !== manifest.artifactSha256) blockers.push(`ZIP SHA-256 不匹配；actual=${actual}`)
  }

  return {
    ready: blockers.length === 0,
    owner: input.owner,
    repo: input.repo,
    apiBase: input.apiBase,
    targetCommitish: manifest.sourceCommit,
    version: manifest.version,
    versionTag,
    channelTag,
    expectedArtifactUrl,
    stableManifestUrl,
    manifestPath: input.manifestPath,
    releaseDirectory: input.releaseDirectory,
    versionAssets: [artifactPath, filesPath, input.manifestPath],
    channelAsset: input.manifestPath,
    blockers,
  }
}

function apiClient(input) {
  const root = `${input.apiBase.replace(/\/$/, "")}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`

  async function request(method, endpoint, options = {}) {
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${input.token}`,
      ...options.headers,
    }
    const init = {
      method,
      headers,
      redirect: "follow",
    }
    if (options.body !== undefined) init.body = options.body
    const response = await fetch(`${root}${endpoint}`, init)
    const text = await response.text()
    const data = text ? parseResponse(text) : undefined
    if (response.status === 404 && options.allow404) return undefined
    if (!response.ok) {
      throw new Error(`Gitee API ${method} ${endpoint} 失败：HTTP ${response.status} ${formatResponse(data)}`)
    }
    return data
  }

  return {
    getReleaseByTag: (tag) => request("GET", `/releases/tags/${encodeURIComponent(tag)}`, { allow404: true }),
    createRelease: (body) =>
      request("POST", "/releases", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    updateRelease: (id, body) =>
      request("PATCH", `/releases/${id}`, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    listAttachments: (id) => request("GET", `/releases/${id}/attach_files`),
    deleteAttachment: (releaseID, attachmentID) =>
      request("DELETE", `/releases/${releaseID}/attach_files/${attachmentID}`),
    uploadAttachment: async (releaseID, filePath, fileName = path.basename(filePath), bytes) => {
      const form = new FormData()
      form.append("file", new Blob([bytes || readFileSync(filePath)]), fileName)
      return request("POST", `/releases/${releaseID}/attach_files`, { body: form })
    },
  }
}

function parseResponse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function formatResponse(data) {
  if (typeof data === "string") return data.slice(0, 500)
  return JSON.stringify(data).slice(0, 500)
}

function releaseBody(tag, name, body, targetCommitish) {
  return {
    tag_name: tag,
    name,
    body,
    prerelease: false,
    target_commitish: targetCommitish,
  }
}

async function ensureRelease(client, input) {
  const existing = await client.getReleaseByTag(input.tag)
  if (existing) {
    return client.updateRelease(
      existing.id,
      releaseBody(input.tag, input.name, input.body, input.targetCommitish),
    )
  }
  return client.createRelease(releaseBody(input.tag, input.name, input.body, input.targetCommitish))
}

function attachmentName(item) {
  return item.name || item.file_name || path.basename(item.browser_download_url || "")
}

async function uploadImmutableAssets(client, release, assets) {
  const attachments = await client.listAttachments(release.id)
  const byName = new Map((attachments || []).map((item) => [attachmentName(item), item]))
  const uploaded = []
  for (const file of assets) {
    const name = path.basename(file)
    const current = byName.get(name)
    if (!current) {
      uploaded.push(await client.uploadAttachment(release.id, file))
      continue
    }
    const downloadUrl = current.browser_download_url || current.download_url
    if (!downloadUrl) throw new Error(`版本附件 ${name} 缺少下载地址，无法确认不可变性`)
    const response = await fetch(downloadUrl, { cache: "no-store" })
    if (!response.ok) throw new Error(`下载已有版本附件 ${name} 失败：HTTP ${response.status}`)
    const remote = new Uint8Array(await response.arrayBuffer())
    const local = readFileSync(file)
    if (sha256(remote) !== sha256(local)) throw new Error(`版本 Release 已存在不同内容的同名附件：${name}`)
    uploaded.push({ ...current, reused: true })
  }
  return uploaded
}

async function replaceChannelManifest(client, release, manifestPath, backupRoot) {
  const attachments = await client.listAttachments(release.id)
  const current = (attachments || []).find((item) => attachmentName(item) === "manifest.json")
  let backup

  if (current) {
    const downloadUrl = current.browser_download_url || current.download_url
    if (!downloadUrl) throw new Error("现有 channel manifest 缺少下载地址，无法安全备份")
    const response = await fetch(downloadUrl, { headers: { Accept: "application/json" } })
    if (!response.ok) throw new Error(`备份现有 channel manifest 失败：HTTP ${response.status}`)
    backup = new Uint8Array(await response.arrayBuffer())
    mkdirSync(backupRoot, { recursive: true })
    writeFileSync(path.join(backupRoot, `manifest-${Date.now()}.json`), backup)
    await client.deleteAttachment(release.id, current.id)
  }

  try {
    return await client.uploadAttachment(release.id, manifestPath, "manifest.json")
  } catch (error) {
    if (backup) await client.uploadAttachment(release.id, manifestPath, "manifest.json", backup)
    throw error
  }
}

async function verifyRemote(plan) {
  const manifestResponse = await fetch(plan.stableManifestUrl, { cache: "no-store" })
  if (!manifestResponse.ok) throw new Error(`远程 Manifest 下载失败：HTTP ${manifestResponse.status}`)
  const manifest = await manifestResponse.json()
  if (manifest.signature !== readJson(plan.manifestPath).signature) throw new Error("远程 Manifest 与本地签名不一致")

  const artifactResponse = await fetch(plan.expectedArtifactUrl, { cache: "no-store" })
  if (!artifactResponse.ok) throw new Error(`远程 ZIP 下载失败：HTTP ${artifactResponse.status}`)
  const actual = sha256(new Uint8Array(await artifactResponse.arrayBuffer()))
  if (actual !== manifest.artifactSha256) throw new Error(`远程 ZIP SHA-256 不匹配：${actual}`)
  return { manifestVerified: true, artifactVerified: true, artifactSha256: actual }
}

async function main() {
  const argv = process.argv.slice(2)
  const execute = argv.includes("--execute")
  const jsonMode = argv.includes("--json")
  const owner = option(argv, "--owner", process.env.GITEE_OWNER || "nova-way")
  const repo = option(argv, "--repo", process.env.GITEE_REPO || "powersnexus")
  const apiBase = option(argv, "--api-base", process.env.GITEE_API_BASE || "https://gitee.com/api/v5")
  const releaseDirectory = path.resolve(
    option(argv, "--release-dir", path.join(repoRoot, "PowersNexus/dist/release")),
  )
  const manifestPath = path.resolve(option(argv, "--manifest", path.join(releaseDirectory, "manifest.json")))
  const plan = createPublishPlan({
    owner,
    repo,
    apiBase,
    releaseDirectory,
    manifestPath,
    versionTag: option(argv, "--version-tag"),
    channelTag: option(argv, "--channel-tag"),
  })

  if (!execute) {
    console.log(JSON.stringify({ mode: "plan", ...plan }, null, 2))
    process.exit(plan.ready ? 0 : 2)
  }
  if (!plan.ready) throw new Error(`发布计划未通过：\n- ${plan.blockers.join("\n- ")}`)

  const token = process.env.GITEE_ACCESS_TOKEN
  if (!token) throw new Error("执行发布必须设置 GITEE_ACCESS_TOKEN；不要把令牌写入仓库或命令行参数")
  const client = apiClient({ owner, repo, apiBase, token })
  const versionRelease = await ensureRelease(client, {
    tag: plan.versionTag,
    name: `PowersNexus ${plan.version}`,
    body: `PowersNexus ${plan.version} 不可变发布物。sourceCommit=${plan.targetCommitish}`,
    targetCommitish: plan.targetCommitish,
  })
  const versionAssets = await uploadImmutableAssets(client, versionRelease, plan.versionAssets)
  const channelRelease = await ensureRelease(client, {
    tag: plan.channelTag,
    name: "PowersNexus stable channel",
    body: "stable channel 仅维护已签名 manifest.json；版本制品位于不可变版本 Release。",
    targetCommitish: plan.targetCommitish,
  })
  const backupRoot = path.join(os.tmpdir(), "novaway-powersnexus-release-backups")
  const channelAsset = await replaceChannelManifest(client, channelRelease, plan.channelAsset, backupRoot)
  const remote = await verifyRemote(plan)
  const result = {
    mode: "execute",
    published: true,
    versionRelease: { id: versionRelease.id, tag: plan.versionTag, assets: versionAssets.length },
    channelRelease: { id: channelRelease.id, tag: plan.channelTag, assetID: channelAsset.id },
    stableManifestUrl: plan.stableManifestUrl,
    artifactUrl: plan.expectedArtifactUrl,
    remote,
  }
  console.log(jsonMode ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2))
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}