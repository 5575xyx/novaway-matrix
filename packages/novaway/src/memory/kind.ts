export const memoryKinds = [
  "episodic",
  "semantic",
  "preference",
  "goal",
  "decision",
  "relationship",
  "lesson",
  "procedure",
] as const

export type MemoryKind = (typeof memoryKinds)[number]

export type MemoryEntity = {
  name: string
  type?: string
}

const KIND_PREFIX = "memory-kind:"
const ENTITY_PREFIX = "entity:"

function cleanTagPart(value: string) {
  return value
    .trim()
    .replace(/[\r\n\t:]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80)
}

export function resolveMemoryKind(input: {
  kind?: MemoryKind
  content?: string
  tags?: readonly string[]
}): MemoryKind {
  if (input.kind && memoryKinds.includes(input.kind)) return input.kind
  const tagged = input.tags?.find((tag) => tag.startsWith(KIND_PREFIX))?.slice(KIND_PREFIX.length) as
    | MemoryKind
    | undefined
  if (tagged && memoryKinds.includes(tagged)) return tagged

  const text = `${input.content ?? ""} ${(input.tags ?? []).join(" ")}`
  if (/偏好|喜欢|习惯|风格|语气|prefer|preference|favorite|habit/i.test(text)) return "preference"
  if (/目标|计划|希望|打算|里程碑|goal|objective|plan|milestone|intend/i.test(text)) return "goal"
  if (/决定|决策|选择了|确定采用|decision|decided|chose|selected/i.test(text)) return "decision"
  if (/关系|同事|朋友|家人|客户|负责|属于|relationship|colleague|friend|family|customer/i.test(text))
    return "relationship"
  if (/经验|教训|复盘|避免|失败原因|lesson|learned|retrospective|avoid/i.test(text)) return "lesson"
  if (/步骤|流程|方法|操作|如何|procedure|workflow|steps|how to/i.test(text)) return "procedure"
  if (/发生|上次|曾经|会议|事件|完成了|happened|last time|meeting|event/i.test(text)) return "episodic"
  return "semantic"
}

export function normalizeMemoryEntities(entities: readonly MemoryEntity[] | undefined) {
  if (!entities) return []
  const seen = new Set<string>()
  return entities
    .map((entity) => ({
      name: cleanTagPart(entity.name),
      type: entity.type ? cleanTagPart(entity.type).toLowerCase() : undefined,
    }))
    .filter((entity) => entity.name)
    .filter((entity) => {
      const key = `${entity.type ?? ""}:${entity.name.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 12)
}

export function addMemoryMetadataTags(tags: readonly string[], kind: MemoryKind, entities?: readonly MemoryEntity[]) {
  const plain = tags.filter((tag) => !tag.startsWith(KIND_PREFIX) && !tag.startsWith(ENTITY_PREFIX))
  const normalized = entities === undefined ? memoryEntitiesFromTags(tags) : normalizeMemoryEntities(entities)
  const entityTags = normalized.map((entity) => `${ENTITY_PREFIX}${entity.type ?? "general"}:${entity.name}`)
  return Array.from(new Set([...plain, `${KIND_PREFIX}${kind}`, ...entityTags]))
}

export function memoryKindFromTags(tags: readonly string[]) {
  return resolveMemoryKind({ tags })
}

export function memoryEntitiesFromTags(tags: readonly string[]) {
  return normalizeMemoryEntities(
    tags
      .filter((tag) => tag.startsWith(ENTITY_PREFIX))
      .map((tag) => {
        const value = tag.slice(ENTITY_PREFIX.length)
        const split = value.indexOf(":")
        if (split === -1) return { name: value }
        return { type: value.slice(0, split), name: value.slice(split + 1) }
      }),
  )
}

export function memoryKindLabel(kind: MemoryKind) {
  if (kind === "episodic") return "情景"
  if (kind === "preference") return "偏好"
  if (kind === "goal") return "目标"
  if (kind === "decision") return "决策"
  if (kind === "relationship") return "关系"
  if (kind === "lesson") return "经验"
  if (kind === "procedure") return "程序"
  return "事实"
}
