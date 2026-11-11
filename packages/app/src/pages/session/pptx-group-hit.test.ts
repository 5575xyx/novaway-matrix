import { describe, expect, it } from "bun:test"
import JSZip from "jszip"
import {
  buildPresentation,
  materializeSlideNodes,
  parseZip,
  RECOMMENDED_ZIP_LIMITS,
  type GroupNodeData,
} from "@aiden0z/pptx-renderer/browser"
import { pptxFromSlides } from "@novaway/core/office/create"
import { clearGroupChildText, hitInGroup, restoreGroupChildText } from "./pptx-group-hit"

// happy-dom 没有实现 lookupNamespaceURI，而 pptx-renderer 解析 r:id 时依赖它。
const NAMESPACES: Record<string, string> = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
const proto = Element.prototype as Element & { lookupNamespaceURI?: (prefix: string) => string | null }
if (typeof proto.lookupNamespaceURI !== "function") {
  proto.lookupNamespaceURI = (prefix: string) => NAMESPACES[prefix] ?? null
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS_P =
  ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'

function shape(id: string, name: string, x: number, y: number, text: string) {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="1000000" cy="1000000"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
  )
}

function group(
  id: string,
  inner: string,
  xfrm = '<a:off x="0" y="0"/><a:ext cx="3000000" cy="3000000"/><a:chOff x="0" y="0"/><a:chExt cx="3000000" cy="3000000"/>',
  attrs = "",
) {
  return (
    `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="grp-${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm${attrs}>${xfrm}</a:xfrm></p:grpSpPr>${inner}</p:grpSp>`
  )
}

function slideXml(tree: string) {
  return (
    `${XML_HEAD}<p:sld${NS_P}><p:cSld><p:spTree>` +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    tree +
    "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
  )
}

async function loadGroup(tree: string) {
  const base = pptxFromSlides("t", [{ title: "t", lines: [] }])
  const zip = await JSZip.loadAsync(base)
  zip.file("ppt/slides/slide1.xml", slideXml(tree))
  const patched = await zip.generateAsync({ type: "uint8array" })
  // zip.generateAsync 返回的 buffer 是 ArrayBufferLike；拷进确定的 ArrayBuffer 再交给解析器。
  const buffer = new ArrayBuffer(patched.byteLength)
  new Uint8Array(buffer).set(patched)
  const files = await parseZip(buffer, RECOMMENDED_ZIP_LIMITS)
  const pres = buildPresentation(files)
  const slide = pres.slides[0]
  materializeSlideNodes(pres, slide)
  const group = slide.nodes.find((node) => node.nodeType === "group")
  if (!group) throw new Error("no group parsed")
  return group
}

describe("hitInGroup", () => {
  it("命中最内层子形状，父 id 是直接所属的组合", async () => {
    const inner = group("3", shape("4", "inner-a", 0, 0, "内层 A") + shape("5", "inner-b", 0, 1500000, "内层 B"))
    const outer = await loadGroup(group("2", inner + shape("6", "outer", 4000000, 0, "外层")))
    expect(outer.id).toBe("2")

    expect(hitInGroup(outer, { x: 500_000, y: 500_000 })).toMatchObject({ parentId: "3" })
    expect(hitInGroup(outer, { x: 500_000, y: 1_700_000 })).toMatchObject({ parentId: "3" })
  })

  it("命中组合外的直接子形状", async () => {
    const inner = group("3", shape("4", "inner-a", 0, 0, "内层 A"))
    const outer = await loadGroup(group("2", inner + shape("6", "outer", 4000000, 0, "外层")))
    expect(hitInGroup(outer, { x: 4_500_000, y: 500_000 })).toMatchObject({ parentId: "2" })
  })

  it("点空白返回 undefined", async () => {
    const inner = group("3", shape("4", "inner-a", 0, 0, "内层 A"))
    const outer = await loadGroup(group("2", inner + shape("6", "outer", 4000000, 0, "外层")))
    expect(hitInGroup(outer, { x: 3_500_000, y: 2_500_000 })).toBeUndefined()
  })

  it("组合被缩放时按 chExt→ext 的比例换算", async () => {
    const xfrm =
      '<a:off x="0" y="0"/><a:ext cx="6000000" cy="3000000"/><a:chOff x="0" y="0"/><a:chExt cx="3000000" cy="3000000"/>'
    const outer = await loadGroup(group("2", shape("6", "outer", 0, 0, "外层"), xfrm))
    expect(hitInGroup(outer, { x: 1_500_000, y: 500_000 })).toMatchObject({ parentId: "2" })
    expect(hitInGroup(outer, { x: 2_500_000, y: 500_000 })).toBeUndefined()
  })

  it("旋转组合不做像素级命中", async () => {
    const outer = await loadGroup(group("2", shape("6", "outer", 0, 0, "外层"), undefined, ' rot="60000"'))
    expect(hitInGroup(outer, { x: 500_000, y: 500_000 })).toBeUndefined()
  })
})

/** 读一个子形状 DOM 里所有 `<a:p>` 的文字，拼成一行（用于断言清空/恢复）。 */
function childText(group: GroupNodeData, childId: string): string {
  const child = group.children.find((item) => {
    const cNvPr = Array.from(item.element?.getElementsByTagName("*") ?? []).find((node) => node.localName === "cNvPr")
    return cNvPr?.getAttribute("id") === childId
  })
  const txBody = Array.from(child?.element?.getElementsByTagName("*") ?? []).find((node) => node.localName === "txBody")
  return Array.from(txBody?.children ?? [])
    .filter((node) => node.localName === "p")
    .map((p) => p.textContent ?? "")
    .join("\n")
}

describe("clearGroupChildText / restoreGroupChildText", () => {
  it("按 id 清空指定子形状的文字，其它子形状不受影响", async () => {
    const outer = await loadGroup(
      group("2", shape("4", "inner-a", 0, 0, "内层 A") + shape("5", "inner-b", 0, 1500000, "内层 B")),
    )
    const store = new Map<Element, string>()
    expect(clearGroupChildText(outer, "4", undefined, store)).toBe(true)
    expect(childText(outer, "4")).toBe("")
    expect(childText(outer, "5")).toBe("内层 B")
  })

  it("没匹配到子形状时不改任何东西", async () => {
    const outer = await loadGroup(group("2", shape("4", "inner-a", 0, 0, "内层 A")))
    const store = new Map<Element, string>()
    expect(clearGroupChildText(outer, "999", undefined, store)).toBe(false)
    expect(childText(outer, "4")).toBe("内层 A")
  })

  it("restoreGroupChildText 把清掉的文字原样写回", async () => {
    const outer = await loadGroup(
      group("2", shape("4", "inner-a", 0, 0, "内层 A") + shape("5", "inner-b", 0, 1500000, "内层 B")),
    )
    const store = new Map<Element, string>()
    clearGroupChildText(outer, "4", undefined, store)
    expect(childText(outer, "4")).toBe("")
    restoreGroupChildText(store)
    expect(childText(outer, "4")).toBe("内层 A")
    expect(childText(outer, "5")).toBe("内层 B")
  })

  it("支持嵌套组合：清空内层组里的子形状", async () => {
    const inner = group("3", shape("4", "inner-a", 0, 0, "内层 A"))
    const outer = await loadGroup(group("2", inner + shape("6", "outer", 4000000, 0, "外层")))
    const store = new Map<Element, string>()
    expect(clearGroupChildText(outer, "4", undefined, store)).toBe(true)
    expect(childText(outer, "4")).toBe("")
    expect(childText(outer, "6")).toBe("外层")
  })
})
