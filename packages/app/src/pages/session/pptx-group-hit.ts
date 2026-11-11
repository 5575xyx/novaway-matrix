import type { GroupNodeData } from "@aiden0z/pptx-renderer/browser"

/** 引擎/画布用 pt，PPTX XML 用 EMU：组合子坐标命中时先换算。 */
export const EMU_PER_POINT = 12700

/**
 * 组合内命中（支持嵌套组合）：把点换算进组合的子坐标空间，再在子 XML 上挑命中的那个。
 * 返回子 XML 节点和它的直接父组合 id —— 编辑定位只需要 cNvPr id / 名称。
 * 子形状的渲染位置由渲染器按 (off + (child - chOff) * scale) 换算，这里做同样的事。
 * 旋转/翻转的组合没有线性映射，直接返回 undefined（整组选中）。
 * point 传的是页面坐标换算后的 EMU（顶层调用时乘 EMU_PER_POINT，递归时已在 EMU 空间）。
 */
export function hitInGroup(
  group: Pick<GroupNodeData, "id" | "source" | "children">,
  point: { x: number; y: number },
): { child: GroupNodeData["children"][number]; parentId: string } | undefined {
  const childPoint = groupChildPoint(group.source, point)
  if (!childPoint) return undefined
  // 子 XML 只有原始坐标，用原始坐标做矩形命中（近似：与渲染器一致的非旋转情形）。
  for (let index = group.children.length - 1; index >= 0; index--) {
    const child = group.children[index]
    if (!child) continue
    const bounds = childXfrmBounds(child)
    if (
      !bounds ||
      childPoint.x < bounds.x ||
      childPoint.x > bounds.x + bounds.w ||
      childPoint.y < bounds.y ||
      childPoint.y > bounds.y + bounds.h
    )
      continue
    if (child.localName === "grpSp") {
      const nestedId = childIdentity(child)?.id
      const nested = nestedId
        ? hitInGroup({ id: nestedId, source: child, children: child.children() }, childPoint)
        : undefined
      // 嵌套组里没命中具体形状时，就选这个嵌套组本身。
      if (nested) return nested
    }
    return { child, parentId: group.id }
  }
  return undefined
}

/** 把一个 EMU 点映射进组合的子坐标空间；旋转/翻转/退化尺寸的组合无法线性映射。 */
function groupChildPoint(source: GroupNodeData["source"], point: { x: number; y: number }) {
  const xfrm = source.child("grpSpPr").child("xfrm")
  if (!xfrm.exists()) return undefined
  if ((xfrm.element?.getAttribute("rot") ?? "0") !== "0") return undefined
  if (xfrm.element?.getAttribute("flipH") || xfrm.element?.getAttribute("flipV")) return undefined
  const off = xfrm.child("off")
  const ext = xfrm.child("ext")
  const chOff = xfrm.child("chOff")
  const chExt = xfrm.child("chExt")
  if (!off.exists() || !ext.exists()) return undefined
  const cx = ext.numAttr("cx") ?? 0
  const cy = ext.numAttr("cy") ?? 0
  const chExtCx = chExt.numAttr("cx") ?? cx
  const chExtCy = chExt.numAttr("cy") ?? cy
  if (chExtCx <= 0 || chExtCy <= 0 || cx <= 0 || cy <= 0) return undefined
  const scaleX = cx / chExtCx
  const scaleY = cy / chExtCy
  return {
    x: (chOff.numAttr("x") ?? 0) + (point.x - (off.numAttr("x") ?? 0)) / scaleX,
    y: (chOff.numAttr("y") ?? 0) + (point.y - (off.numAttr("y") ?? 0)) / scaleY,
  }
}

/** 组合子节点的 cNvPr id / 名称：它们挂在子元素内部的 cNvPr 上，不在子元素本身。 */
export function childIdentity(child: GroupNodeData["children"][number]) {
  const element = child.element
  if (!element) return undefined
  const cNvPr = Array.from(element.getElementsByTagName("*")).find((node) => node.localName === "cNvPr")
  return { id: cNvPr?.getAttribute("id") ?? undefined, name: cNvPr?.getAttribute("name") ?? undefined }
}

/**
 * 清空组合内指定子形状的文字（就地编辑时不叠字）。
 *
 * 渲染器对组合子形状的文字是「懒解析的原始 XML」：每次渲染都从 `SafeXmlNode.element`
 * 的 DOM 现读 `<a:txBody>` 里的 `<a:p>`，没有持久化的 textBody 对象可改。
 * 所以这里直接操作 DOM：把命中的子形状的 `<a:p>` 段落逐个移除（保留 bodyPr/lstStyle）。
 *
 * 为支持「取消编辑后恢复原文」，首次清空某段 txBody 时把它的原始 innerHTML 存进
 * `store`（Map<txBody, innerHTML>）；`restoreGroupChildText(store)` 会原样写回。
 *
 * 支持嵌套组合：递归进入子组的 `grpSp` 继续找。返回是否真的清掉了某段文字。
 */
export function clearGroupChildText(
  group: Pick<GroupNodeData, "children">,
  shapeId: string | undefined,
  shapeName: string | undefined,
  store: Map<Element, string>,
): boolean {
  let cleared = false
  const walk = (children: GroupNodeData["children"]) => {
    for (const child of children) {
      if (child.localName === "grpSp") {
        walk(child.children())
        continue
      }
      const identity = childIdentity(child)
      const matched = shapeId ? identity?.id === shapeId : !!shapeName && identity?.name === shapeName
      if (matched && clearChildText(child, store)) cleared = true
    }
  }
  walk(group.children)
  return cleared
}

/** 移除一个子形状 `<a:txBody>` 下所有 `<a:p>`，首次清空时把原内容记进 store。 */
function clearChildText(child: GroupNodeData["children"][number], store: Map<Element, string>): boolean {
  const txBody = childTxBody(child)
  if (!txBody) return false
  const paragraphs = Array.from(txBody.children).filter((node) => node.localName === "p")
  if (paragraphs.length === 0) return false
  if (!store.has(txBody)) store.set(txBody, txBody.innerHTML)
  for (const paragraph of paragraphs) paragraph.remove()
  return true
}

/** 取子形状的 `<a:txBody>`（可能嵌套在其它元素里，用 localName 匹配）。 */
function childTxBody(child: GroupNodeData["children"][number]): Element | undefined {
  const element = child.element
  if (!element) return undefined
  return Array.from(element.getElementsByTagName("*")).find((node) => node.localName === "txBody")
}

/** 取消编辑（未保存）时，把之前清空的文字原样写回，恢复原文渲染。 */
export function restoreGroupChildText(store: Map<Element, string>): void {
  for (const [txBody, innerHTML] of store) txBody.innerHTML = innerHTML
  store.clear()
}

/** 子 XML 节点的原始 xfrm 边界；没有 xfrm 的子节点（极少）忽略。 */
function childXfrmBounds(child: GroupNodeData["children"][number]) {
  const spPr = child.child("spPr").exists() ? child.child("spPr") : child.child("grpSpPr")
  const xfrm = spPr.child("xfrm")
  if (!xfrm.exists()) return undefined
  const off = xfrm.child("off")
  const ext = xfrm.child("ext")
  if (!off.exists() || !ext.exists()) return undefined
  return {
    x: off.numAttr("x") ?? 0,
    y: off.numAttr("y") ?? 0,
    w: ext.numAttr("cx") ?? 0,
    h: ext.numAttr("cy") ?? 0,
  }
}
