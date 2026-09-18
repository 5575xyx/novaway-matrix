import { expect, test } from "bun:test"
import {
  buildPickedContextItem,
  isPickMessage,
  pickedElementComment,
  pickedElementLabel,
  type PickedElement,
} from "./preview-pick"

const element: PickedElement = {
  tag: "h1",
  cssPath: "div.toolbox > h1.title",
  text: "多功能时间工具箱",
  outerHtml: '<h1 class="title">多功能时间工具箱</h1>',
  attributes: { class: "title hero", id: "", style: "color: red" },
  styles: { color: "rgb(59, 130, 246)", "font-size": "32px", "font-weight": "700" },
  rect: { x: 40, y: 80, width: 480, height: 56 },
}

test("校验 iframe 发来的消息：字段齐全才认", () => {
  expect(isPickMessage({ type: "__nova_pick_ready", sourceUrl: "oc-file://local/index.html" })).toBe(true)
  expect(isPickMessage({ type: "__nova_pick_arm", sourceUrl: "oc-file://local/index.html", armed: true })).toBe(true)
  expect(isPickMessage({ type: "__nova_pick_arm", sourceUrl: "oc-file://local/index.html", armed: "yes" })).toBe(false)
  expect(isPickMessage({ type: "__nova_pick_element", sourceUrl: "oc-file://local/index.html", element })).toBe(true)
  expect(isPickMessage({ type: "__nova_pick_element", sourceUrl: "", element })).toBe(false)
  expect(isPickMessage({ type: "__nova_pick_element", sourceUrl: "x" })).toBe(false)
  expect(isPickMessage({ type: "__nova_pick_element", sourceUrl: "x", element: { tag: 1 } })).toBe(false)
  expect(isPickMessage({ type: "__nova_pick_element", sourceUrl: "x", element: { tag: "div" } })).toBe(false)
  expect(isPickMessage({ type: "__nova_other", sourceUrl: "x" })).toBe(false)
  expect(isPickMessage(null)).toBe(false)
  expect(isPickMessage("string")).toBe(false)
  expect(isPickMessage(42)).toBe(false)
  expect(isPickMessage(undefined)).toBe(false)
})

test("短标签优先用 id，其次首个 class，否则用标签名", () => {
  expect(pickedElementLabel({ ...element, attributes: { id: "hero" } })).toBe("h1#hero")
  expect(pickedElementLabel(element)).toBe("h1.title")
  expect(pickedElementLabel({ ...element, attributes: {} })).toBe("<h1>")
  expect(pickedElementLabel({ ...element, attributes: { class: "   " } })).toBe("<h1>")
})

test("元素说明包含定位、样式与源码片段", () => {
  const comment = pickedElementComment(element)
  expect(comment).toContain("div.toolbox > h1.title")
  expect(comment).toContain("多功能时间工具箱")
  expect(comment).toContain('class="title hero"')
  expect(comment).toContain("color: rgb(59, 130, 246);")
  expect(comment).toContain("```html")
  expect(comment).toContain("</h1>")
  // inline style 不进属性列表，避免和计算样式重复
  expect(comment).not.toContain('style="')
})

test("超长文本与源码被截断，不留半截结构", () => {
  const long: PickedElement = {
    ...element,
    text: "x".repeat(500),
    outerHtml: "<div>" + "y".repeat(2000) + "</div>",
  }
  const comment = pickedElementComment(long)
  expect(comment).toContain("...")
  expect(comment.length).toBeLessThan(2500)
})

test("组装成 composer 的文件上下文条目", () => {
  const item = buildPickedContextItem("E:/work/demo/index.html", element)
  expect(item.type).toBe("file")
  expect(item.path).toBe("E:/work/demo/index.html")
  expect(item.preview).toBe("h1.title")
  expect(item.comment).toContain("div.toolbox > h1.title")
})
