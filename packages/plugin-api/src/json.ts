/**
 * JSON Schema 的最小结构类型。
 *
 * plugin-api 不许依赖任何 SDK 或运行时包（插件文档 §2.2 规则 1），因此不 import `@types/json-schema`。
 */
export type JSONSchemaType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null"

export type JSONSchema = {
  type?: JSONSchemaType
  description?: string
  enum?: readonly unknown[]
  const?: unknown
  properties?: Record<string, JSONSchema>
  required?: readonly string[]
  additionalProperties?: boolean | JSONSchema
  propertyNames?: JSONSchema
  items?: JSONSchema | readonly JSONSchema[]
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  anyOf?: readonly JSONSchema[]
  oneOf?: readonly JSONSchema[]
  allOf?: readonly JSONSchema[]
  not?: JSONSchema
  default?: unknown
  [key: string]: unknown
}
