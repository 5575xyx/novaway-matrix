/**
 * 本地知识库存储。
 *
 * 采用「一个集合一个目录 + 每个文档一个 JSON」的文件布局，理由：
 * - 知识库天然是用户资产，放在 `Global.Path.data/knowledge` 下可直接备份/迁移；
 * - 不引入数据库迁移，旧版本读到新目录也能正常工作；
 * - 单文档读取是 O(1)，列表只读元数据，不需要把正文全加载进内存。
 *
 * 检索在读取时切片并做 BM25（见 search.ts），规模在个人/小团队知识库内足够；
 * 后续要接向量检索时，只需在 search.ts 里加一路召回并合并排序。
 */
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"
import { Flock } from "@novaway/core/util/flock"
import { Identifier } from "@/id/id"
import { denseCosine, type ResolvedEmbedder } from "@/memory/embedder"
import { extractText, type VisionOcr } from "./extract"
import {
  hybridSearchChunks,
  indexChunks,
  type ChunkCache,
  type IndexedChunk,
  type SearchDocument,
  type SearchHit,
} from "./search"
import * as IndexStore from "./index-store"
import { buildGraph, extractEntities, type KnowledgeGraph } from "./graph"
import { mergeExtracted, type LlmGraphExtractor, type StoredGraph } from "./graph-llm"

export type CollectionScope = "global" | "project"

export type Collection = {
  id: string
  name: string
  description?: string
  /** 关掉后 AI 检索会跳过这个集合（用户可能只是临时不想让它参与回答）。 */
  enabled?: boolean
  /** global：所有项目可见；project：只在 projectID 对应的项目里出现。 */
  scope?: CollectionScope
  projectID?: string
  /** 只读集合：禁止增删改文档（适合从外部同步/团队共享的资料）。 */
  readOnly?: boolean
  createdAt: number
  updatedAt: number
}

export type CollectionFilter = {
  /** 当前项目 id；用于过滤 project 作用域的集合。 */
  projectID?: string
}

/** 集合是否对当前项目可见。 */
export function visibleTo(collection: Pick<Collection, "scope" | "projectID">, projectID?: string) {
  if ((collection.scope ?? "global") === "global") return true
  return !!projectID && collection.projectID === projectID
}

/**
 * readOnly 只拦截**文档内容**的增删改。
 * 集合元数据（改名、作用域、开关）与删除属于管理动作，保持可用，
 * 否则用户没有办法把只读集合改回可写。
 */
function assertWritable(collection: Collection) {
  if (collection.readOnly) throw new Error("Collection is read-only")
}

export type CollectionSummary = Collection & { documentCount: number }

export type KnowledgeDocument = {
  id: string
  collectionID: string
  title: string
  source?: string
  content: string
  /** 正文的 sha1：导入去重与索引失效都靠它。 */
  hash: string
  /** 同一来源文件被重新导入时递增；首次导入为 1。 */
  version: number
  createdAt: number
  updatedAt: number
}

export type DocumentSummary = Omit<KnowledgeDocument, "content"> & { size: number }

export type AddDocumentResult = {
  document: KnowledgeDocument
  /** 内容与集合内已有文档完全一致时没有新增。 */
  duplicate: boolean
  /** 同一来源文件的新版本，已在原文档上就地更新。 */
  updated?: boolean
}

export type AddDocumentInput = {
  title: string
  content: string
  source?: string
}

const ID = /^[A-Za-z0-9_-]+$/
const MAX_NAME = 80
const MAX_CONTENT = 4 * 1024 * 1024

export const knowledgeRoot = () => path.join(Global.Path.data, "knowledge")
const collectionsDir = (root: string) => path.join(root, "collections")
const collectionDir = (root: string, id: string) => path.join(collectionsDir(root), id)
const documentsDir = (root: string, id: string) => path.join(collectionDir(root, id), "documents")
const collectionFile = (root: string, id: string) => path.join(collectionDir(root, id), "collection.json")
const documentFile = (root: string, id: string, docID: string) => path.join(documentsDir(root, id), `${docID}.json`)

function assertID(value: string, label: string) {
  if (!ID.test(value)) throw new Error(`Invalid ${label}: ${value}`)
}

async function readJSON<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return undefined
    // 手工编辑/中断写入可能留下坏 JSON：跳过这一条，不要让整个知识库打不开。
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

async function writeJSON(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8")
  await fs.rename(tmp, file)
}

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

export async function listCollections(
  root = knowledgeRoot(),
  filter: CollectionFilter = {},
): Promise<CollectionSummary[]> {
  const dir = collectionsDir(root)
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }

  const result: CollectionSummary[] = []
  for (const id of entries) {
    if (!ID.test(id)) continue
    const collection = await readJSON<Collection>(collectionFile(root, id))
    if (!collection) continue
    if (!visibleTo(collection, filter.projectID)) continue
    let documentCount = 0
    try {
      documentCount = (await fs.readdir(documentsDir(root, id))).filter((file) => file.endsWith(".json")).length
    } catch {
      documentCount = 0
    }
    result.push({ ...collection, documentCount })
  }
  return result.sort((a, b) => a.createdAt - b.createdAt)
}

export async function createCollection(
  input: {
    name: string
    description?: string
    scope?: CollectionScope
    projectID?: string
    readOnly?: boolean
  },
  root = knowledgeRoot(),
): Promise<Collection> {
  const name = input.name.trim()
  if (!name) throw new Error("Collection name is required")
  if (name.length > MAX_NAME) throw new Error("Collection name is too long")
  const now = Date.now()
  const collection: Collection = {
    id: Identifier.create("kb", "ascending"),
    name,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    enabled: true,
    ...(input.scope === "project" ? { scope: "project" as const, projectID: input.projectID } : {}),
    ...(input.readOnly ? { readOnly: true } : {}),
    createdAt: now,
    updatedAt: now,
  }
  await writeJSON(collectionFile(root, collection.id), collection)
  return collection
}

export async function updateCollection(
  id: string,
  input: {
    name?: string
    description?: string
    enabled?: boolean
    scope?: CollectionScope
    projectID?: string
    readOnly?: boolean
  },
  root = knowledgeRoot(),
): Promise<Collection | undefined> {
  assertID(id, "collection id")
  const collection = await readJSON<Collection>(collectionFile(root, id))
  if (!collection) return undefined
  // readOnly 只锁「内容」：改名、换作用域、关掉只读仍然是管理动作，必须允许，
  // 否则集合会永远停在只读状态出不来。
  const name = input.name?.trim()
  if (name !== undefined) {
    if (!name) throw new Error("Collection name is required")
    if (name.length > MAX_NAME) throw new Error("Collection name is too long")
  }
  const next: Collection = {
    ...collection,
    ...(name !== undefined ? { name } : {}),
    ...(input.description !== undefined
      ? input.description.trim()
        ? { description: input.description.trim() }
        : { description: undefined }
      : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.scope !== undefined
      ? input.scope === "project"
        ? { scope: "project" as const, projectID: input.projectID ?? collection.projectID }
        : { scope: "global" as const }
      : {}),
    ...(input.readOnly !== undefined ? { readOnly: input.readOnly } : {}),
    updatedAt: Date.now(),
  }
  if (next.description === undefined) delete (next as { description?: string }).description
  if (next.scope === "global") delete (next as { projectID?: string }).projectID
  await writeJSON(collectionFile(root, id), next)
  return next
}

export async function removeCollection(id: string, root = knowledgeRoot()): Promise<boolean> {
  assertID(id, "collection id")
  if (!(await exists(collectionFile(root, id)))) return false
  await fs.rm(collectionDir(root, id), { recursive: true, force: true })
  return true
}

export async function listDocuments(collectionID: string, root = knowledgeRoot()): Promise<DocumentSummary[]> {
  assertID(collectionID, "collection id")
  let files: string[]
  try {
    files = await fs.readdir(documentsDir(root, collectionID))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  const result: DocumentSummary[] = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    const document = await readJSON<KnowledgeDocument>(path.join(documentsDir(root, collectionID), file))
    if (!document) continue
    const { content, ...meta } = document
    // 老版本文档没有 hash：读的时候补算，去重与向量缓存都能正常工作（不写回）。
    result.push({ ...meta, hash: meta.hash ?? contentHash(content), size: Buffer.byteLength(content, "utf8") })
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 读取集合内全部文档（含正文）：评测建议、图谱等需要全文的场景用。 */
export async function allDocuments(collectionID: string, root = knowledgeRoot()): Promise<SearchDocument[]> {
  assertID(collectionID, "collection id")
  return loadDocuments([{ id: collectionID }], root)
}

export async function getDocument(
  collectionID: string,
  documentID: string,
  root = knowledgeRoot(),
): Promise<KnowledgeDocument | undefined> {
  assertID(collectionID, "collection id")
  assertID(documentID, "document id")
  return readJSON<KnowledgeDocument>(documentFile(root, collectionID, documentID))
}

/**
 * 判断一段"文本"其实是二进制文件被解码后的结果。
 *
 * 「添加文档」弹窗曾经用 File.text() 读任意文件，把 docx/pdf 的字节直接当
 * UTF-8 文本入库，检索时全是乱码。这里在写入前兜一道，避免脏数据落盘。
 */
export function looksLikeBinaryText(input: string) {
  if (!input) return false
  const head = input.slice(0, 8)
  const signatures = [
    "PK" + String.fromCharCode(3, 4),
    "PK" + String.fromCharCode(5, 6),
    "%PDF-",
    String.fromCharCode(0x89) + "PNG",
    String.fromCharCode(0xff, 0xd8, 0xff),
    "GIF8",
    String.fromCharCode(0x1f, 0x8b), // gzip
  ]
  if (signatures.some((mark) => head.startsWith(mark))) return true
  // 抽样统计控制字符：正常文本里几乎不会出现 NUL 与大量 0x00-0x08。
  const sample = input.slice(0, 4096)
  let control = 0
  for (const char of sample) {
    const code = char.charCodeAt(0)
    if (code === 0 || code < 9 || (code > 13 && code < 32)) control++
  }
  return control / Math.max(sample.length, 1) > 0.02
}

async function addDocumentInner(
  collectionID: string,
  input: AddDocumentInput,
  root = knowledgeRoot(),
): Promise<AddDocumentResult> {
  assertID(collectionID, "collection id")
  const collectionFileRef = collectionFile(root, collectionID)
  const guard = await readJSON<Collection>(collectionFileRef)
  if (!guard) throw new Error("Collection not found")
  assertWritable(guard)
  const content = input.content.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)).trim()
  if (!content) throw new Error("Document content is required")
  if (looksLikeBinaryText(input.content)) {
    throw new Error(
      "这段内容看起来是二进制文件（PDF / Word / 图片等）被当成文本解码后的乱码。请改用「导入文件」上传，让服务端抽取正文。",
    )
  }
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT) throw new Error("Document is too large (max 4MB)")
  const hash = contentHash(content)

  // 同一集合内正文完全相同的文件不重复入库（重复导入同一份资料很常见）。
  for (const meta of await listDocuments(collectionID, root)) {
    if (meta.hash !== hash) continue
    const existing = await getDocument(collectionID, meta.id, root)
    if (existing) return { document: existing, duplicate: true }
  }

  // 同一个来源文件（同名）再次导入：视为新版本，就地更新而不是建第二份，
  // 这样检索、引用、挂载都不会出现"同一份文档两代并存"。
  const source = input.source?.trim()
  if (source) {
    for (const meta of await listDocuments(collectionID, root)) {
      if (meta.source !== source) continue
      const existing = await getDocument(collectionID, meta.id, root)
      if (!existing) continue
      const now = Date.now()
      const next: KnowledgeDocument = {
        ...existing,
        title: input.title.trim() || existing.title,
        content,
        hash,
        version: (existing.version ?? 1) + 1,
        updatedAt: now,
      }
      await writeJSON(documentFile(root, collectionID, existing.id), next)
      // 旧向量与旧图谱都失效：删掉旁路缓存，下次检索重新 embedding / 抽取。
      await fs.rm(vectorFile(root, collectionID, existing.id), { force: true }).catch(() => undefined)
      await fs.rm(graphFile(root, collectionID, existing.id), { force: true }).catch(() => undefined)
      const collection = await readJSON<Collection>(collectionFile(root, collectionID))
      if (collection) await writeJSON(collectionFile(root, collectionID), { ...collection, updatedAt: now })
      return { document: next, duplicate: false, updated: true }
    }
  }

  const now = Date.now()
  const document: KnowledgeDocument = {
    id: Identifier.create("kbd", "ascending"),
    collectionID,
    title: input.title.trim() || content.split(String.fromCharCode(10))[0]?.slice(0, 60) || "Untitled",
    ...(input.source?.trim() ? { source: input.source.trim() } : {}),
    content,
    hash,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
  await writeJSON(documentFile(root, collectionID, document.id), document)
  const collection = await readJSON<Collection>(collectionFile(root, collectionID))
  if (collection) await writeJSON(collectionFile(root, collectionID), { ...collection, updatedAt: now })
  return { document, duplicate: false }
}

export function contentHash(content: string) {
  return createHash("sha1").update(content, "utf8").digest("hex")
}

/** 上传文件导入：先在服务端抽取正文（PDF/DOCX/PPTX/XLSX），再落盘。 */
export async function addDocumentFromFile(
  collectionID: string,
  input: { name: string; data: Buffer; vision?: VisionOcr; extractGraph?: LlmGraphExtractor },
  root = knowledgeRoot(),
): Promise<{ document?: KnowledgeDocument; warning?: string; duplicate?: boolean; updated?: boolean; ocr?: string }> {
  const extracted = await extractText(input, { vision: input.vision })
  if (!extracted.text.trim()) return { warning: extracted.warning ?? "文件里没有可提取的文本。" }
  const result = await addDocument(
    collectionID,
    { title: input.name, content: extracted.text, source: input.name },
    root,
  )
  // 可选的 LLM 图谱抽取：失败不影响导入，图谱回落到启发式。
  if (input.extractGraph && !result.duplicate) {
    try {
      const graph = await input.extractGraph({ title: result.document.title, content: result.document.content })
      if (graph) {
        await writeStoredGraph(root, collectionID, result.document.id, {
          ...graph,
          hash: result.document.hash,
          modelID: "llm",
          createdAt: Date.now(),
        })
      }
    } catch {
      // 忽略：图谱是增强能力，不应阻塞入库。
    }
  }
  return {
    document: result.document,
    duplicate: result.duplicate,
    updated: result.updated,
    ...(extracted.warning ? { warning: extracted.warning } : {}),
    ...(extracted.ocr?.used ? { ocr: extracted.ocr.backend } : {}),
  }
}

export async function updateDocument(
  collectionID: string,
  documentID: string,
  input: { title?: string; content?: string; source?: string },
  root = knowledgeRoot(),
): Promise<KnowledgeDocument | undefined> {
  assertID(collectionID, "collection id")
  assertID(documentID, "document id")
  const document = await getDocument(collectionID, documentID, root)
  if (!document) return undefined
  {
    const owner = await readJSON<Collection>(collectionFile(root, collectionID))
    if (owner) assertWritable(owner)
  }
  const content =
    input.content === undefined
      ? document.content
      : input.content.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)).trim()
  if (!content) throw new Error("Document content is required")
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT) throw new Error("Document is too large (max 4MB)")
  const next: KnowledgeDocument = {
    ...document,
    ...(input.title !== undefined ? { title: input.title.trim() || document.title } : {}),
    ...(input.source !== undefined ? { source: input.source.trim() || undefined } : {}),
    content,
    hash: contentHash(content),
    version: (document.version ?? 1) + 1,
    updatedAt: Date.now(),
  }
  if (next.source === undefined) delete (next as { source?: string }).source
  await writeJSON(documentFile(root, collectionID, documentID), next)
  const collection = await readJSON<Collection>(collectionFile(root, collectionID))
  if (collection) await writeJSON(collectionFile(root, collectionID), { ...collection, updatedAt: next.updatedAt })
  return next
}

/** 回收站保留时长：30 天后自动清理。 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const trashDir = (root: string, collectionID: string) => path.join(collectionDir(root, collectionID), "trash")
const trashFile = (root: string, collectionID: string, documentID: string) =>
  path.join(trashDir(root, collectionID), documentID + ".json")

export type TrashedDocument = {
  document: KnowledgeDocument
  deletedAt: number
}

/**
 * 删除文档（默认进回收站）。
 *
 * 之前是硬删除，误删就只能从备份里找。现在先移到 `<collection>/trash/`，
 * 30 天后自动清理；`permanent: true` 走原来的立即删除（重建索引、清理时用）。
 */
export async function removeDocument(
  collectionID: string,
  documentID: string,
  root = knowledgeRoot(),
  options: { permanent?: boolean } = {},
): Promise<boolean> {
  assertID(collectionID, "collection id")
  assertID(documentID, "document id")
  const file = documentFile(root, collectionID, documentID)
  if (!(await exists(file))) return false
  {
    const owner = await readJSON<Collection>(collectionFile(root, collectionID))
    if (owner) assertWritable(owner)
  }

  if (options.permanent) {
    await fs.rm(file, { force: true })
  } else {
    const document = await readJSON<KnowledgeDocument>(file)
    if (document) {
      await writeJSON(trashFile(root, collectionID, documentID), {
        document,
        deletedAt: Date.now(),
      } satisfies TrashedDocument)
    }
    await fs.rm(file, { force: true })
  }

  // 索引签名依赖 collection.updatedAt：删除也要更新，否则缓存会继续返回已删除文档。
  const collection = await readJSON<Collection>(collectionFile(root, collectionID))
  if (collection) await writeJSON(collectionFile(root, collectionID), { ...collection, updatedAt: Date.now() })
  return true
}

/** 回收站列表（顺带清理过期条目）。 */
export async function listTrash(collectionID: string, root = knowledgeRoot()): Promise<TrashedDocument[]> {
  assertID(collectionID, "collection id")
  const dir = trashDir(root, collectionID)
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return []
  }
  const now = Date.now()
  const items: TrashedDocument[] = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    const value = await readJSON<TrashedDocument>(path.join(dir, file))
    if (!value?.document) {
      await fs.rm(path.join(dir, file), { force: true }).catch(() => undefined)
      continue
    }
    if (now - value.deletedAt > TRASH_RETENTION_MS) {
      await fs.rm(path.join(dir, file), { force: true }).catch(() => undefined)
      continue
    }
    items.push(value)
  }
  return items.sort((a, b) => b.deletedAt - a.deletedAt)
}

/** 从回收站恢复文档；同 id 已存在时按「覆盖」处理（用户明确要恢复）。 */
export async function restoreDocument(
  collectionID: string,
  documentID: string,
  root = knowledgeRoot(),
): Promise<KnowledgeDocument | undefined> {
  assertID(collectionID, "collection id")
  assertID(documentID, "document id")
  const file = trashFile(root, collectionID, documentID)
  const value = await readJSON<TrashedDocument>(file)
  if (!value?.document) return undefined
  await writeJSON(documentFile(root, collectionID, documentID), value.document)
  await fs.rm(file, { force: true })
  const collection = await readJSON<Collection>(collectionFile(root, collectionID))
  if (collection) await writeJSON(collectionFile(root, collectionID), { ...collection, updatedAt: Date.now() })
  return value.document
}

/** 彻底清空回收站。 */
export async function emptyTrash(collectionID: string, root = knowledgeRoot()): Promise<number> {
  assertID(collectionID, "collection id")
  const items = await listTrash(collectionID, root)
  for (const item of items) {
    await fs.rm(trashFile(root, collectionID, item.document.id), { force: true }).catch(() => undefined)
  }
  return items.length
}

// 稠密向量缓存：内存 + 文档旁缓存（重启后不必重新 embedding）。
// key 里带文档 hash：内容一改自动失效。
const embeddingCache = new Map<string, number[]>()
const EMBEDDING_CACHE_LIMIT = 5000

function cacheEmbeddings(keys: string[], values: number[][]) {
  for (const [index, key] of keys.entries()) {
    const vector = values[index]
    if (!vector) continue
    if (embeddingCache.size >= EMBEDDING_CACHE_LIMIT) {
      const oldest = embeddingCache.keys().next().value
      if (oldest !== undefined) embeddingCache.delete(oldest)
    }
    embeddingCache.set(key, vector)
  }
}

type VectorFile = { modelId: string; hash: string; vectors: Record<string, number[]> }

const vectorFile = (root: string, collectionID: string, documentID: string) =>
  path.join(documentsDir(root, collectionID), documentID + ".embedding.json")

const graphFile = (root: string, collectionID: string, documentID: string) =>
  path.join(documentsDir(root, collectionID), documentID + ".graph.json")

async function readStoredGraph(root: string, collectionID: string, documentID: string) {
  return readJSON<StoredGraph>(graphFile(root, collectionID, documentID))
}

async function writeStoredGraph(root: string, collectionID: string, documentID: string, value: StoredGraph) {
  await writeJSON(graphFile(root, collectionID, documentID), value)
}

async function readVectors(root: string, document: SearchDocument, modelId: string) {
  if (!document.hash) return
  const file = vectorFile(root, document.collectionID, document.id)
  const value = await readJSON<VectorFile>(file).catch(() => undefined)
  if (!value || value.modelId !== modelId || value.hash !== document.hash) return
  for (const [chunk, vector] of Object.entries(value.vectors)) {
    if (Array.isArray(vector)) embeddingCache.set(vectorKey(document, Number(chunk)), vector)
  }
}

function vectorKey(document: SearchDocument, chunk: number) {
  return document.id + ":" + (document.hash ?? "") + ":" + chunk
}

async function writeVectors(
  root: string,
  document: SearchDocument,
  modelId: string,
  chunks: Array<{ chunk: number; vector: number[] }>,
) {
  if (!document.hash || chunks.length === 0) return
  const vectors: Record<string, number[]> = {}
  for (const item of chunks) vectors[String(item.chunk)] = item.vector
  await writeJSON(vectorFile(root, document.collectionID, document.id), {
    modelId,
    hash: document.hash,
    vectors,
  }).catch(() => undefined)
}

async function denseScores(
  entries: readonly IndexedChunk[],
  documents: readonly SearchDocument[],
  query: string,
  embedder: ResolvedEmbedder,
  root: string,
): Promise<number[] | undefined> {
  if (!embedder.embed) return
  if (entries.length === 0) return []
  await Promise.all(documents.map((document) => readVectors(root, document, embedder.modelId)))

  const byDocument = new Map<string, SearchDocument>()
  for (const document of documents) byDocument.set(document.id, document)
  const keys = entries.map((entry) => vectorKey(byDocument.get(entry.documentID)!, entry.chunk))

  const missing: Array<{ index: number; text: string }> = []
  for (const [index, key] of keys.entries()) {
    if (!embeddingCache.has(key)) missing.push({ index, text: entries[index].text })
  }
  try {
    if (missing.length > 0) {
      // 分批请求，避免一次性超出模型输入上限。
      for (let offset = 0; offset < missing.length; offset += 32) {
        const batch = missing.slice(offset, offset + 32)
        const vectors = await embedder.embed(batch.map((item) => item.text))
        cacheEmbeddings(
          batch.map((item) => keys[item.index]),
          vectors,
        )
        // 落到文档旁缓存；同一文档的多个分片合并写一次。
        const grouped = new Map<string, Array<{ chunk: number; vector: number[] }>>()
        batch.forEach((item, position) => {
          const vector = vectors[position]
          if (!vector) return
          const entry = entries[item.index]
          const list = grouped.get(entry.documentID) ?? []
          list.push({ chunk: entry.chunk, vector })
          grouped.set(entry.documentID, list)
        })
        for (const [documentID, list] of grouped) {
          const document = byDocument.get(documentID)
          if (document) await writeVectors(root, document, embedder.modelId, list)
        }
      }
    }

    const [queryVector] = await embedder.embed([query])
    if (!queryVector) return
    return entries.map((_entry, index) => {
      const vector = embeddingCache.get(keys[index])
      return vector ? denseCosine(queryVector, vector) : 0
    })
  } catch {
    // 稠密后端失败不能影响关键词/稀疏召回。
    return
  }
}

async function loadDocuments(collections: readonly { id: string }[], root: string): Promise<SearchDocument[]> {
  const documents: SearchDocument[] = []
  for (const collection of collections) {
    for (const meta of await listDocuments(collection.id, root)) {
      const document = await getDocument(collection.id, meta.id, root)
      if (!document) continue
      documents.push({
        id: document.id,
        collectionID: document.collectionID,
        title: document.title,
        content: document.content,
        hash: document.hash,
      })
    }
  }
  return documents
}

export async function search(
  input: {
    query: string
    collectionID?: string
    limit?: number
    embedder?: ResolvedEmbedder
    /** 命中不足时用图谱关联补足（tool 检索默认开启）。 */
    expand?: boolean
  },
  root = knowledgeRoot(),
): Promise<SearchHit[]> {
  const all = await listCollections(root)
  // 显式指定集合时按用户意图执行；全局检索跳过被关闭的集合。
  const collections = input.collectionID
    ? all.filter((item) => item.id === input.collectionID)
    : all.filter((item) => item.enabled !== false)

  const documents: SearchDocument[] = []
  const entries: IndexedChunk[] = []
  for (const collection of collections) {
    const index = await cachedChunks(collection.id, root)
    documents.push(...index.documents)
    entries.push(...index.chunks)
  }
  const dense = input.embedder ? await denseScores(entries, documents, input.query, input.embedder, root) : undefined
  const limit = input.limit ?? 10
  const hits = groupHits(hybridSearchChunks(entries, input.query, { limit: limit * 3, dense }), limit)
  if (!input.expand || hits.length === 0) return hits

  // 图谱关联：取前两条命中，把共享实体的文档补进来（分数打折、标记 via=graph）。
  const seen = new Set(hits.map((hit) => hit.collectionID + "|" + hit.documentID))
  const extra: SearchHit[] = []
  for (const hit of hits.slice(0, 2)) {
    const neighbours = await related({ collectionID: hit.collectionID, documentID: hit.documentID, limit: 4 }, root)
    for (const neighbour of neighbours) {
      const key = hit.collectionID + "|" + neighbour.id
      if (seen.has(key)) continue
      seen.add(key)
      const document = documents.find((item) => item.id === neighbour.id)
      if (!document) continue
      extra.push({
        collectionID: hit.collectionID,
        documentID: neighbour.id,
        title: neighbour.title,
        snippet: document.content.replace(/s+/g, " ").slice(0, 180),
        score: Math.max(0.05, hit.score * 0.6),
        chunk: 0,
        via: "graph",
      })
    }
  }
  return [...hits.map((hit) => ({ ...hit, via: hit.via ?? ("hybrid" as const) })), ...extra].slice(0, limit + 4)
}

/**
 * 同一篇文档的多个分片只保留最高分的一条（附 chunk 数），
 * 否则一个长文档会占满前十条结果。
 */
function groupHits(hits: SearchHit[], limit: number): SearchHit[] {
  const best = new Map<string, SearchHit & { chunks?: number }>()
  for (const hit of hits) {
    const key = hit.collectionID + "|" + hit.documentID
    const current = best.get(key)
    if (!current) {
      best.set(key, { ...hit, chunks: 1 })
      continue
    }
    current.chunks = (current.chunks ?? 1) + 1
  }
  return Array.from(best.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** 会话级挂载：某个会话检索时只走这些集合（未挂载时走全部启用的集合）。 */
export async function getSessionCollections(sessionID: string, root = knowledgeRoot()) {
  if (!ID.test(sessionID)) return []
  const file = path.join(root, "sessions", sessionID + ".json")
  const value = await readJSON<{ collectionIDs?: string[] }>(file)
  return Array.isArray(value?.collectionIDs) ? value!.collectionIDs!.filter((id) => ID.test(id)) : []
}

export async function setSessionCollections(sessionID: string, collectionIDs: string[], root = knowledgeRoot()) {
  if (!ID.test(sessionID)) throw new Error("Invalid session id")
  const file = path.join(root, "sessions", sessionID + ".json")
  const unique = Array.from(new Set(collectionIDs.filter((id) => ID.test(id))))
  if (unique.length === 0) {
    await fs.rm(file, { force: true })
    return []
  }
  await writeJSON(file, { collectionIDs: unique, updatedAt: Date.now() })
  return unique
}

/** 按会话挂载检索：挂载为空时回落到全部启用集合。 */
export async function searchForSession(
  input: { sessionID: string; query: string; limit?: number; embedder?: ResolvedEmbedder },
  root = knowledgeRoot(),
): Promise<SearchHit[]> {
  const mounted = await getSessionCollections(input.sessionID, root)
  if (mounted.length === 0) return search(input, root)
  const all = await listCollections(root)
  const enabled = new Set(all.filter((item) => item.enabled !== false).map((item) => item.id))
  const collections = all.filter((item) => mounted.includes(item.id) && enabled.has(item.id))
  if (collections.length === 0) return search({ ...input, collectionID: mounted[0] }, root)
  const documents: SearchDocument[] = []
  const entries: IndexedChunk[] = []
  for (const collection of collections) {
    const index = await cachedChunks(collection.id, root)
    documents.push(...index.documents)
    entries.push(...index.chunks)
  }
  const dense = input.embedder ? await denseScores(entries, documents, input.query, input.embedder, root) : undefined
  return groupHits(
    hybridSearchChunks(entries, input.query, { limit: (input.limit ?? 10) * 3, dense }),
    input.limit ?? 10,
  )
}

/** 知识图谱：按集合（或全部启用集合）抽实体与共现关系。 */
export async function graph(
  input: { collectionID?: string; limit?: number } = {},
  root = knowledgeRoot(),
): Promise<KnowledgeGraph> {
  const all = await listCollections(root)
  const collections = input.collectionID
    ? all.filter((item) => item.id === input.collectionID)
    : all.filter((item) => item.enabled !== false)
  const documents: SearchDocument[] = []
  for (const collection of collections) documents.push(...(await cachedChunks(collection.id, root)).documents)
  const base = buildGraph(documents, input.limit ?? 60)
  const stored: StoredGraph[] = []
  for (const collection of collections) {
    for (const meta of await listDocuments(collection.id, root)) {
      const item = await readStoredGraph(root, collection.id, meta.id)
      if (item && item.hash === meta.hash) stored.push(item)
    }
  }
  return stored.length > 0 ? mergeExtracted(base, stored) : base
}

// ---------------------------------------------------------------------------
// 索引缓存：search/graph 每次都要读全部文档并切片，几千篇文档会明显变慢。
// 用「集合 updatedAt + 文档数」做签名，内容一变缓存自动失效；
// 同一集合的 SearchDocument 只解析一次。
// ---------------------------------------------------------------------------
async function collectionSignature(collectionID: string, root: string) {
  const collection = await readJSON<Collection>(collectionFile(root, collectionID))
  return collection ? `${collection.updatedAt}:${await countDocuments(collectionID, root)}` : "missing"
}

async function countDocuments(collectionID: string, root: string) {
  try {
    return (await fs.readdir(documentsDir(root, collectionID))).filter((file) => file.endsWith(".json")).length
  } catch {
    return 0
  }
}

type ChunkIndexEntry = {
  signature: string
  chunks: IndexedChunk[]
  documents: SearchDocument[]
}

const chunkIndexCache = new Map<string, ChunkIndexEntry>()

/**
 * 取集合的切片索引（含持久化缓存）。
 *
 * 进程内命中直接返回；否则按 manifest 里的 hash 比对，只重建变过的文档。
 * 返回值同时带上 `documents`，稠密向量缓存需要它做 documentID → 文件路径的映射。
 */
async function cachedChunks(collectionID: string, root: string): Promise<ChunkIndexEntry> {
  const key = root + "|" + collectionID
  const signature = await collectionSignature(collectionID, root)
  const hit = chunkIndexCache.get(key)
  if (hit && hit.signature === signature) return hit

  const documents = await loadDocuments([{ id: collectionID }], root)
  const loaded = await IndexStore.loadCollectionIndex(
    collectionDir(root, collectionID),
    collectionID,
    signature,
    documents.map((document) => ({
      id: document.id,
      hash: document.hash ?? contentHash(document.content),
      title: document.title,
      content: document.content,
    })),
  )
  const entry: ChunkIndexEntry = { signature, chunks: loaded.chunks, documents }
  chunkIndexCache.set(key, entry)
  return entry
}

/** 供 UI 显示索引进度/规模：文档数、字符数、分片数。 */
export async function stats(collectionID: string, root = knowledgeRoot()) {
  const index = await cachedChunks(collectionID, root)
  const characters = index.documents.reduce((sum, document) => sum + document.content.length, 0)
  return { documents: index.documents.length, chunks: index.chunks.length, characters }
}

/** 知识库总览：跨集合的规模统计，用于首页/侧栏摘要。 */
export async function overview(
  root = knowledgeRoot(),
  filter: CollectionFilter = {},
): Promise<{
  collections: number
  enabled: number
  documents: number
  characters: number
  chunks: number
  updatedAt: number
}> {
  const collections = await listCollections(root, filter)
  let documents = 0
  let characters = 0
  let chunks = 0
  let updatedAt = 0
  for (const collection of collections) {
    const index = await cachedChunks(collection.id, root)
    documents += index.documents.length
    characters += index.documents.reduce((sum, document) => sum + document.content.length, 0)
    chunks += index.chunks.length
    updatedAt = Math.max(updatedAt, collection.updatedAt)
  }
  return {
    collections: collections.length,
    enabled: collections.filter((item) => item.enabled !== false).length,
    documents,
    characters,
    chunks,
    updatedAt,
  }
}

/** 最近查询：帮助用户重复使用上一条检索，也便于观察"大家在问什么"。 */
export type RecentQuery = { query: string; at: number; hits: number }

const historyFile = (root: string, collectionID: string) => path.join(collectionDir(root, collectionID), "queries.json")

export async function recentQueries(collectionID: string, root = knowledgeRoot()): Promise<RecentQuery[]> {
  assertID(collectionID, "collection id")
  const value = await readJSON<{ queries?: RecentQuery[] }>(historyFile(root, collectionID))
  return Array.isArray(value?.queries) ? value!.queries!.slice() : []
}

/** 记录一次查询；相同查询去重后置顶，最多保留 20 条。 */
export async function rememberQuery(
  collectionID: string,
  input: { query: string; hits: number },
  root = knowledgeRoot(),
): Promise<RecentQuery[]> {
  assertID(collectionID, "collection id")
  const query = input.query.trim()
  if (!query) return recentQueries(collectionID, root)
  const existing = await recentQueries(collectionID, root)
  const next = [
    { query, at: Date.now(), hits: input.hits },
    ...existing.filter((item) => item.query.toLowerCase() !== query.toLowerCase()),
  ].slice(0, 20)
  await writeJSON(historyFile(root, collectionID), { queries: next })
  return next
}

export async function clearQueries(collectionID: string, root = knowledgeRoot()) {
  assertID(collectionID, "collection id")
  await writeJSON(historyFile(root, collectionID), { queries: [] })
}

/** 重建索引：丢弃内存索引与向量缓存，下次检索重新切片/embedding。 */
export async function reindex(collectionID: string, root = knowledgeRoot()) {
  invalidate(collectionID, root)
  await IndexStore.clearCollectionIndex(collectionDir(root, collectionID))
  try {
    for (const file of await fs.readdir(documentsDir(root, collectionID))) {
      if (file.endsWith(".embedding.json")) {
        await fs.rm(path.join(documentsDir(root, collectionID), file), { force: true })
      }
    }
  } catch {
    // 目录不存在时无需清理。
  }
  return stats(collectionID, root)
}

/** 手动重建索引（例如外部直接改了目录里的文件）。 */
export function invalidate(collectionID?: string, root = knowledgeRoot()) {
  if (!collectionID) {
    for (const key of Array.from(chunkIndexCache.keys())) {
      if (key.startsWith(root + "|")) chunkIndexCache.delete(key)
    }
    return
  }
  chunkIndexCache.delete(root + "|" + collectionID)
}

/** 导出集合：纯 JSON（标题/来源/正文/时间/版本），可直接备份或迁移。 */
export async function exportCollection(collectionID: string, root = knowledgeRoot()) {
  const collection = await readJSON<Collection>(collectionFile(root, collectionID))
  if (!collection) throw new Error("Collection not found")
  const documents: Array<{
    title: string
    source?: string
    content: string
    version: number
    createdAt: number
    updatedAt: number
  }> = []
  for (const meta of await listDocuments(collectionID, root)) {
    const document = await getDocument(collectionID, meta.id, root)
    if (!document) continue
    documents.push({
      title: document.title,
      ...(document.source ? { source: document.source } : {}),
      content: document.content,
      version: document.version ?? 1,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    })
  }
  return {
    format: "novaway.knowledge.v1" as const,
    exportedAt: Date.now(),
    collection: { name: collection.name, description: collection.description },
    documents,
    // 校验和：导入方可以据此确认文件完整、未被截断或篡改。
    // 只覆盖内容相关字段，导出时间/集合名不参与，便于"同一份资料换名字"也能校验。
    signature: {
      algorithm: "sha256" as const,
      documents: documents.length,
      value: contentHash(
        JSON.stringify(documents.map((document) => [document.title, document.source ?? "", document.content])),
      ),
    },
  }
}

/** 校验导出包；没有 signature 的旧包视为"未签名"，由调用方决定是否接受。 */
export function verifyExport(input: {
  documents?: Array<{ title?: string; source?: string; content?: string }>
  signature?: { algorithm?: string; value?: string; documents?: number }
}): { ok: boolean; reason?: string; signed: boolean } {
  const documents = Array.isArray(input.documents) ? input.documents : []
  const signature = input.signature
  if (!signature?.value) return { ok: true, signed: false }
  if (signature.algorithm && signature.algorithm !== "sha256") {
    return { ok: false, signed: true, reason: "Unsupported signature algorithm" }
  }
  if (typeof signature.documents === "number" && signature.documents !== documents.length) {
    return { ok: false, signed: true, reason: "Document count does not match the signature" }
  }
  const expected = contentHash(
    JSON.stringify(documents.map((document) => [document.title ?? "", document.source ?? "", document.content ?? ""])),
  )
  if (expected !== signature.value) {
    return { ok: false, signed: true, reason: "Signature mismatch — the file may be corrupted or modified" }
  }
  return { ok: true, signed: true }
}

/** 从导出文件恢复：同名来源走版本更新，其余新增。 */
export async function restoreCollection(
  collectionID: string,
  input: {
    documents: Array<{ title: string; source?: string; content: string }>
    signature?: { algorithm?: string; value?: string; documents?: number }
  },
  root = knowledgeRoot(),
) {
  // 带签名时先校验，校验不过就整包拒绝：半截文件导入一半比直接失败更难收拾。
  const check = verifyExport(input)
  if (!check.ok) throw new Error(check.reason ?? "Invalid export file")
  let imported = 0
  let updated = 0
  let skipped = 0
  for (const document of input.documents) {
    if (!document.content?.trim()) {
      skipped++
      continue
    }
    const result = await addDocument(
      collectionID,
      { title: document.title || "Untitled", content: document.content, source: document.source },
      root,
    )
    if (result.duplicate) skipped++
    else if (result.updated) updated++
    else imported++
  }
  return { imported, updated, skipped }
}

/**
 * 相关文档：按共享实体的权重排序。
 * 这是「图谱检索」的轻量落地 —— 不需要 LLM，也能把同一主题下
 * 没被关键词命中的文档带出来。
 */
export async function related(
  input: { collectionID: string; documentID: string; limit?: number },
  root = knowledgeRoot(),
): Promise<Array<{ id: string; title: string; shared: string[]; score: number }>> {
  const documents = (await cachedChunks(input.collectionID, root)).documents
  const target = documents.find((document) => document.id === input.documentID)
  if (!target) return []
  const stored = new Map<string, StoredGraph>()
  for (const document of documents) {
    const item = await readStoredGraph(root, input.collectionID, document.id)
    if (item && item.hash === document.hash) stored.set(document.id, item)
  }
  const entitiesOf = (document: SearchDocument) => {
    const item = stored.get(document.id)
    // LLM 抽出的实体质量更高，优先使用；没有则回落到启发式。
    return item ? item.entities : extractEntities(document.content, 40)
  }
  const targetEntities = new Set(entitiesOf(target))
  if (targetEntities.size === 0) return []
  const scored = documents
    .filter((document) => document.id !== target.id)
    .map((document) => {
      const shared = Array.from(new Set(entitiesOf(document))).filter((entity) => targetEntities.has(entity))
      return { id: document.id, title: document.title, shared, score: shared.length }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 5)
  return scored
}

// ---------------------------------------------------------------------------
// 并发写保护
// ---------------------------------------------------------------------------
// 导入是并发的（批量接口、多个标签页、后台任务）。addDocument 的"查重 + 写入"
// 是读-改-写，如果不串行化，两个同内容文件会同时通过查重、各写一份。
// 这里按「root + 集合」做进程内串行，代价可忽略，换取确定性。
const writeLocks = new Map<string, Promise<unknown>>()

/**
 * 集合级写锁：**进程内串行 + 跨进程互斥**。
 *
 * 之前只有进程内的 Promise 链，桌面端 / TUI / Web 同时开着时多个进程会并发
 * 读改写同一集合（单文件写入是原子的，但 read-modify-write 仍会丢更新）。
 * 这里在进程内串行之外再套一层 Flock，锁文件落在核心的 state 目录。
 */
function withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(key) ?? Promise.resolve()
  const guarded = () =>
    Flock.withLock(key, run, { staleMs: 60_000, timeoutMs: 180_000 }).catch((error) => {
      // 拿不到文件锁（例如 state 目录不可写）时不能让写操作彻底失败：
      // 退回进程内串行，至少保证同进程内不会互相覆盖。
      if (error instanceof Error && /Flock global not set/i.test(error.message)) return run()
      throw error
    })
  const next = previous.then(guarded, guarded)
  writeLocks.set(
    key,
    next.catch(() => undefined),
  )
  return next
}

export function addDocument(
  collectionID: string,
  input: AddDocumentInput,
  root = knowledgeRoot(),
): Promise<AddDocumentResult> {
  return withLock(root + "|" + collectionID, () => addDocumentInner(collectionID, input, root))
}

// ---------------------------------------------------------------------------
// 文档查询：筛选 + 分页
// ---------------------------------------------------------------------------
export type DocumentSort = "updated" | "created" | "title"

export type DocumentQuery = {
  /** 标题 / 来源 / 文档 id 的子串匹配（不区分大小写）。 */
  q?: string
  sort?: DocumentSort
  limit?: number
  offset?: number
  /** 顺带在正文里搜索（大集合会慢，默认关闭）。 */
  searchContent?: boolean
}

export type DocumentPage = {
  total: number
  offset: number
  limit: number
  items: DocumentSummary[]
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export async function listDocumentsPage(
  collectionID: string,
  query: DocumentQuery = {},
  root = knowledgeRoot(),
): Promise<DocumentPage> {
  const all = await listDocuments(collectionID, root)
  const needle = query.q?.trim().toLowerCase() ?? ""

  let filtered = all
  if (needle) {
    filtered = []
    for (const document of all) {
      const haystack = (document.title + " " + (document.source ?? "") + " " + document.id).toLowerCase()
      if (haystack.includes(needle)) {
        filtered.push(document)
        continue
      }
      if (!query.searchContent) continue
      // 正文搜索只在显式开启时读文件，避免列表页每翻一页都全量读盘。
      const full = await getDocument(collectionID, document.id, root)
      if (full?.content.toLowerCase().includes(needle)) filtered.push(document)
    }
  }

  const sorted = filtered.slice()
  if (query.sort === "created") sorted.sort((a, b) => b.createdAt - a.createdAt)
  else if (query.sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title))
  else sorted.sort((a, b) => b.updatedAt - a.updatedAt)

  const limit = clamp(query.limit ?? 50, 1, 200)
  const offset = Math.max(0, query.offset ?? 0)
  return { total: sorted.length, offset, limit, items: sorted.slice(offset, offset + limit) }
}

// ---------------------------------------------------------------------------
// 批量操作与跨集合移动
// ---------------------------------------------------------------------------
export type BulkRemoveResult = { removed: string[]; missing: string[] }

export async function removeDocuments(
  collectionID: string,
  documentIDs: readonly string[],
  root = knowledgeRoot(),
): Promise<BulkRemoveResult> {
  const removed: string[] = []
  const missing: string[] = []
  for (const id of documentIDs) {
    const ok = await removeDocument(collectionID, id, root)
    if (ok) removed.push(id)
    else missing.push(id)
  }
  return { removed, missing }
}

/**
 * 移动文档到另一个集合。
 *
 * - 目标集合只读时拒绝
 * - 目标集合里已有同内容文档时按「重复」处理：删除源文档，返回已有文档
 * - 保留文档 id、版本与创建时间，只换 collectionID
 */
export async function moveDocument(
  fromCollectionID: string,
  toCollectionID: string,
  documentID: string,
  root = knowledgeRoot(),
): Promise<{ document: KnowledgeDocument; duplicate: boolean }> {
  assertID(fromCollectionID, "collection id")
  assertID(toCollectionID, "collection id")
  assertID(documentID, "document id")
  if (fromCollectionID === toCollectionID) throw new Error("Source and target collections are the same")

  return withLock(root + "|" + toCollectionID, async () => {
    const source = await getDocument(fromCollectionID, documentID, root)
    if (!source) throw new Error("Document not found")
    const target = await readJSON<Collection>(collectionFile(root, toCollectionID))
    if (!target) throw new Error("Target collection not found")
    assertWritable(target)

    const hash = source.hash ?? contentHash(source.content)
    for (const meta of await listDocuments(toCollectionID, root)) {
      if (meta.hash !== hash) continue
      const existing = await getDocument(toCollectionID, meta.id, root)
      if (!existing) continue
      await fs.rm(documentFile(root, fromCollectionID, documentID), { force: true })
      await fs.rm(vectorFile(root, fromCollectionID, documentID), { force: true }).catch(() => undefined)
      await fs.rm(graphFile(root, fromCollectionID, documentID), { force: true }).catch(() => undefined)
      await touchCollection(fromCollectionID, root)
      return { document: existing, duplicate: true }
    }

    const next: KnowledgeDocument = { ...source, collectionID: toCollectionID, hash }
    await writeJSON(documentFile(root, toCollectionID, documentID), next)
    await fs.rm(documentFile(root, fromCollectionID, documentID), { force: true })
    // 向量/图谱按文档 id 存放，跨集合后模型与集合无关，可以跟着搬迁，省一次重建。
    await moveIfExists(vectorFile(root, fromCollectionID, documentID), vectorFile(root, toCollectionID, documentID))
    await moveIfExists(graphFile(root, fromCollectionID, documentID), graphFile(root, toCollectionID, documentID))
    await touchCollection(fromCollectionID, root)
    await touchCollection(toCollectionID, root)
    invalidate(fromCollectionID, root)
    invalidate(toCollectionID, root)
    return { document: next, duplicate: false }
  })
}

async function moveIfExists(from: string, to: string) {
  try {
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.rename(from, to)
  } catch {
    // 源不存在时忽略：向量/图谱都是可重建的旁路缓存。
  }
}

async function touchCollection(collectionID: string, root: string) {
  const collection = await readJSON<Collection>(collectionFile(root, collectionID))
  if (collection) await writeJSON(collectionFile(root, collectionID), { ...collection, updatedAt: Date.now() })
}

export type BulkMoveResult = {
  moved: string[]
  duplicates: string[]
  missing: string[]
}

export async function moveDocuments(
  fromCollectionID: string,
  toCollectionID: string,
  documentIDs: readonly string[],
  root = knowledgeRoot(),
): Promise<BulkMoveResult> {
  const moved: string[] = []
  const duplicates: string[] = []
  const missing: string[] = []
  for (const id of documentIDs) {
    try {
      const result = await moveDocument(fromCollectionID, toCollectionID, id, root)
      if (result.duplicate) duplicates.push(id)
      else moved.push(id)
    } catch (error) {
      if (error instanceof Error && error.message === "Document not found") missing.push(id)
      else throw error
    }
  }
  return { moved, duplicates, missing }
}

// ---------------------------------------------------------------------------
// 完整性检查与修复
// ---------------------------------------------------------------------------
export type IntegrityIssue = {
  kind: "orphan-sidecar" | "bad-json" | "duplicate-content" | "missing-document"
  collectionID: string
  documentID?: string
  detail: string
}

export type IntegrityReport = {
  collections: number
  documents: number
  issues: IntegrityIssue[]
}

/**
 * 扫描知识库目录。
 *
 * 只读：不会修改任何文件。用于"导入/迁移之后确认没有留下半截数据"，
 * 以及排查"删了文档但向量文件还在"这类残留。
 */
export async function integrity(root = knowledgeRoot()): Promise<IntegrityReport> {
  const collections = await listCollections(root)
  const issues: IntegrityIssue[] = []
  let documents = 0

  for (const collection of collections) {
    const dir = documentsDir(root, collection.id)
    let files: string[] = []
    try {
      files = await fs.readdir(dir)
    } catch {
      continue
    }

    const seen = new Map<string, string>()
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      const full = path.join(dir, file)
      const isSidecar = file.endsWith(".embedding.json") || file.endsWith(".graph.json")
      const documentID = isSidecar ? file.replace(/\.(embedding|graph)\.json$/, "") : file.replace(/\.json$/, "")

      if (isSidecar) {
        if (!(await exists(path.join(dir, documentID + ".json")))) {
          issues.push({
            kind: "orphan-sidecar",
            collectionID: collection.id,
            documentID,
            detail: file,
          })
        }
        continue
      }

      documents++
      const document = await readJSON<KnowledgeDocument>(full)
      if (!document) {
        issues.push({ kind: "bad-json", collectionID: collection.id, documentID, detail: file })
        continue
      }
      const hash = document.hash ?? contentHash(document.content)
      const previous = seen.get(hash)
      if (previous && previous !== documentID) {
        issues.push({
          kind: "duplicate-content",
          collectionID: collection.id,
          documentID,
          detail: "same content as " + previous,
        })
        continue
      }
      seen.set(hash, documentID)
    }
  }

  return { collections: collections.length, documents, issues }
}

/** 修复：删除孤儿 sidecar（向量 / 图谱缓存）。其余问题只报告，不自动删除数据。 */
export async function repair(root = knowledgeRoot()): Promise<{ removed: number }> {
  const report = await integrity(root)
  let removed = 0
  for (const issue of report.issues) {
    if (issue.kind !== "orphan-sidecar") continue
    await fs
      .rm(path.join(documentsDir(root, issue.collectionID), issue.detail), { force: true })
      .then(() => {
        removed++
      })
      .catch(() => undefined)
  }
  if (removed > 0) {
    for (const collectionID of new Set(report.issues.map((item) => item.collectionID))) {
      await touchCollection(collectionID, root)
    }
  }
  return { removed }
}

// ---------------------------------------------------------------------------
// 整个知识库的导出 / 导入
// ---------------------------------------------------------------------------
export type LibraryExport = {
  format: "novaway.knowledge.library.v1"
  exportedAt: number
  collections: Array<{
    name: string
    description?: string
    enabled?: boolean
    documents: Array<{
      title: string
      source?: string
      content: string
      version: number
      createdAt: number
      updatedAt: number
    }>
  }>
}

export async function exportLibrary(root = knowledgeRoot()): Promise<LibraryExport> {
  const collections = await listCollections(root)
  const output: LibraryExport["collections"] = []
  for (const collection of collections) {
    const single = await exportCollection(collection.id, root)
    output.push({
      name: collection.name,
      ...(collection.description ? { description: collection.description } : {}),
      ...(collection.enabled === false ? { enabled: false } : {}),
      documents: single.documents,
    })
  }
  return { format: "novaway.knowledge.library.v1", exportedAt: Date.now(), collections: output }
}

export type LibraryImportResult = {
  collections: number
  imported: number
  updated: number
  skipped: number
}

/**
 * 导入整个知识库。
 *
 * 按集合名匹配：已存在则合并（同来源文件走版本更新），不存在则新建。
 * 迁移整台机器时用它，比逐个集合导出/导入省事。
 */
export async function importLibrary(input: LibraryExport, root = knowledgeRoot()): Promise<LibraryImportResult> {
  if (input.format !== "novaway.knowledge.library.v1") {
    throw new Error("Unsupported library export format")
  }
  const existing = await listCollections(root)
  const byName = new Map(existing.map((item) => [item.name, item]))
  let collections = 0
  let imported = 0
  let updated = 0
  let skipped = 0

  for (const item of input.collections) {
    let target = byName.get(item.name)
    if (!target) {
      const created = await createCollection({ name: item.name, description: item.description }, root)
      target = { ...created, documentCount: 0 }
      byName.set(created.name, target)
      collections++
    }
    const result = await restoreCollection(
      target.id,
      { documents: item.documents.map((document) => ({ ...document, title: document.title })) },
      root,
    )
    imported += result.imported
    updated += result.updated
    skipped += result.skipped
  }

  return { collections, imported, updated, skipped }
}

/** 分片预览：调切片参数、排查"为什么这条没被检索到"时用。 */
export async function documentChunks(
  collectionID: string,
  documentID: string,
  root = knowledgeRoot(),
): Promise<Array<{ index: number; text: string; length: number }>> {
  const document = await getDocument(collectionID, documentID, root)
  if (!document) throw new Error("Document not found")
  const { chunkText } = await import("./search")
  return chunkText(document.content).map((chunk) => ({
    index: chunk.index,
    text: chunk.text,
    length: chunk.text.length,
  }))
}
