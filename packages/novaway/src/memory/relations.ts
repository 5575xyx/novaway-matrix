import type { Info } from "./schema"
import { memoryKindFromTags } from "./kind"

export type MemoryRelationEdge = {
  source: string
  relation: string
  target: string
  memoryID: string
  context: string
}

export type RelationConflict = {
  kind: "duplicate" | "conflict"
  source: string
  relation: string
  target: string
  existing: MemoryRelationEdge
}

export function detectRelationConflicts(
  edges: readonly MemoryRelationEdge[],
  input: { source: string; relation: string; target: string },
) {
  const source = input.source.trim()
  const target = input.target.trim()
  const relation = input.relation.trim()
  return edges
    .filter((edge) => edge.source === source && edge.target === target)
    .map((existing) => ({
      kind: existing.relation === relation ? ("duplicate" as const) : ("conflict" as const),
      source,
      relation,
      target,
      existing,
    }))
}

export function extractRelation(content: string, source: string, target: string) {
  const normalized = content.replace(/\s+/g, " ").trim()
  const sourceIndex = normalized.indexOf(source)
  const targetIndex = normalized.indexOf(target)
  if (sourceIndex === -1 || targetIndex === -1) return "相关"
  if (sourceIndex < targetIndex) {
    return (
      normalized
        .slice(sourceIndex + source.length, targetIndex)
        .trim()
        .replace(/^[,，:：]+|[,，:：]+$/g, "") || "相关"
    )
  }
  return (
    normalized
      .slice(targetIndex + target.length, sourceIndex)
      .trim()
      .replace(/^[,，:：]+|[,，:：]+$/g, "") || "相关"
  )
}

export function listRelationsFromMemory(items: readonly Info[]): MemoryRelationEdge[] {
  const edges: MemoryRelationEdge[] = []
  for (const item of items) {
    const kind = item.kind ?? memoryKindFromTags(item.tags)
    if (kind !== "relationship") continue
    const entities = item.entities ?? []
    if (entities.length < 2) continue
    const source = entities[0]!.name
    const target = entities[1]!.name
    edges.push({
      source,
      relation: extractRelation(item.content, source, target),
      target,
      memoryID: item.id,
      context: item.content,
    })
  }
  return edges
}

export function findRelatedMemories(items: readonly Info[], entity: string, relation?: string): MemoryRelationEdge[] {
  const edges = listRelationsFromMemory(items)
  const key = entity.trim().toLowerCase()
  return edges.filter((edge) => {
    const matched = edge.source.toLowerCase() === key || edge.target.toLowerCase() === key
    if (!matched) return false
    if (!relation) return true
    return edge.relation.toLowerCase().includes(relation.toLowerCase())
  })
}
