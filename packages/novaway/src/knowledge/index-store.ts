/**
 * 知识库的持久化倒排/切片索引。
 *
 * 之前每次进程重启后的第一次检索都要把整个集合的文档读出来重新切片、分词、
 * 计算稀疏向量。几百篇还好，上千篇就是明显的首字延迟，而且改一篇会重算全库。
 *
 * 现在的做法：
 * - 每个文档一份 `index/<docID>.json`，存切片**偏移与长度**、词频（tf）与稀疏向量；
 * - `index/manifest.json` 记录集合签名（updatedAt + 文档数）与每篇文档的内容 hash；
 * - 加载时按 hash 比对：没变的直接读缓存文件，变了的才重新切片；
 * - 写入用 tmp + rename，避免半截文件。
 *
 * 体积优化（v2）：切片正文不再重复存储 —— 只存 `off` / `n`，加载时从原文
 * 按偏移切回来；稀疏向量只保留权重靠前的若干项。实测索引体积从原文的
 * 3.4 倍降到约 1 倍。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { textVector } from "@/memory/vector"
import { chunkText, normalizeForChunks, tokenize, type IndexedChunk } from "./search"

const VERSION = 2

/** 稀疏向量保留的最大项数。 */
const VEC_MAX_TERMS = 48
/** 低于「最大权重 × 该比例」的项直接丢弃（多半是单字 n-gram 噪声）。 */
const VEC_MIN_RATIO = 0.04
/** 权重保留的小数位：4 位足够区分排序，又比全精度省一半字符。 */
const VEC_PRECISION = 4

export type PersistedChunk = {
  /** 切片序号。 */
  i: number
  /** 在规范化正文中的起始偏移。 */
  off: number
  /** 正文长度。 */
  n: number
  /** 词频：[token, count][]。 */
  tf: Array<[string, number]>
  /** token 总数，BM25 的长度归一化用它。 */
  tl: number
  /** 稀疏向量：[token, weight][]（已裁剪与量化）。 */
  vec: Array<[string, number]>
}

export type PersistedDocumentIndex = {
  hash: string
  title: string
  /** 规范化后正文长度：偏移越界时用它判断索引是否已过期。 */
  len: number
  chunks: PersistedChunk[]
}

export type Manifest = {
  version: number
  signature: string
  /** docID → 内容 hash。 */
  documents: Record<string, string>
}

export type LoadedIndex = {
  chunks: IndexedChunk[]
  /** 本次真正重建的文档数（0 表示全部命中缓存）。 */
  rebuilt: number
  /** 索引覆盖的文档数。 */
  documents: number
}

/** 每重建这么多篇就让出一次事件循环，避免大批量建索引时卡住 HTTP 请求。 */
const YIELD_EVERY = 20

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const indexDir = (collectionDir: string) => path.join(collectionDir, "index")
const manifestFile = (collectionDir: string) => path.join(indexDir(collectionDir), "manifest.json")
const documentFile = (collectionDir: string, docID: string) => path.join(indexDir(collectionDir), docID + ".json")

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch {
    return undefined
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + "." + process.pid + "." + Date.now() + ".tmp"
  await fs.writeFile(tmp, JSON.stringify(value), "utf8")
  await fs.rename(tmp, file)
}

/** 裁剪 + 量化稀疏向量：保留权重靠前的项，丢掉长尾噪声。 */
export function slimVector(vector: ReadonlyMap<string, number>) {
  const entries = Array.from(vector.entries())
  if (entries.length === 0) return [] as Array<[string, number]>
  let max = 0
  for (const [, weight] of entries) max = Math.max(max, Math.abs(weight))
  const floor = max * VEC_MIN_RATIO
  return entries
    .filter(([, weight]) => Math.abs(weight) >= floor)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, VEC_MAX_TERMS)
    .map(([key, weight]) => [key, Number(weight.toFixed(VEC_PRECISION))] as [string, number])
}

/** 把一篇文档切成可持久化的索引条目（不保存正文本身）。 */
export function buildDocumentIndex(input: { hash: string; title: string; content: string }): PersistedDocumentIndex {
  const normalized = normalizeForChunks(input.content)
  const chunks = chunkText(input.content).map((chunk) => {
    const tokens = tokenize(input.title + "\n" + chunk.text)
    const counts = new Map<string, number>()
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    const vector = textVector(chunk.text + "\n" + input.title)
    return {
      i: chunk.index,
      off: chunk.offset,
      n: chunk.text.length,
      tf: Array.from(counts.entries()),
      tl: tokens.length,
      vec: slimVector(vector),
    } satisfies PersistedChunk
  })
  return { hash: input.hash, title: input.title, len: normalized.length, chunks }
}

/** 落盘后的条目还原成检索用的结构。`text` 由调用方从原文切出来。 */
export function toIndexedChunk(
  collectionID: string,
  documentID: string,
  title: string,
  chunk: PersistedChunk,
  text: string,
): IndexedChunk {
  return {
    collectionID,
    documentID,
    title,
    chunk: chunk.i,
    text,
    offset: chunk.off,
    // 检索器优先用 tf / length；tokens 只为兼容老路径留空数组。
    tokens: [],
    tf: new Map(chunk.tf),
    length: chunk.tl,
    vector: new Map(chunk.vec),
  }
}

/**
 * 读取（必要时重建）集合索引。
 *
 * `documents` 是当前集合里全部文档的元信息（id / hash / title / content）。
 * 只要 hash 没变就直接复用磁盘上的条目；正文按偏移从原文切回来。
 */
export async function loadCollectionIndex(
  collectionDir: string,
  collectionID: string,
  signature: string,
  documents: ReadonlyArray<{ id: string; hash: string; title: string; content: string }>,
): Promise<LoadedIndex> {
  const dir = indexDir(collectionDir)
  const manifest = await readJson<Manifest>(manifestFile(collectionDir))
  // 复用只看「每篇文档的 hash」：集合签名变了（增删过文档）不代表其余文档要重算。
  const valid = manifest?.version === VERSION

  const chunks: IndexedChunk[] = []
  const next: Record<string, string> = {}
  let rebuilt = 0
  let sinceYield = 0

  for (const document of documents) {
    // 建索引是 CPU 密集的：每 20 篇让出一次事件循环，界面请求不会被整段阻塞。
    if (sinceYield >= YIELD_EVERY) {
      sinceYield = 0
      await yieldToEventLoop()
    }
    next[document.id] = document.hash
    let persisted: PersistedDocumentIndex | undefined
    if (valid && manifest?.documents?.[document.id] === document.hash) {
      persisted = await readJson<PersistedDocumentIndex>(documentFile(collectionDir, document.id))
      if (persisted && persisted.hash !== document.hash) persisted = undefined
    }
    if (!persisted) {
      persisted = buildDocumentIndex(document)
      await writeJson(documentFile(collectionDir, document.id), persisted).catch(() => undefined)
      rebuilt++
      sinceYield++
    }

    const normalized = normalizeForChunks(document.content)
    // 正文长度对不上说明索引与原文不同步（外部改过文件），按未命中处理。
    const usable = persisted.len === normalized.length
    if (!usable) {
      persisted = buildDocumentIndex(document)
      await writeJson(documentFile(collectionDir, document.id), persisted).catch(() => undefined)
      rebuilt++
      sinceYield++
    }
    const source = usable ? normalized : normalizeForChunks(document.content)
    for (const chunk of persisted.chunks) {
      const text = source.slice(chunk.off, chunk.off + chunk.n)
      chunks.push(toIndexedChunk(collectionID, document.id, document.title, chunk, text))
    }
  }

  // 清掉已删除文档的索引文件，避免目录无限增长。
  if (manifest) {
    for (const id of Object.keys(manifest.documents ?? {})) {
      if (next[id]) continue
      await fs.rm(documentFile(collectionDir, id), { force: true }).catch(() => undefined)
    }
  }

  if (!valid || rebuilt > 0 || manifest?.signature !== signature) {
    await writeJson(manifestFile(collectionDir), {
      version: VERSION,
      signature,
      documents: next,
    } satisfies Manifest).catch(() => undefined)
  } else {
    await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
  }

  return { chunks, rebuilt, documents: documents.length }
}

/** 删除整个集合索引（重建索引 / 删除文档时用）。 */
export async function clearCollectionIndex(collectionDir: string, documentID?: string) {
  if (documentID) {
    await fs.rm(documentFile(collectionDir, documentID), { force: true }).catch(() => undefined)
    return
  }
  await fs.rm(indexDir(collectionDir), { recursive: true, force: true }).catch(() => undefined)
}

/** 索引占用（字节），用于设置页显示规模。 */
export async function indexSize(collectionDir: string) {
  const dir = indexDir(collectionDir)
  try {
    const files = await fs.readdir(dir)
    let bytes = 0
    for (const file of files) {
      const stat = await fs.stat(path.join(dir, file)).catch(() => undefined)
      if (stat) bytes += stat.size
    }
    return bytes
  } catch {
    return 0
  }
}
