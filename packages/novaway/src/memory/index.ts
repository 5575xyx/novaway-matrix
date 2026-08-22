export { MemoryEntryTable, MemoryRelationTable, MemoryReviewCandidateTable, MemoryReviewStateTable } from "./memory.sql"
export { MemoryContext } from "./context"
export { Memory } from "./service"
export { MemorySchema } from "./schema"
export { shouldPrefetch, buildPrefetchText, selectPrefetchItems, formatMemoryIndex } from "./prefetch"
export { classifyMemoryScope, resolveMemoryScope, scopeLabel } from "./scope"

export { classifyMemoryDomain, domainLabel, resolveMemoryDomain } from "./domain"
export { deriveFactKey, normalizeFactKey, resolveMemoryOperation } from "./fact"
export {
  addMemoryMetadataTags,
  memoryEntitiesFromTags,
  memoryKindFromTags,
  memoryKindLabel,
  memoryKinds,
  normalizeMemoryEntities,
  resolveMemoryKind,
} from "./kind"
export { hybridScore, sanitizeFtsQuery, mergeHybridCandidates, rankBySemantic } from "./search"
export { listRelationsFromMemory, findRelatedMemories, detectRelationConflicts } from "./relations"
export { evaluateTaskCoverage, summarizeTaskComparison } from "./task-eval"

export { textVector, cosineSimilarity, semanticScore, semanticSimilarity } from "./vector"

export { resolveEmbedder, embedText, denseCosine, clearEmbedderCache, parseEmbeddingJson } from "./embedder"

export { inspectOllama, setupLocalEmbedding, DEFAULT_EMBED_MODEL, DEFAULT_OLLAMA_URL } from "./ollama-setup"
