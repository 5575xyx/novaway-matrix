// 预览面板里选中的元素 → composer 文件上下文。纯函数，便于单测。

export const PICK_READY = "__nova_pick_ready"
export const PICK_ELEMENT = "__nova_pick_element"
export const PICK_ARM = "__nova_pick_arm"

export type PickedElement = {
  tag: string
  cssPath: string
  text: string
  outerHtml: string
  attributes: Record<string, string>
  styles: Record<string, string>
  rect: { x: number; y: number; width: number; height: number }
}

export type PickReadyMessage = { type: typeof PICK_READY; sourceUrl: string }
export type PickElementMessage = { type: typeof PICK_ELEMENT; sourceUrl: string; element: PickedElement }
// ARM 是双向消息：父页面下发开关联动，脚本状态变化（含 Esc 取消）也回发同一条
export type PickArmMessage = { type: typeof PICK_ARM; sourceUrl: string; armed: boolean }
export type PickMessage = PickReadyMessage | PickElementMessage | PickArmMessage

/** 只认字段齐全的约定消息，别的 window.postMessage 一律忽略 */
export function isPickMessage(value: unknown): value is PickMessage {
  if (!value || typeof value !== "object") return false

  const candidate = value as { type?: unknown; sourceUrl?: unknown; element?: unknown; armed?: unknown }
  if (typeof candidate.sourceUrl !== "string" || !candidate.sourceUrl) return false

  if (candidate.type === PICK_READY) return true
  if (candidate.type === PICK_ARM) return typeof candidate.armed === "boolean"
  if (candidate.type !== PICK_ELEMENT) return false

  const element = candidate.element
  return (
    !!element &&
    typeof element === "object" &&
    typeof (element as PickedElement).tag === "string" &&
    typeof (element as PickedElement).cssPath === "string"
  )
}

export function isPickElement(value: PickMessage): value is PickElementMessage {
  return value.type === PICK_ELEMENT
}

function clip(value: string, limit: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit)}...`
}

/** 卡片上的短标签，也是发给模型的 selection preview */
export function pickedElementLabel(element: PickedElement): string {
  const id = element.attributes.id
  if (id) return `${element.tag}#${id}`
  const firstClass = element.attributes.class?.trim().split(/\s+/)[0]
  if (firstClass) return `${element.tag}.${firstClass}`
  return `<${element.tag}>`
}

function attributeList(element: PickedElement): string {
  const skip = new Set(["style"])
  return Object.entries(element.attributes)
    .filter(([name]) => !skip.has(name.toLowerCase()))
    .map(([name, value]) => (value ? `${name}="${clip(value, 120)}"` : name))
    .join(" ")
}

function styleList(element: PickedElement): string[] {
  return Object.entries(element.styles)
    .filter(([, value]) => !!value)
    .map(([name, value]) => `${name}: ${clip(value, 120)};`)
}

/** 发给模型的元素说明：中性描述，用户自己的修改要求写在正文里 */
export function pickedElementComment(element: PickedElement): string {
  const lines = [
    "下面是我在预览里选中的元素，请基于它修改页面：",
    "",
    `- CSS 路径: ${element.cssPath}`,
    `- 标签与属性: <${element.tag}${attributeList(element) ? ` ${attributeList(element)}` : ""}>`,
  ]

  const text = clip(element.text, 300)
  if (text) lines.push(`- 文本内容: ${text}`)

  const styles = styleList(element)
  if (styles.length > 0) {
    lines.push("- 关键样式:")
    for (const style of styles) lines.push(`  - ${style}`)
  }

  const markup = element.outerHtml.replace(/\n{3,}/g, "\n\n").trim()
  if (markup) {
    lines.push("- 元素源码:")
    lines.push("```html")
    lines.push(clip(markup, 1500))
    lines.push("```")
  }

  return lines.join("\n")
}

/** 组装成 composer 的文件上下文条目 */
export function buildPickedContextItem(
  path: string,
  element: PickedElement,
): {
  type: "file"
  path: string
  comment: string
  preview: string
} {
  return {
    type: "file",
    path,
    comment: pickedElementComment(element),
    preview: pickedElementLabel(element),
  }
}
