/**
 * PPTX 原地编辑：文本、格式、几何、图片替换。
 *
 * 目标不是"重新生成一份 PPT"，而是「改一个字就只改那个 shape」：
 * 只重写 `ppt/slides/slideN.xml`（图片替换时再加一条媒体条目），其余条目
 * （字体、母版、其它页、动画）在 zip 里是**原样字节拷贝**，连压缩流都不重新压 ——
 * 打开后版式、动画、编号、关系全是原来的，渲染器不认识的形状也不会被抹掉。
 *
 * 为什么不用渲染器的 serializePresentation：它输出的是 JSON 模型快照，
 * 回不到 OOXML，也不包含它没解析的扩展（SmartArt 的 diagram 数据、3D、墨迹…）。
 * 所以这里直接在原始 XML 文本上做外科手术。
 *
 * 关于「重算换行」：PowerPoint / WPS / Keynote 都是**打开时排版**，换行不落盘。
 * 改完文本由它们自己重排；我们只需要清掉 `<a:normAutofit fontScale>` 上残留的
 * 缩放比例，否则旧比例会压在新文本上。
 */

export type PptxBox = { x: number; y: number; w: number; h: number }

/** 段落对齐：左/居中/右/两端对齐，和 OOXML 的 `a:pPr@algn` 一致。 */
export type PptxAlign = "l" | "ctr" | "r" | "just"

/** 段落格式。字段省略 = 不动这一项。 */
export type PptxTextStyle = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** 字号，单位 pt（写进 XML 时 ×100） */
  size?: number
  /** 颜色，`RRGGBB` */
  color?: string
  align?: PptxAlign
  /** 字体名，例如「微软雅黑」 */
  font?: string
}

export type PptxTextEdit = {
  /** 1-based */
  slide: number
  /** `<p:cNvPr @id>`，最精确的定位方式 */
  shapeId?: string
  /** `<p:cNvPr @name>`，例如「标题 1」；和 shapeId 二选一 */
  shapeName?: string
  /** 段落序号，从 0 开始；省略时改第 0 段 */
  paragraph?: number
  /** 新文本；省略表示只改样式 */
  text?: string
  /** 段落格式 */
  style?: PptxTextStyle
  /** 表格单元格（行列均从 0 开始）；给了就改这个单元格里的段落 */
  cell?: { row: number; col: number }
}

/** 形状几何：位置/尺寸（EMU）和旋转角度（度）。 */
export type PptxShapeEdit = {
  slide: number
  shapeId?: string
  shapeName?: string
  box?: PptxBox
  /** 顺时针角度，单位度 */
  rotation?: number
}

/** 图片替换：把某个 `<p:pic>` 的 blip 指向新图片，旧图仍留在包里。 */
export type PptxImageEdit = {
  slide: number
  shapeId?: string
  shapeName?: string
  data: Uint8Array
  /** image/png、image/jpeg、image/gif、image/svg+xml、image/webp */
  mime: string
}

/** 能直接插入的预设形状（PPT 的 prstGeom 名字）。 */
export type PptxShapeKind = "rect" | "roundRect" | "ellipse" | "triangle" | "diamond" | "rightArrow" | "line" | "star5"

export type PptxShapeOp =
  | { op: "addTextBox"; slide: number; box?: PptxBox; text: string; style?: PptxTextStyle }
  /** 插入一个预设形状（矩形 / 圆 / 箭头 / 线条…），可带文字、填充色和描边色。 */
  | {
      op: "addShape"
      slide: number
      kind: PptxShapeKind
      box?: PptxBox
      /** 填充色 RRGGBB；省略 = 主题色。 */
      fill?: string
      /** 描边色 RRGGBB；省略 = 无描边。 */
      line?: string
      /** 形状里的文字（可选）。 */
      text?: string
      style?: PptxTextStyle
    }
  /** 往某一页插一张图片；媒体条目和关系会一并补进包里。 */
  | { op: "addPicture"; slide: number; box?: PptxBox; data: Uint8Array; mime: string }
  | { op: "deleteShape"; slide: number; shapeId?: string; shapeName?: string }
  /** 改形状在 PowerPoint 里的名字（`cNvPr@name`）；按 id 或旧名字定位。 */
  | { op: "renameShape"; slide: number; shapeId?: string; shapeName?: string; name: string }

export type PptxEditInput = {
  bytes: Uint8Array
  textEdits?: readonly PptxTextEdit[]
  shapeEdits?: readonly PptxShapeEdit[]
  imageEdits?: readonly PptxImageEdit[]
  /** 结构操作：新增文本框、删除形状。 */
  shapeOps?: readonly PptxShapeOp[]
}

export type PptxTextEditApplied = {
  slide: number
  shapeId: string
  shapeName?: string
  paragraph: number
  previous: string
  text: string
  cell?: { row: number; col: number }
  style?: PptxTextStyle
}

export type PptxShapeEditApplied = {
  slide: number
  shapeId: string
  shapeName?: string
  previous?: PptxBox
  box?: PptxBox
  previousRotation?: number
  rotation?: number
}

export type PptxImageEditApplied = {
  slide: number
  shapeId: string
  shapeName?: string
  mediaPath: string
  previousRId?: string
  rId: string
}

export type PptxEditResult = {
  bytes: Uint8Array
  textApplied: PptxTextEditApplied[]
  shapeApplied: PptxShapeEditApplied[]
  imageApplied: PptxImageEditApplied[]
  /** 真正被重写的 zip 条目（正常情况下只有 ppt/slides/slideN.xml） */
  changed: string[]
}

export type PptxNodeKind = "shape" | "picture" | "table" | "group"

/** 一页上的一个可编辑对象。表格额外给出单元格。 */
export type PptxLayoutNode = {
  slide: number
  shapeId: string
  shapeName?: string
  kind: PptxNodeKind
  paragraphs: string[]
  /** 与 paragraphs 一一对应的格式 */
  styles: PptxTextStyle[]
  /** 表格单元格（仅 kind === "table"），box 是它在页面上的位置 */
  cells?: Array<{ row: number; col: number; paragraphs: string[]; styles: PptxTextStyle[]; box?: PptxBox }>
  box?: PptxBox
  /** 旋转角度（度） */
  rotation?: number
  /** 图片（仅 kind === "picture"）：当前引用的媒体与关系 id */
  image?: { rId: string; target: string }
  /** 在组合里时：所属组合的 shapeId（编辑时上层用它判断能不能整体拖动） */
  parentId?: string
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

export async function editPptx(input: PptxEditInput): Promise<PptxEditResult> {
  const textEdits = input.textEdits ?? []
  const shapeEdits = input.shapeEdits ?? []
  const imageEdits = input.imageEdits ?? []
  const shapeOps = input.shapeOps ?? []
  if (textEdits.length === 0 && shapeEdits.length === 0 && imageEdits.length === 0 && shapeOps.length === 0) {
    return { bytes: input.bytes, textApplied: [], shapeApplied: [], imageApplied: [], changed: [] }
  }

  const zip = await readZip(input.bytes)
  const additions = new Map<string, Uint8Array>()
  const textApplied: PptxTextEditApplied[] = []
  const shapeApplied: PptxShapeEditApplied[] = []
  const imageApplied: PptxImageEditApplied[] = []

  // 按目标 slide 分桶：每页的 XML 只解压/改一遍。
  const slides = new Map<
    number,
    { text: PptxTextEdit[]; shapes: PptxShapeEdit[]; images: PptxImageEdit[]; structure: PptxShapeOp[] }
  >()
  const bucket = (slide: number) => {
    const current = slides.get(slide) ?? { text: [], shapes: [], images: [], structure: [] }
    slides.set(slide, current)
    return current
  }
  for (const edit of textEdits) bucket(edit.slide).text.push(edit)
  for (const edit of shapeEdits) bucket(edit.slide).shapes.push(edit)
  for (const edit of imageEdits) bucket(edit.slide).images.push(edit)
  for (const edit of shapeOps) bucket(edit.slide).structure.push(edit)

  const replacements = new Map<string, Uint8Array>()
  const parts = await slideParts(zip)
  for (const [slide, edits] of slides) {
    const name = await slideEntryName(zip, slide, parts)
    const entry = zip.entries.find((item) => item.name === name)
    if (!entry) throw new Error("PPTX 里没有第 " + slide + " 页（" + name + "）")
    const xml = new TextDecoder().decode(await entryData(zip.bytes, entry))
    let next = xml

    if (edits.text.length > 0) {
      const outcome = applyTextEdits(next, edits.text)
      next = outcome.xml
      textApplied.push(...outcome.applied)
    }
    if (edits.shapes.length > 0) {
      const outcome = applyShapeEdits(next, edits.shapes)
      next = outcome.xml
      shapeApplied.push(...outcome.applied)
    }
    if (edits.structure.length > 0) {
      next = applyShapeOps(next, edits.structure)
    }
    if (edits.images.length > 0) {
      const relsKey = relsNameOf(name)
      const replacedRels = replacements.get(relsKey)
      const outcome = await applyImageEdits({
        xml: next,
        slide,
        part: name,
        edits: edits.images,
        zip,
        additions,
        ...(replacedRels ? { relsText: new TextDecoder().decode(replacedRels) } : {}),
      })
      next = outcome.xml
      imageApplied.push(...outcome.applied)
      if (outcome.rels !== undefined) replacements.set(relsKey, outcome.rels)
    }
    // 新增图片要走「媒体条目 + 关系 + <p:pic>」三件事，单独一步做。
    const pictureOps = edits.structure.filter(
      (item): item is Extract<PptxShapeOp, { op: "addPicture" }> => item.op === "addPicture",
    )
    if (pictureOps.length > 0) {
      const relsKey = relsNameOf(name)
      const replacedRels = replacements.get(relsKey)
      const outcome = await applyAddPictures({
        xml: next,
        part: name,
        ops: pictureOps,
        zip,
        additions,
        ...(replacedRels ? { relsText: new TextDecoder().decode(replacedRels) } : {}),
      })
      next = outcome.xml
      imageApplied.push(...outcome.applied)
      if (outcome.rels !== undefined) replacements.set(relsKey, outcome.rels)
    }
    if (next !== xml) replacements.set(name, new TextEncoder().encode(next))
  }

  const contentTypes = await ensureContentTypes(zip, additions, replacements)
  const changed = [...new Set([...replacements.keys(), ...contentTypes])]

  if (changed.length === 0) {
    throw new Error("没有找到要修改的内容：请先读取页面，确认形状 id 或名称")
  }
  return {
    bytes: rebuildZip(zip, replacements, additions),
    textApplied,
    shapeApplied,
    imageApplied,
    changed,
  }
}

/** 页面级操作：删页、拖页、复制页、新建页。只动 presentation.xml（和它的 rels）与新建的页面部件。 */
export type PptxSlideOp =
  | { op: "deleteSlide"; slide: number }
  | { op: "moveSlide"; from: number; to: number }
  | { op: "duplicateSlide"; slide: number }
  /** 新建一页空白页，插在第 after 页之后（0 = 最前面，省略 = 最后）。 */
  | { op: "addSlide"; after?: number; layout?: string }

export type PptxSlideOpResult = {
  bytes: Uint8Array
  applied: PptxSlideOp[]
  changed: string[]
}

/**
 * 删页 / 调顺序 / 复制页。
 *
 * 演示顺序只由 `presentation.xml` 的 `<p:sldIdLst>` 决定，所以：
 *   - 删除 = 摘掉对应的 `<p:sldId>` 和它的关系条目；页面部件留在包里
 *     （PowerPoint 不理会未被引用的部件），这样撤销/重做只是把关系加回来；
 *   - 调顺序 = 重新排列 `<p:sldId>`，一个字节的页面内容都不用碰；
 *   - 复制页 = 克隆页面部件和它的 rels（媒体/版式关系原样共享），再挂一条新关系
 *     和 sldId。克隆页紧跟在原页后面，接着改字就是「加一页」。
 *
 * 至少保留一页：PowerPoint 打开「零页」的演示会直接报错。
 */
export async function editPptxSlides(bytes: Uint8Array, ops: readonly PptxSlideOp[]): Promise<PptxSlideOpResult> {
  if (ops.length === 0) return { bytes, applied: [], changed: [] }

  const zip = await readZip(bytes)
  const presentationEntry = zip.entries.find((item) => item.name === "ppt/presentation.xml")
  if (!presentationEntry) throw new Error("这个 PPTX 没有 ppt/presentation.xml")
  const relsEntry = zip.entries.find((item) => item.name === "ppt/_rels/presentation.xml.rels")
  if (!relsEntry) throw new Error("这个 PPTX 没有 ppt/_rels/presentation.xml.rels")

  let presentation = new TextDecoder().decode(await entryData(zip.bytes, presentationEntry))
  let rels = new TextDecoder().decode(await entryData(zip.bytes, relsEntry))
  const applied: PptxSlideOp[] = []
  /** 复制页新增的部件（原 zip 里没有，最后作为 additions 追加）。 */
  const additions = new Map<string, Uint8Array>()
  /** 被重写的条目；复制页时这里也会有 [Content_Types].xml。 */
  const replacements = new Map<string, Uint8Array>()

  /** 当前顺序：rId → 部件名（每次操作后重新算，索引始终跟着最新状态）。 */
  const readOrder = () => {
    const list = /<p:sldIdLst\b[^>]*>([\s\S]*?)<\/p:sldIdLst>/.exec(presentation)?.[1] ?? ""
    const targets = new Map<string, string>()
    for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]*)"/.exec(match[0])?.[1]
      const target = /\bTarget="([^"]*)"/.exec(match[0])?.[1]
      if (id && target) targets.set(id, partNameOf(target))
    }
    // 整条标签都要留下（重排时直接拼回去），r:id 从标签里再取一次。
    const idOf = (tag: string) => /\br:id="([^"]*)"/.exec(tag)?.[1] ?? ""
    return [...list.matchAll(/<p:sldId\b[^>]*\/>/g)].map((match) => {
      const rId = idOf(match[0])
      return { rId, tag: match[0], part: targets.get(rId) ?? "" }
    })
  }

  for (const op of ops) {
    const order = readOrder()
    if (order.length === 0) throw new Error("这个 PPTX 的 presentation.xml 没有页面清单")

    if (op.op === "deleteSlide") {
      if (!Number.isInteger(op.slide) || op.slide < 1 || op.slide > order.length) {
        throw new Error("页码超出范围：第 " + op.slide + " 页（共 " + order.length + " 页）")
      }
      if (order.length <= 1) throw new Error("演示至少要保留一页")
      const target = order[op.slide - 1]!
      const id = target.rId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      presentation = presentation.replace(new RegExp('<p:sldId\\b[^>]*\\br:id="' + id + '"[^>]*/>'), "")
      rels = rels.replace(new RegExp('<Relationship\\b[^>]*\\bId="' + id + '"[^>]*/>'), "")
      applied.push(op)
      continue
    }

    if (op.op === "duplicateSlide") {
      if (!Number.isInteger(op.slide) || op.slide < 1 || op.slide > order.length) {
        throw new Error("页码超出范围：第 " + op.slide + " 页（共 " + order.length + " 页）")
      }
      const source = order[op.slide - 1]!
      // 同一批里连着复制两次：第二次的来源可能是刚克隆出来的部件（还在 additions 里）。
      const sourceData =
        additions.get(source.part) ??
        (await (async () => {
          const entry = zip.entries.find((item) => item.name === source.part)
          return entry ? entryData(zip.bytes, entry) : undefined
        })())
      if (!sourceData) throw new Error("找不到第 " + op.slide + " 页的部件：" + source.part)

      // 找一个没被占用的 slideN.xml 名字。
      let nextIndex = 1
      for (const name of [...zip.entries.map((item) => item.name), ...additions.keys()]) {
        const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name)
        if (match) nextIndex = Math.max(nextIndex, Number(match[1]) + 1)
      }
      const clonePart = "ppt/slides/slide" + nextIndex + ".xml"
      additions.set(clonePart, sourceData)
      // 页面 rels 原样复制：媒体和版式关系是相对目标，克隆页可以直接共用。
      const cloneRels = relsNameOf(clonePart)
      const sourceRelsName = relsNameOf(source.part)
      const sourceRelsData =
        additions.get(sourceRelsName) ??
        (await (async () => {
          const entry = zip.entries.find((item) => item.name === sourceRelsName)
          return entry ? entryData(zip.bytes, entry) : undefined
        })())
      if (sourceRelsData) additions.set(cloneRels, sourceRelsData)

      // 关系表和 sldId 都要新 id：取现有最大值 +1，避免和别的部件撞号。
      const relationshipIds = [...rels.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1]))
      const newRId = "rId" + (Math.max(0, ...relationshipIds) + 1)
      const relationship =
        '<Relationship Id="' +
        newRId +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' +
        nextIndex +
        '.xml"/>'
      rels = rels.replace("</Relationships>", relationship + "</Relationships>")

      const slideIds = [...presentation.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1]))
      const slideId = '<p:sldId id="' + (Math.max(255, ...slideIds) + 1) + '" r:id="' + newRId + '"/>'
      // 紧跟在原页后面：复制出来的这一页就在当前页旁边。
      const at = presentation.indexOf(source.tag)
      if (at === -1) throw new Error("presentation.xml 里找不到第 " + op.slide + " 页的 sldId")
      presentation =
        presentation.slice(0, at + source.tag.length) + slideId + presentation.slice(at + source.tag.length)

      // slides 在 [Content_Types].xml 里是 Override（不是 Default），新部件要自己声明。
      const typesName = "[Content_Types].xml"
      const typesEntry = zip.entries.find((item) => item.name === typesName)
      const typesCurrent = replacements.get(typesName)
      if (typesEntry || typesCurrent) {
        const types = new TextDecoder().decode(typesCurrent ?? (await entryData(zip.bytes, typesEntry!)))
        const override =
          '<Override PartName="/' +
          clonePart +
          '" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        // 标准包是 `<Types …>…</Types>`；万一遇到自闭合的简写，也补成成对标签。
        const nextTypes = /<\/Types>/.test(types)
          ? types.replace("</Types>", override + "</Types>")
          : types.replace(/<Types\b([^>]*)\/>/, "<Types$1>" + override + "</Types>")
        replacements.set(typesName, new TextEncoder().encode(nextTypes))
      }

      applied.push(op)
      continue
    }

    if (op.op === "addSlide") {
      const after = op.after ?? order.length
      if (!Number.isInteger(after) || after < 0 || after > order.length) {
        throw new Error("插入位置超出范围：0 到 " + order.length)
      }
      // 新页的名字：不占用已有编号。
      let nextIndex = 1
      for (const name of [...zip.entries.map((item) => item.name), ...additions.keys()]) {
        const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name)
        if (match) nextIndex = Math.max(nextIndex, Number(match[1]) + 1)
      }
      const part = "ppt/slides/slide" + nextIndex + ".xml"
      // 指定了版式就按名字/序号找；没指定沿用相邻页的（新页和它长得像）。
      const chosen = op.layout ? await resolveLayout(zip, op.layout) : undefined
      const layout = chosen
        ? "../slideLayouts/" + chosen.part
        : await slideLayoutTarget(zip, additions, order[Math.max(0, after - 1)]?.part)
      const placeholder = chosen ? await layoutPlaceholderShapes(zip, chosen.part) : ""
      const slideXml = placeholder
        ? blankSlideXml().replace("</p:spTree>", placeholder + "</p:spTree>")
        : blankSlideXml()
      additions.set(part, new TextEncoder().encode(slideXml))
      additions.set(
        relsNameOf(part),
        new TextEncoder().encode(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="' +
            layout +
            '"/></Relationships>',
        ),
      )

      const relationshipIds = [...rels.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1]))
      const newRId = "rId" + (Math.max(0, ...relationshipIds) + 1)
      rels = rels.replace(
        "</Relationships>",
        '<Relationship Id="' +
          newRId +
          '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' +
          nextIndex +
          '.xml"/></Relationships>',
      )
      const slideIds = [...presentation.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1]))
      const slideId = '<p:sldId id="' + (Math.max(255, ...slideIds) + 1) + '" r:id="' + newRId + '"/>'
      const anchor = after === 0 ? undefined : order[after - 1]
      if (anchor) {
        const at = presentation.indexOf(anchor.tag)
        if (at === -1) throw new Error("presentation.xml 里找不到第 " + after + " 页的 sldId")
        presentation =
          presentation.slice(0, at + anchor.tag.length) + slideId + presentation.slice(at + anchor.tag.length)
      } else if (after === 0) {
        // 插到最前面：紧跟在 <p:sldIdLst> 的开标签后面。
        presentation = presentation.replace(/(<p:sldIdLst\b[^>]*>)/, "$1" + slideId)
      } else {
        presentation = presentation.replace("</p:sldIdLst>", slideId + "</p:sldIdLst>")
      }
      await ensureSlideContentType(zip, additions, replacements, part)
      applied.push(op)
      continue
    }

    if (!Number.isInteger(op.from) || !Number.isInteger(op.to)) {
      throw new Error("页面序号必须是整数")
    }
    if (op.from < 1 || op.from > order.length || op.to < 1 || op.to > order.length) {
      throw new Error("页码超出范围：从第 " + op.from + " 页到第 " + op.to + " 页（共 " + order.length + " 页）")
    }
    if (op.from === op.to) {
      applied.push(op)
      continue
    }
    const tags = order.map((entry) => entry.tag)
    const [moved] = tags.splice(op.from - 1, 1)
    tags.splice(op.to - 1, 0, moved!)
    presentation = presentation.replace(
      /(<p:sldIdLst\b[^>]*>)([\s\S]*?)(<\/p:sldIdLst>)/,
      (_all, open: string, _body: string, close: string) => open + tags.join("") + close,
    )
    applied.push(op)
  }

  replacements.set("ppt/presentation.xml", new TextEncoder().encode(presentation))
  replacements.set("ppt/_rels/presentation.xml.rels", new TextEncoder().encode(rels))
  return {
    bytes: rebuildZip(zip, replacements, additions),
    applied,
    changed: [...new Set([...replacements.keys(), ...additions.keys()])],
  }
}

/** 列出每一页的可编辑对象：形状文字/格式、表格单元格、图片、几何。 */
export async function readPptxLayout(bytes: Uint8Array, slides?: readonly number[]): Promise<PptxLayoutNode[]> {
  const zip = await readZip(bytes)
  const wanted = slides ? new Set(slides) : undefined
  const result: PptxLayoutNode[] = []
  const parts = await slideParts(zip)
  for (const [position, part] of parts.entries()) {
    // 对外编号按演示顺序（1 起），不是文件名里的数字。
    const slide = position + 1
    if (wanted && !wanted.has(slide)) continue
    const entry = zip.entries.find((item) => item.name === part)
    if (!entry) continue
    const xml = new TextDecoder().decode(await entryData(zip.bytes, entry))
    const rels = await readSlideRels(zip, part)
    for (const block of scanBlocks(xml)) {
      const paragraphs = block.paragraphs.map((paragraph) => paragraph.text)
      const styles = block.paragraphs.map((paragraph) => paragraphStyle(xml, paragraph))
      const cells = block.cells?.map((cell) => ({
        row: cell.row,
        col: cell.col,
        paragraphs: cell.paragraphs.map((paragraph) => paragraph.text),
        styles: cell.paragraphs.map((paragraph) => paragraphStyle(xml, paragraph)),
        ...(cell.box ? { box: cell.box } : {}),
      }))
      const hasText =
        paragraphs.some((text) => text.trim()) ||
        (cells?.some((cell) => cell.paragraphs.some((text) => text.trim())) ?? false)
      if (!hasText && !block.blip) continue
      result.push({
        slide,
        shapeId: block.id,
        shapeName: block.name,
        kind: blockKind(block.tag),
        paragraphs,
        styles,
        ...(cells && cells.length > 0 ? { cells } : {}),
        box: block.box,
        rotation: block.rotation,
        ...(block.blip ? { image: { rId: block.blip.rId, target: rels.get(block.blip.rId) ?? "" } } : {}),
        ...(block.parentId ? { parentId: block.parentId } : {}),
      })
    }
  }
  return result.sort((a, b) => a.slide - b.slide)
}

/**
 * 页面尺寸（EMU）+ 可编辑对象。页面尺寸来自 `ppt/presentation.xml` 的
 * `<p:sldSz cx cy>`；缺省按 16:9 的 12192000×6858000 兜底。
 * 上层要把 EMU 换成 pt 再交给 UI —— 见 office/engine/units.ts。
 */
export type PptxLayoutInfo = {
  /** 1-based 序号（按 slideLayoutN.xml 排序）。 */
  index: number
  /** `<p:cSld name="…">` 里的名字；没有就用序号兜底。 */
  name: string
  /** 相对 slideLayouts 目录的部件名，例如 slideLayout2.xml。 */
  part: string
}

/** 列出这个 PPTX 里可选的版式（新建页时用）。 */
export async function listPptxLayouts(bytes: Uint8Array): Promise<PptxLayoutInfo[]> {
  const zip = await readZip(bytes)
  return readLayouts(zip)
}

async function readLayouts(zip: ZipArchive): Promise<PptxLayoutInfo[]> {
  const entries = zip.entries
    .filter((item) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(item.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const layouts: PptxLayoutInfo[] = []
  for (const [index, entry] of entries.entries()) {
    const xml = new TextDecoder().decode(await entryData(zip.bytes, entry))
    const name = /<p:cSld\b[^>]*\bname="([^"]*)"/.exec(xml)?.[1]
    layouts.push({
      index: index + 1,
      name: name?.trim() || "版式 " + (index + 1),
      part: entry.name.slice("ppt/slideLayouts/".length),
    })
  }
  return layouts
}

export async function readPptxDocument(bytes: Uint8Array): Promise<{
  size: { w: number; h: number }
  nodes: PptxLayoutNode[]
  slideCount: number
  layouts: PptxLayoutInfo[]
  slides: PptxSlideMeta[]
}> {
  const zip = await readZip(bytes)
  const entry = zip.entries.find((item) => item.name === "ppt/presentation.xml")
  let size = { w: 12192000, h: 6858000 }
  if (entry) {
    const xml = new TextDecoder().decode(await entryData(zip.bytes, entry))
    const match = /<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(xml)
    if (match) size = { w: Number(match[1]), h: Number(match[2]) }
  }
  const slideCount = (await slideParts(zip)).length
  return {
    size,
    nodes: await readPptxLayout(bytes),
    slideCount,
    layouts: await readLayouts(zip),
    slides: await readSlideMetaFromZip(zip),
  }
}

// ---------------------------------------------------------------------------
// 页级元数据：备注、隐藏页
// ---------------------------------------------------------------------------

/** 一页的「非内容」属性：放映时是否隐藏、备注页文字。 */
export type PptxSlideMeta = {
  /** 1 起，按演示顺序。 */
  index: number
  /** `<p:sld show="0">`：放映时跳过这一页，但仍可编辑。 */
  hidden: boolean
  /** 备注页正文（notesSlide 里 body 占位符的文字）。 */
  notes?: string
  /** 这一页套用的版式名（读不到时为 undefined）。 */
  layout?: string
}

const NOTES_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"
const NOTES_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"

export async function readSlideMeta(bytes: Uint8Array): Promise<PptxSlideMeta[]> {
  return readSlideMetaFromZip(await readZip(bytes))
}

async function readSlideMetaFromZip(zip: ZipArchive): Promise<PptxSlideMeta[]> {
  const parts = await slideParts(zip)
  const out: PptxSlideMeta[] = []
  for (const [offset, part] of parts.entries()) {
    const entry = zip.entries.find((item) => item.name === part)
    if (!entry) {
      out.push({ index: offset + 1, hidden: false })
      continue
    }
    const xml = new TextDecoder().decode(await entryData(zip.bytes, entry))
    const notesPart = await notesPartOf(zip, part)
    const notes = notesPart ? await notesTextOf(zip, notesPart) : undefined
    const layout = await layoutNameOf(zip, part)
    out.push({
      index: offset + 1,
      hidden: /<p:sld\b[^>]*\bshow="0"/.test(xml),
      ...(notes ? { notes } : {}),
      ...(layout ? { layout } : {}),
    })
  }
  return out
}

/** 找一页的备注页部件：slide 的 rels 里 Type 以 /notesSlide 结尾的那条。 */
async function notesPartOf(zip: ZipArchive, slidePart: string): Promise<string | undefined> {
  const relsEntry = zip.entries.find((item) => item.name === relsNameOf(slidePart))
  if (!relsEntry) return undefined
  const rels = new TextDecoder().decode(await entryData(zip.bytes, relsEntry))
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (!match[0].includes(NOTES_REL_TYPE)) continue
    const target = /\bTarget="([^"]*)"/.exec(match[0])?.[1]
    if (!target) continue
    // 备注页的相对目标以 ppt/slides 为基准，例如 ../notesSlides/notesSlide1.xml。
    return normalizePart("ppt/slides", target)
  }
  return undefined
}

/** 找一页套用的版式部件：slide rels 里 Type 以 /slideLayout 结尾的那条。 */
async function layoutPartOf(zip: ZipArchive, slidePart: string): Promise<string | undefined> {
  const relsEntry = zip.entries.find((item) => item.name === relsNameOf(slidePart))
  if (!relsEntry) return undefined
  const rels = new TextDecoder().decode(await entryData(zip.bytes, relsEntry))
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (!/\/slideLayout$/.test(/\bType="([^"]*)"/.exec(match[0])?.[1] ?? "")) continue
    const target = /\bTarget="([^"]*)"/.exec(match[0])?.[1]
    if (target) return normalizePart("ppt/slides", target)
  }
  return undefined
}

/** 版式显示名（`<p:cSld name="…">`）；读不到就用部件名。 */
async function layoutNameOf(zip: ZipArchive, slidePart: string): Promise<string | undefined> {
  const part = await layoutPartOf(zip, slidePart)
  if (!part) return undefined
  const entry = zip.entries.find((item) => item.name === part)
  if (!entry) return part.slice(part.lastIndexOf("/") + 1)
  const xml = new TextDecoder().decode(await entryData(zip.bytes, entry))
  return /<p:cSld\b[^>]*\bname="([^"]*)"/.exec(xml)?.[1]?.trim() || part.slice(part.lastIndexOf("/") + 1)
}

/** 解析相对部件路径（`ppt/slides` + `../notesSlides/notesSlide1.xml`）。 */
function normalizePart(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1)
  const stack = baseDir.split("/").filter(Boolean)
  for (const piece of target.split("/")) {
    if (piece === "" || piece === ".") continue
    if (piece === "..") stack.pop()
    else stack.push(piece)
  }
  return stack.join("/")
}

async function notesTextOf(zip: ZipArchive, part: string): Promise<string | undefined> {
  const entry = zip.entries.find((item) => item.name === part)
  if (!entry) return undefined
  const xml = new TextDecoder().decode(await entryData(zip.bytes, entry))
  // 只要备注正文占位符：页码、页眉页脚占位符不算备注。
  const body = scanBlocks(xml).find((block) => /<p:ph\b[^>]*\btype="body"/.test(block.body))
  if (!body) return undefined
  return (
    body.paragraphs
      .map((paragraph) => paragraph.text)
      .join(CHAR_LINE)
      .trim() || undefined
  )
}

const CHAR_LINE = String.fromCharCode(10)

export type PptxMetaOp =
  | { op: "setSlideNotes"; slide: number; text: string }
  | { op: "setSlideHidden"; slide: number; hidden: boolean }
  /** 换版式：layout 可以是显示名、slideLayoutN.xml 或 1 起的序号。 */
  | { op: "setSlideLayout"; slide: number; layout: string }

/**
 * 备注 / 隐藏页：只改 slide 部件、slide 的 rels、备注页部件。
 *
 * 备注页不存在时新建一个最小可用的 notesSlide（含正文占位符 + 回指 slide 的关系），
 * 并把 Override 补进 [Content_Types].xml —— 漏掉它 PowerPoint 会说文件损坏。
 */
export async function editPptxMeta(
  bytes: Uint8Array,
  ops: readonly PptxMetaOp[],
): Promise<{ bytes: Uint8Array; applied: PptxMetaOp[]; changed: string[] }> {
  if (ops.length === 0) return { bytes, applied: [], changed: [] }
  const zip = await readZip(bytes)
  const parts = await slideParts(zip)
  const replacements = new Map<string, Uint8Array>()
  const additions = new Map<string, Uint8Array>()
  const applied: PptxMetaOp[] = []

  for (const op of ops) {
    const part = parts[op.slide - 1]
    if (!part) throw new Error("PPTX 里没有第 " + op.slide + " 页（共 " + parts.length + " 页）")
    const entry = zip.entries.find((item) => item.name === part)
    if (!entry) throw new Error("找不到第 " + op.slide + " 页的部件：" + part)
    const current = replacements.get(part)
    const xml = current
      ? new TextDecoder().decode(current)
      : new TextDecoder().decode(await entryData(zip.bytes, entry))

    if (op.op === "setSlideHidden") {
      const next = setSlideHidden(xml, op.hidden)
      if (next !== xml) replacements.set(part, new TextEncoder().encode(next))
      applied.push(op)
      continue
    }

    if (op.op === "setSlideLayout") {
      const layouts = await readLayouts(zip)
      const wanted = op.layout.trim()
      const chosen =
        layouts.find((layout) => layout.part === wanted) ??
        layouts.find((layout) => layout.name === wanted) ??
        (/^\d+$/.test(wanted) ? layouts[Number(wanted) - 1] : undefined)
      if (!chosen) {
        throw new Error("找不到版式 " + wanted + "（可选：" + layouts.map((layout) => layout.name).join(" / ") + "）")
      }
      const relsKey = relsNameOf(part)
      const replacedRels = replacements.get(relsKey)
      const relsEntry = zip.entries.find((item) => item.name === relsKey)
      const relsXml = replacedRels
        ? new TextDecoder().decode(replacedRels)
        : relsEntry
          ? new TextDecoder().decode(await entryData(zip.bytes, relsEntry))
          : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
      const target = "../slideLayouts/" + chosen.part
      const pattern = /<Relationship\b[^>]*\bType="[^"]*\/slideLayout"[^>]*\/>/
      let nextRels: string
      if (pattern.test(relsXml)) {
        nextRels = relsXml.replace(pattern, (tag) => tag.replace(/\bTarget="[^"]*"/, 'Target="' + target + '"'))
      } else {
        const usedIds = [...relsXml.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1]))
        const rId = "rId" + String((usedIds.length > 0 ? Math.max(...usedIds) : 0) + 1)
        nextRels = relsXml.replace(
          /<\/Relationships>/,
          '<Relationship Id="' +
            rId +
            '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="' +
            target +
            '"/></Relationships>',
        )
      }
      replacements.set(relsKey, new TextEncoder().encode(nextRels))
      applied.push(op)
      continue
    }

    const existing = await notesPartOf(zip, part)
    if (existing) {
      const notesEntry = zip.entries.find((item) => item.name === existing)
      if (!notesEntry) throw new Error("找不到备注页部件：" + existing)
      const notesXml = new TextDecoder().decode(await entryData(zip.bytes, notesEntry))
      replacements.set(existing, new TextEncoder().encode(writeNotesText(notesXml, op.text)))
    } else {
      const created = await createNotesPart(zip, part, op.text)
      replacements.set(created.relsName, new TextEncoder().encode(created.slideRels))
      additions.set(created.part, new TextEncoder().encode(created.xml))
      additions.set(created.notesRelsName, new TextEncoder().encode(created.notesRels))
      const typesEntry = zip.entries.find((item) => item.name === "[Content_Types].xml")
      const typesXml = typesEntry ? new TextDecoder().decode(await entryData(zip.bytes, typesEntry)) : undefined
      if (typesXml !== undefined) {
        replacements.set("[Content_Types].xml", new TextEncoder().encode(addNotesContentType(typesXml, created.part)))
      }
    }
    applied.push(op)
  }

  return {
    bytes: rebuildZip(zip, replacements, additions),
    applied,
    changed: [...replacements.keys(), ...additions.keys()],
  }
}

/** `<p:sld ... show="0">` 设置 / 移除；根标签缺失时原样返回。 */
function setSlideHidden(xml: string, hidden: boolean): string {
  const tag = /<p:sld\b[^>]*>/.exec(xml)?.[0]
  if (!tag) return xml
  const cleaned = tag.replace(/\s+show="[^"]*"/, "")
  const next = hidden ? cleaned.replace(/>$/, ' show="0">') : cleaned
  if (next === tag) return xml
  return xml.replace(tag, next)
}

/** 改写备注页正文：保留第一个 run 的格式，只换文字；多行拆成多段。 */
function writeNotesText(xml: string, text: string): string {
  const blocks = scanBlocks(xml)
  const body = blocks.find((block) => /<p:ph\b[^>]*\btype="body"/.test(block.body))
  if (!body) return xml
  const rPr = /<a:rPr\b[^>]*\/>/.exec(body.body)?.[0] ?? ""
  const endRPr = /<a:endParaRPr\b[^>]*\/>/.exec(body.body)?.[0] ?? ""
  const paragraphXml = text
    .split(/\r?\n/)
    .map(
      (line) =>
        "<a:p>" +
        (line ? "<a:r>" + rPr + "<a:t>" + encodeXml(line) + "</a:t></a:r>" : "") +
        (endRPr || line ? endRPr || "<a:endParaRPr/>" : "") +
        "</a:p>",
    )
    .join("")
  // txBody 里 lstStyle 之后才是段落；没有 <a:p> 就整体补进去。
  const relative = body.body.replace(/<p:txBody\b[^>]*>([\s\S]*?)<\/p:txBody>/, (whole, inner: string) => {
    const prefix = /^[\s\S]*?<\/a:lstStyle>/.exec(inner)?.[0] ?? /^[\s\S]*?<a:bodyPr\b[^>]*\/>/.exec(inner)?.[0] ?? ""
    return "<p:txBody>" + prefix + paragraphXml + "</p:txBody>"
  })
  if (relative === body.body) return xml
  return xml.slice(0, body.start) + relative + xml.slice(body.end)
}

/** 新建最小可用的 notesSlide，并在 slide 的 rels 里挂一条关系。 */
async function createNotesPart(
  zip: ZipArchive,
  slidePart: string,
  text: string,
): Promise<{
  part: string
  xml: string
  relsName: string
  slideRels: string
  notesRelsName: string
  notesRels: string
}> {
  const used = zip.entries
    .map((item) => /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(item.name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
  const number = (used.length > 0 ? Math.max(...used) : 0) + 1
  const part = "ppt/notesSlides/notesSlide" + number + ".xml"

  const relsName = relsNameOf(slidePart)
  const relsEntry = zip.entries.find((item) => item.name === relsName)
  const relsXml = relsEntry
    ? new TextDecoder().decode(await entryData(zip.bytes, relsEntry))
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  const usedIds = [...relsXml.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1]))
  const rId = "rId" + String((usedIds.length > 0 ? Math.max(...usedIds) : 0) + 1)
  const relativeTarget = "../" + part.slice("ppt/".length)
  const relation = '<Relationship Id="' + rId + '" Type="' + NOTES_REL_TYPE + '" Target="' + relativeTarget + '"/>'
  const slideRels = relsXml.replace(/<\/Relationships>/, relation + "</Relationships>")

  const slideTarget = relativeTargetOf(slidePart, "ppt/notesSlides")
  const notesRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="' +
    slideTarget +
    '"/>' +
    "</Relationships>"

  const body = text
    .split(/\r?\n/)
    .map(
      (line) => "<a:p>" + (line ? '<a:r><a:rPr lang="zh-CN"/><a:t>' + encodeXml(line) + "</a:t></a:r>" : "") + "</a:p>",
    )
    .join("")
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    "<p:cSld><p:spTree>" +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    "<p:sp>" +
    '<p:nvSpPr><p:cNvPr id="2" name="备注占位符"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
    "<p:spPr/>" +
    "<p:txBody><a:bodyPr/><a:lstStyle/>" +
    body +
    "</p:txBody></p:sp>" +
    "</p:spTree></p:cSld>" +
    "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>" +
    "</p:notes>"

  return { part, xml, relsName, slideRels, notesRelsName: relsNameOf(part), notesRels }
}

/** 两个部件目录之间的相对引用：`ppt/notesSlides` 引用 `ppt/slides/slide1.xml` → `../slides/slide1.xml`。 */
function relativeTargetOf(target: string, fromDir: string): string {
  const to = target.split("/").filter(Boolean)
  const from = fromDir.split("/").filter(Boolean)
  let common = 0
  while (common < to.length - 1 && common < from.length && to[common] === from[common]) common += 1
  const up = from.length - common
  return [...Array.from({ length: up }, () => ".."), ...to.slice(common)].join("/")
}

/** [Content_Types].xml 补一条 notesSlide 的 Override（按 PartName 去重）。 */
function addNotesContentType(typesXml: string, part: string): string {
  const partName = "/" + part
  if (typesXml.includes('PartName="' + partName + '"')) return typesXml
  const override = '<Override PartName="' + partName + '" ContentType="' + NOTES_CONTENT_TYPE + '"/>'
  return typesXml.replace(/<\/Types>/, override + "</Types>")
}

// ---------------------------------------------------------------------------
// XML 手术 —— 定位
// ---------------------------------------------------------------------------

type BlockTag = "sp" | "pic" | "graphicFrame" | "grpSp"

type Block = {
  tag: BlockTag
  id: string
  name?: string
  start: number
  end: number
  body: string
  box?: PptxBox
  rotation?: number
  paragraphs: ParagraphBlock[]
  cells?: CellBlock[]
  blip?: { rId: string }
  /** 组合里的子形状：父链上的「子坐标 → 页面坐标」线性映射 */
  map?: GroupMap
  /** 组合里的子形状：所属组合的 cNvPr id */
  parentId?: string
}

type ParagraphBlock = { start: number; end: number; text: string; runs: RunBlock[] }
type RunBlock = { start: number; end: number; text: string; rPr?: string }
type CellBlock = { row: number; col: number; paragraphs: ParagraphBlock[]; box?: PptxBox }

/** 子坐标 → 页面坐标：slideX = offX + x * scaleX */
type GroupMap = { offX: number; offY: number; scaleX: number; scaleY: number }

const IDENTITY_MAP: GroupMap = { offX: 0, offY: 0, scaleX: 1, scaleY: 1 }

const BLOCK_TAGS: BlockTag[] = ["graphicFrame", "grpSp", "sp", "pic"]

function blockKind(tag: BlockTag): PptxNodeKind {
  if (tag === "pic") return "picture"
  if (tag === "grpSp") return "group"
  if (tag === "graphicFrame") return "table"
  return "shape"
}

function scanBlocks(xml: string): Block[] {
  return scanRange(xml, 0, xml.length, IDENTITY_MAP, undefined)
}

function scanRange(xml: string, from: number, to: number, map: GroupMap, parentId: string | undefined): Block[] {
  const result: Block[] = []
  let cursor = from
  while (cursor < to) {
    const next = nextBlockOpen(xml, cursor)
    if (!next || next.start >= to) break
    const end = closingIndex(xml, next.contentStart, next.tag)
    if (end === -1) break
    const body = xml.slice(next.start, end)
    const cNvPr = body.match(/<p:cNvPr\b[^>]*>/)?.[0]
    const id = cNvPr?.match(/\sid="([^"]*)"/)?.[1] ?? ""
    if (id) {
      const geometry = blockGeometry(body)
      const cells = next.tag === "graphicFrame" ? tableCells(body, next.start) : []
      result.push({
        tag: next.tag,
        id,
        name: decodeXml(cNvPr?.match(/\sname="([^"]*)"/)?.[1] ?? "") || undefined,
        start: next.start,
        end,
        body,
        box: geometry.box ? mapBox(geometry.box, map) : undefined,
        rotation: geometry.rotation,
        paragraphs: textBodyParagraphs(body, next.start),
        ...(cells.length > 0 ? { cells } : {}),
        ...(next.tag === "pic" ? blipOf(body) : {}),
        ...(map === IDENTITY_MAP ? {} : { map, parentId }),
      })
    }
    // 组合：子形状递归展开成可独立编辑的块（旋转/翻转的组合没有线性映射，不展开）。
    if (next.tag === "grpSp") {
      const childMap = groupChildMap(body, map)
      if (childMap) result.push(...scanRange(xml, next.contentStart, end, childMap, id || undefined))
    }
    cursor = end
  }
  return result
}

function mapBox(box: PptxBox, map: GroupMap): PptxBox {
  if (map === IDENTITY_MAP) return box
  return {
    x: Math.round(map.offX + box.x * map.scaleX),
    y: Math.round(map.offY + box.y * map.scaleY),
    w: Math.round(box.w * map.scaleX),
    h: Math.round(box.h * map.scaleY),
  }
}

/** 页面坐标 → 子坐标空间（写回子块 xfrm 时用）。 */
function unmapBox(box: PptxBox, map: GroupMap): PptxBox {
  if (map === IDENTITY_MAP) return box
  return {
    x: Math.round((box.x - map.offX) / map.scaleX),
    y: Math.round((box.y - map.offY) / map.scaleY),
    w: Math.round(box.w / map.scaleX),
    h: Math.round(box.h / map.scaleY),
  }
}

/** 组合的 `grpSpPr/a:xfrm`：off/ext 映射到父坐标，chOff/chExt 是子坐标空间。 */
function groupChildMap(body: string, parent: GroupMap): GroupMap | undefined {
  const xfrm = body.match(/<p:grpSpPr\b[^>]*>[\s\S]*?<a:xfrm\b([^>]*)>([\s\S]*?)<\/a:xfrm>/)
  if (!xfrm) return undefined
  const attrs = xfrm[1] ?? ""
  const rot = attrs.match(/\brot="(-?\d+)"/)
  if (rot && rot[1] !== "0") return undefined
  if (/\bflip[HV]="(?:1|true)"/.test(attrs)) return undefined
  const inner = xfrm[2] ?? ""
  const off = inner.match(/<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"/)
  const ext = inner.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/)
  if (!off || !ext) return undefined
  const chOffX = Number(inner.match(/<a:chOff\s+x="(-?\d+)"/)?.[1] ?? 0)
  const chOffY = Number(inner.match(/<a:chOff\s+y="(-?\d+)"/)?.[1] ?? 0)
  const chExtW = Number(inner.match(/<a:chExt\s+cx="(\d+)"\s+cy="(\d+)"/)?.[1] ?? ext[1])
  const chExtH = Number(inner.match(/<a:chExt\s+cx="(\d+)"\s+cy="(\d+)"/)?.[2] ?? ext[2])
  const scaleX = chExtW > 0 ? Number(ext[1]) / chExtW : 1
  const scaleY = chExtH > 0 ? Number(ext[2]) / chExtH : 1
  // page = off + (child - chOff) * scale；再叠上父链的映射。
  return {
    offX: parent.offX + (Number(off[1]) - chOffX * scaleX) * parent.scaleX,
    offY: parent.offY + (Number(off[2]) - chOffY * scaleY) * parent.scaleY,
    scaleX: scaleX * parent.scaleX,
    scaleY: scaleY * parent.scaleY,
  }
}

function nextBlockOpen(xml: string, cursor: number) {
  let best: { tag: BlockTag; start: number; contentStart: number } | undefined
  for (const tag of BLOCK_TAGS) {
    const token = "<p:" + tag
    let index = xml.indexOf(token, cursor)
    // `<p:spPr>` 之类不是块开标签：后面必须紧跟空白或 '>'
    while (index !== -1 && !/[\s>]/.test(xml[index + token.length] ?? "")) {
      index = xml.indexOf(token, index + token.length)
    }
    if (index === -1) continue
    if (!best || index < best.start) best = { tag, start: index, contentStart: index + token.length }
  }
  return best
}

/** 从内容起点往后数，找到配对的结束标签之后的位置（同标签可嵌套）。 */
function closingIndex(xml: string, contentStart: number, tag: string) {
  const openToken = "<p:" + tag
  const closeToken = "</p:" + tag + ">"
  let depth = 1
  let cursor = contentStart
  while (cursor < xml.length) {
    const nextClose = xml.indexOf(closeToken, cursor)
    if (nextClose === -1) return -1
    let nextOpen = xml.indexOf(openToken, cursor)
    while (nextOpen !== -1 && nextOpen < nextClose && !/[\s>]/.test(xml[nextOpen + openToken.length] ?? "")) {
      nextOpen = xml.indexOf(openToken, nextOpen + openToken.length)
    }
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      cursor = nextOpen + openToken.length
      continue
    }
    depth--
    cursor = nextClose + closeToken.length
    if (depth === 0) return cursor
  }
  return -1
}

function blockGeometry(body: string) {
  // 形状/图片是 <a:xfrm>，表格框是 <p:xfrm>。
  const match = body.match(/<(a|p):xfrm\b([^>]*)>([\s\S]*?)<\/\1:xfrm>/)
  if (!match) return {}
  const attrs = match[2] ?? ""
  const inner = match[3] ?? ""
  const off = inner.match(/<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"/)
  const ext = inner.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/)
  const rot = attrs.match(/\brot="(-?\d+)"/)
  return {
    box: off && ext ? { x: Number(off[1]), y: Number(off[2]), w: Number(ext[1]), h: Number(ext[2]) } : undefined,
    rotation: rot ? Number(rot[1]) / 60000 : undefined,
  }
}

function blipOf(body: string) {
  const blip = body.match(/<a:blip\b[^>]*>/)?.[0]
  const rid = blip?.match(/\br:embed="([^"]*)"/)?.[1] ?? blip?.match(/\br:link="([^"]*)"/)?.[1]
  return rid ? { blip: { rId: rid } } : {}
}

/** 块里的文本：形状取 `<p:txBody>`；图片没有。 */
function textBodyParagraphs(body: string, base: number): ParagraphBlock[] {
  const txBody = body.match(/<(?:p|a):txBody(?:\s[^>]*)?>([\s\S]*?)<\/(?:p|a):txBody>/)
  if (!txBody) return []
  const innerStart = base + (txBody.index ?? 0) + txBody[0].indexOf(">") + 1
  return paragraphsIn(txBody[1] ?? "", innerStart)
}

/** 表格：逐行逐列取出 `<a:tc>` 里的段落（位置是绝对偏移，便于原地替换）。 */
function tableCells(body: string, base: number): CellBlock[] {
  const tbl = body.match(/<a:tbl(?:\s[^>]*)?>([\s\S]*?)<\/a:tbl>/)
  if (!tbl) return []
  const tableStart = base + (tbl.index ?? 0) + tbl[0].indexOf(">") + 1
  const inner = tbl[1] ?? ""
  const cells: CellBlock[] = []
  const rowRe = /<a:tr(?:\s[^>]*)?>([\s\S]*?)<\/a:tr>/g
  let rowMatch: RegExpExecArray | null
  let row = 0
  while ((rowMatch = rowRe.exec(inner))) {
    const rowStart = tableStart + rowMatch.index + rowMatch[0].indexOf(">") + 1
    const colRe = /<a:tc(?:\s[^>]*)?>([\s\S]*?)<\/a:tc>/g
    let colMatch: RegExpExecArray | null
    let col = 0
    while ((colMatch = colRe.exec(rowMatch[1] ?? ""))) {
      const cellStart = rowStart + colMatch.index
      const txBody = colMatch[0].match(/<a:txBody(?:\s[^>]*)?>([\s\S]*?)<\/a:txBody>/)
      if (txBody) {
        const innerStart = cellStart + (txBody.index ?? 0) + txBody[0].indexOf(">") + 1
        // 单元格自己在页面上的位置：表格框位置 + 行高列宽累加。
        cells.push({ row, col, paragraphs: paragraphsIn(txBody[1] ?? "", innerStart), box: cellBox(body, row, col) })
      }
      col++
    }
    row++
  }
  return cells
}

/**
 * 单元格在页面上的盒子：表格框 `<a:off>/<a:ext>` 加上行高列宽累加。
 * 列宽 `<a:gridCol w>` 顺序对应列，行高 `<a:tr h>` 对应行；
 * 本格 h 取本行高、w 取本列宽（合并单元格不特殊处理，以左上角格为准）。
 */
function cellBox(body: string, row: number, col: number): PptxBox | undefined {
  const frame = body.match(/<p:xfrm\b[^>]*>([\s\S]*?)<\/p:xfrm>/)
  const off = frame?.[1]?.match(/<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"/)
  if (!off) return undefined
  const gridCols = [...body.matchAll(/<a:gridCol\b[^>]*\bw="(\d+)"/g)].map((match) => Number(match[1]))
  const rowHeights = [...body.matchAll(/<a:tr\b[^>]*\bh="(\d+)"/g)].map((match) => Number(match[1]))
  if (gridCols.length === 0 || rowHeights.length === 0) return undefined
  const x = Number(off[1]) + gridCols.slice(0, col).reduce((sum, w) => sum + w, 0)
  const y = Number(off[2]) + rowHeights.slice(0, row).reduce((sum, h) => sum + h, 0)
  return { x, y, w: gridCols[col] ?? 0, h: rowHeights[row] ?? 0 }
}

function paragraphsIn(inner: string, base: number): ParagraphBlock[] {
  const result: ParagraphBlock[] = []
  // `<a:p>` / `<a:r>` 偶尔带属性（lang、smtClean 之类），标签长度不能写死。
  const paragraphRe = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g
  let match: RegExpExecArray | null
  while ((match = paragraphRe.exec(inner))) {
    const start = base + match.index
    const end = start + match[0].length
    const innerStart = start + match[0].indexOf(">") + 1
    const runs: RunBlock[] = []
    const runRe = /<a:r(?:\s[^>]*)?>([\s\S]*?)<\/a:r>/g
    let run: RegExpExecArray | null
    while ((run = runRe.exec(match[1] ?? ""))) {
      const runStart = innerStart + run.index
      const runEnd = runStart + run[0].length
      const text = run[1]?.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/)?.[1] ?? ""
      runs.push({
        start: runStart,
        end: runEnd,
        text: decodeXml(text),
        rPr: run[1]?.match(/<a:rPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:rPr>)/)?.[0],
      })
    }
    result.push({ start, end, text: runs.map((item) => item.text).join(""), runs })
  }
  return result
}

// ---------------------------------------------------------------------------
// XML 手术 —— 文本与格式
// ---------------------------------------------------------------------------

function applyTextEdits(xml: string, edits: readonly PptxTextEdit[]) {
  const blocks = scanBlocks(xml)
  const applied: PptxTextEditApplied[] = []
  const splices: Array<{ start: number; end: number; replacement: string }> = []

  for (const edit of edits) {
    const block = findBlock(blocks, edit)
    if (!block) continue

    const paragraph = edit.cell
      ? cellParagraph(block, edit.cell, edit.paragraph ?? 0)
      : block.paragraphs[edit.paragraph ?? 0]
    if (!paragraph) continue

    const replacement = rebuildParagraph(xml, paragraph, edit)
    // 同一次调用里同一段可能被写了两次：后写的覆盖先写的。
    const existing = splices.findIndex((item) => item.start === paragraph.start)
    if (existing !== -1) splices.splice(existing, 1)
    splices.push({ start: paragraph.start, end: paragraph.end, replacement })
    applied.push({
      slide: edit.slide,
      shapeId: block.id,
      shapeName: block.name,
      paragraph: edit.paragraph ?? 0,
      previous: paragraph.text,
      text: edit.text ?? paragraph.text,
      ...(edit.cell ? { cell: edit.cell } : {}),
      ...(edit.style ? { style: edit.style } : {}),
    })
  }

  if (splices.length === 0) return { xml, applied: [] }

  // 从后往前替换，避免前面的改动把后面的偏移量挪走。
  let next = xml
  for (const item of [...splices].sort((a, b) => b.start - a.start)) {
    next = next.slice(0, item.start) + item.replacement + next.slice(item.end)
  }
  next = resetAutoFit(next, new Set(applied.map((item) => item.shapeId)))
  return { xml: next, applied }
}

function cellParagraph(block: Block, cell: { row: number; col: number }, index: number) {
  const target = block.cells?.find((item) => item.row === cell.row && item.col === cell.col)
  return target?.paragraphs[index]
}

/**
 * 重写一个段落：
 * - 给了新文字 → 尽量保留混排（新旧文字公共前缀/后缀覆盖到的 run 原样不动，
 *   只重写中间真正变化的部分）；整段被替换时才收敛成单 run。
 * - 只给样式 → 逐 run 打补丁，保留段内混排。
 */
function rebuildParagraph(xml: string, paragraph: ParagraphBlock, edit: PptxTextEdit) {
  const original = xml.slice(paragraph.start, paragraph.end)
  const style = edit.style

  if (edit.text !== undefined) {
    const prefix = paragraphXmlPrefix(original)
    const suffix = paragraphXmlSuffix(original)
    const middle = rebuildRuns(paragraph, edit.text, style)
    const withAlign = style?.align ? patchAlign(prefix, style.align) : prefix
    return "<a:p>" + withAlign + middle + suffix + "</a:p>"
  }

  if (!style) return original

  let next = original
  // 从后往前：run 的相对偏移在替换之后仍然有效。
  for (const run of [...paragraph.runs].sort((a, b) => b.start - a.start)) {
    const start = run.start - paragraph.start
    const end = run.end - paragraph.start
    const patched = patchRunXml(next.slice(start, end), style)
    next = next.slice(0, start) + patched + next.slice(end)
  }
  // 没有 run 的段落：样式落到段落结束符上，否则看起来像没生效。
  if (paragraph.runs.length === 0) {
    next = next.replace(
      /<a:endParaRPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:endParaRPr>)/,
      (tag) => patchRunProperties(tag, style, "endParaRPr") ?? tag,
    )
  }
  if (style.align) next = patchAlign(next, style.align)
  return next
}

/**
 * 按新文字重排 run，尽量保留混排：
 * 1. 新旧文字有公共前缀/后缀时，被完全覆盖的原 run 原样保留（格式不动）；
 * 2. 中间真正变化的区间合成一个 run（沿用区间里第一个 run 的格式 + 本次样式）；
 * 3. 原 run 只有 0 或 1 个时直接走单 run 收敛，行为与之前一致。
 * run 边界不做字符级 diff —— 那会把「改一个字」变成一堆碎片 run，
 * PowerPoint 自己也不是这么存的。
 */
function rebuildRuns(paragraph: ParagraphBlock, text: string, style: PptxTextStyle | undefined) {
  const runs = paragraph.runs
  if (runs.length <= 1) {
    const runPr = patchRunProperties(runs[0]?.rPr, style)
    return "<a:r>" + (runPr ?? "") + '<a:t xml:space="preserve">' + encodeXml(text) + "</a:t></a:r>"
  }

  const previous = runs.map((run) => run.text).join("")
  // 公共前缀/后缀长度（不超过两边较短的那个）。
  let head = 0
  const headLimit = Math.min(previous.length, text.length)
  while (head < headLimit && previous[head] === text[head]) head++
  let tail = 0
  const tailLimit = Math.min(previous.length - head, text.length - head)
  while (tail < tailLimit && previous[previous.length - 1 - tail] === text[text.length - 1 - tail]) tail++

  const changedStart = head
  const changedEnd = previous.length - tail
  const changedText = text.slice(head, text.length - tail)
  const pieces: string[] = []
  let cursor = 0
  let changedWritten = false
  for (const run of runs) {
    const runStart = cursor
    const runEnd = cursor + run.text.length
    cursor = runEnd
    // 完全落在公共前缀或后缀里的 run：原样保留。
    if (runEnd <= changedStart || runStart >= changedEnd) {
      pieces.push("<a:r>" + (run.rPr ?? "") + '<a:t xml:space="preserve">' + encodeXml(run.text) + "</a:t></a:r>")
      continue
    }
    // 变化区间的 run：整段新文字只在第一个相交的 run 处写一次，
    // 用它自己的格式 —— 跨多个 run 时后面的直接丢掉。
    if (changedWritten) continue
    changedWritten = true
    if (!changedText) continue
    const runPr = patchRunProperties(run.rPr, style)
    pieces.push("<a:r>" + (runPr ?? "") + '<a:t xml:space="preserve">' + encodeXml(changedText) + "</a:t></a:r>")
  }

  // 变化区间没有覆盖任何 run（比如全选后输入 → 不可能；纯防御），兜底单 run。
  if (!changedWritten) {
    const runPr = patchRunProperties(runs[0]?.rPr, style)
    return "<a:r>" + (runPr ?? "") + '<a:t xml:space="preserve">' + encodeXml(text) + "</a:t></a:r>"
  }
  return pieces.join("")
}

/** 段落属性（缩进/项目符号/对齐）直接决定排版，丢了等于重排整页。 */
function paragraphXmlPrefix(paragraphXml: string) {
  return paragraphXml.match(/<a:pPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:pPr>)/)?.[0] ?? ""
}

/** 段落结束符属性决定空行高度，一起留着。 */
function paragraphXmlSuffix(paragraphXml: string) {
  return paragraphXml.match(/<a:endParaRPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:endParaRPr>)/)?.[0] ?? ""
}

/** 对齐写在 `<a:pPr algn>`；没有 pPr 就补一个。 */
function patchAlign(paragraphXml: string, align: PptxAlign) {
  const ppr = paragraphXml.match(/<a:pPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:pPr>)/)
  if (ppr) {
    const tag = ppr[0]
    const open = tag.match(/^<a:pPr\b([^>]*?)(\/?)>/)
    const attrs = setAttr(open?.[1] ?? "", "algn", align)
    const replacement =
      open?.[2] === "/" ? "<a:pPr" + attrs + "/>" : "<a:pPr" + attrs + tag.slice(open?.[0].length ?? 0)
    const at = ppr.index ?? 0
    return paragraphXml.slice(0, at) + replacement + paragraphXml.slice(at + tag.length)
  }
  const open = paragraphXml.match(/^<a:p(?:\s[^>]*)?>/)?.[0] ?? "<a:p>"
  return open + '<a:pPr algn="' + align + '"/>' + paragraphXml.slice(open.length)
}

/** 给一个 run 打格式补丁：有 rPr 就改它，没有就补在 `<a:r>` 后面。 */
function patchRunXml(runXml: string, style: PptxTextStyle) {
  const rPr = runXml.match(/<a:rPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:rPr>)/)
  const patched = patchRunProperties(rPr?.[0], style)
  if (!patched) return runXml
  if (rPr) return runXml.replace(rPr[0], patched)
  const open = runXml.match(/^<a:r(?:\s[^>]*)?>/)?.[0] ?? "<a:r>"
  return open + patched + runXml.slice(open.length)
}

/**
 * 改写 `<a:rPr>`：属性直接改（b/i/u/sz），填充与字体是子元素。
 * `tagName` 用于 `<a:endParaRPr>`（结构完全一样，只是名字不同）。
 */
function patchRunProperties(rPr: string | undefined, style: PptxTextStyle | undefined, tagName = "rPr") {
  if (!style) return rPr
  const parsed = rPr ? splitElement(rPr, tagName) : undefined
  let attrs = parsed?.attrs ?? ""
  let body = parsed?.body ?? ""

  if (style.bold !== undefined) attrs = setAttr(attrs, "b", style.bold ? "1" : undefined)
  if (style.italic !== undefined) attrs = setAttr(attrs, "i", style.italic ? "1" : undefined)
  if (style.underline !== undefined) attrs = setAttr(attrs, "u", style.underline ? "sng" : undefined)
  if (style.size !== undefined) attrs = setAttr(attrs, "sz", String(Math.max(100, Math.round(style.size * 100))))
  if (style.color !== undefined) body = setSolidFill(body, style.color)
  if (style.font !== undefined) body = setLatin(body, style.font)

  const head = "<a:" + tagName + attrs
  if (!body.trim()) return head + "/>"
  return head + ">" + body + "</a:" + tagName + ">"
}

function splitElement(xml: string, name: string) {
  // 手写扫描而不是拼 RegExp：名字是动态的，拼字符串容易在转义上栽跟头。
  const head = "<a:" + name
  if (!xml.startsWith(head)) return undefined
  const boundary = xml.charAt(head.length)
  if (boundary !== " " && boundary !== "/" && boundary !== ">" && boundary !== "") return undefined
  const gt = xml.indexOf(">", head.length)
  if (gt === -1) return undefined
  const selfClosing = xml.charAt(gt - 1) === "/"
  const attrs = xml.slice(head.length, selfClosing ? gt - 1 : gt)
  if (selfClosing) return { attrs, body: "" }
  const close = "</a:" + name + ">"
  const at = xml.lastIndexOf(close)
  return { attrs, body: at === -1 ? "" : xml.slice(gt + 1, at) }
}

function setAttr(attrs: string, name: string, value: string | undefined) {
  // 用字符类代替 \s：\s 只有写进正则字面量才可靠，拼字符串时容易被转义吃掉。
  const pattern = new RegExp("(^|[ \\t\\r\\n])" + name + '="[^"]*"')
  if (value === undefined) return attrs.replace(pattern, "").trimEnd()
  if (pattern.test(attrs)) return attrs.replace(pattern, (match) => match.charAt(0) + name + '="' + value + '"')
  return attrs + " " + name + '="' + value + '"'
}

function setSolidFill(body: string, color: string) {
  const fill = '<a:solidFill><a:srgbClr val="' + color.replace(/^#/, "").toUpperCase() + '"/></a:solidFill>'
  const pattern = /<a:solidFill>[\s\S]*?<\/a:solidFill>|<a:solidFill\s*\/>/
  if (pattern.test(body)) return body.replace(pattern, fill)
  return insertBeforeTypefaces(body, fill)
}

function setLatin(body: string, font: string) {
  const latin = '<a:latin typeface="' + encodeXml(font) + '"/>'
  if (/<a:latin\b[^>]*\/>/.test(body)) return body.replace(/<a:latin\b[^>]*\/>/, latin)
  return insertBeforeTypefaces(body, latin)
}

/**
 * CT_TextCharacterProperties 的子元素顺序是 ln → fill → effect → latin → ea → cs → …
 * 新节点插在第一个字体类节点之前，或放在 `<a:ln>` 之后，尽量贴合 schema。
 */
function insertBeforeTypefaces(body: string, node: string) {
  const latin = body.search(/<a:(?:latin|ea|cs)\b/)
  if (latin !== -1) return body.slice(0, latin) + node + body.slice(latin)
  const line = body.match(/<a:ln\b[^>]*(?:\/>|>[\s\S]*?<\/a:ln>)/)
  if (line) {
    const at = body.indexOf(line[0]) + line[0].length
    return body.slice(0, at) + node + body.slice(at)
  }
  return node + body
}

// ---------------------------------------------------------------------------
// XML 手术 —— 几何
// ---------------------------------------------------------------------------

function applyShapeEdits(xml: string, edits: readonly PptxShapeEdit[]) {
  const blocks = scanBlocks(xml)
  const applied: PptxShapeEditApplied[] = []
  const splices: Array<{ start: number; end: number; replacement: string }> = []

  for (const edit of edits) {
    const block = findBlock(blocks, edit)
    if (!block) continue
    // 组合里的子形状：页面坐标要换算回子坐标空间再写 xfrm（子块只有线性映射时可行）。
    const local = block.map && edit.box ? unmapBox(edit.box, block.map) : edit.box
    const patched = patchGeometry(block.body, { ...edit, box: local })
    if (!patched) continue
    const existing = splices.findIndex((item) => item.start === block.start)
    if (existing !== -1) splices.splice(existing, 1)
    splices.push({ start: block.start, end: block.end, replacement: patched })
    applied.push({
      slide: edit.slide,
      shapeId: block.id,
      shapeName: block.name,
      previous: block.box,
      box: edit.box ?? block.box,
      previousRotation: block.rotation,
      rotation: edit.rotation ?? block.rotation,
    })
  }

  if (splices.length === 0) return { xml, applied: [] }

  let next = xml
  for (const item of [...splices].sort((a, b) => b.start - a.start)) {
    next = next.slice(0, item.start) + item.replacement + next.slice(item.end)
  }
  return { xml: next, applied }
}

function patchGeometry(body: string, edit: PptxShapeEdit) {
  const match = body.match(/<(a|p):xfrm\b([^>]*)>([\s\S]*?)<\/\1:xfrm>/)
  if (!match) return undefined
  const prefix = match[1]
  let attrs = match[2] ?? ""
  let inner = match[3] ?? ""

  if (edit.box) {
    if (!/<a:off\b[^>]*\/>/.test(inner) || !/<a:ext\b[^>]*\/>/.test(inner)) return undefined
    const { x, y, w, h } = edit.box
    inner = inner
      .replace(/<a:off\b[^>]*\/>/, '<a:off x="' + Math.round(x) + '" y="' + Math.round(y) + '"/>')
      .replace(
        /<a:ext\b[^>]*\/>/,
        '<a:ext cx="' + Math.max(1, Math.round(w)) + '" cy="' + Math.max(1, Math.round(h)) + '"/>',
      )
  }
  if (edit.rotation !== undefined) {
    // rot 只在 a:xfrm 上（表格框 p:xfrm 没有旋转）
    if (prefix !== "a") return undefined
    attrs = setAttr(attrs, "rot", String(Math.round(edit.rotation * 60000)))
  }

  const replacement = "<" + prefix + ":xfrm" + attrs + ">" + inner + "</" + prefix + ":xfrm>"
  const at = body.indexOf(match[0])
  return body.slice(0, at) + replacement + body.slice(at + match[0].length)
}

// ---------------------------------------------------------------------------
// XML 手术 —— 图片替换
// ---------------------------------------------------------------------------

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
}

function mimeForExtension(ext: string) {
  if (ext === "png") return "image/png"
  if (ext === "svg") return "image/svg+xml"
  if (ext === "webp") return "image/webp"
  if (ext === "gif") return "image/gif"
  return "image/jpeg"
}

async function applyImageEdits(input: {
  xml: string
  slide: number
  part: string
  edits: readonly PptxImageEdit[]
  zip: ZipArchive
  additions: Map<string, Uint8Array>
  /** 同一页前面已经改过 rels 时传进来，避免两次修改互相覆盖。 */
  relsText?: string
}) {
  let xml = input.xml
  let rels = input.relsText ?? (await readSlideRelsText(input.zip, input.part))
  const applied: PptxImageEditApplied[] = []

  for (const edit of input.edits) {
    const blocks = scanBlocks(xml)
    const block = findBlock(blocks, edit)
    if (!block?.blip) continue
    const ext = MIME_EXT[edit.mime.toLowerCase()]
    if (!ext) continue

    // 新图片单独放一个条目：旧图仍被别处引用时不会一起坏掉。
    const mediaPath = uniqueMediaPath(input.zip, input.additions, ext)
    input.additions.set(mediaPath, edit.data)

    const rid = nextRelId(rels)
    rels = addRelationship(rels, rid, "../media/" + mediaPath.slice("ppt/media/".length))
    const patched = block.body.replace(/<a:blip\b[^>]*>/, (tag) =>
      tag.replace(/(\br:(?:embed|link))="[^"]*"/, '$1="' + rid + '"'),
    )
    xml = xml.slice(0, block.start) + patched + xml.slice(block.end)

    applied.push({
      slide: input.slide,
      shapeId: block.id,
      shapeName: block.name,
      mediaPath,
      previousRId: block.blip.rId,
      rId: rid,
    })
  }

  return { xml, rels: applied.length > 0 ? new TextEncoder().encode(rels) : undefined, applied }
}

/** 新增图片：媒体条目 + 关系 + 一个 `<p:pic>`，坐标用 EMU。 */
async function applyAddPictures(input: {
  xml: string
  part: string
  ops: ReadonlyArray<Extract<PptxShapeOp, { op: "addPicture" }>>
  zip: ZipArchive
  additions: Map<string, Uint8Array>
  relsText?: string
}) {
  let xml = input.xml
  let rels = input.relsText ?? (await readSlideRelsText(input.zip, input.part))
  const applied: PptxImageEditApplied[] = []
  for (const op of input.ops) {
    const ext = MIME_EXT[op.mime.toLowerCase()]
    if (!ext || op.data.length === 0) continue
    const mediaPath = uniqueMediaPath(input.zip, input.additions, ext)
    input.additions.set(mediaPath, op.data)
    const rid = nextRelId(rels)
    rels = addRelationship(rels, rid, "../media/" + mediaPath.slice("ppt/media/".length))
    const id = nextShapeId(xml)
    const name = "图片 " + id
    const block = pictureXml({ id, name, box: op.box ?? DEFAULT_PICTURE_BOX, rid })
    const close = xml.lastIndexOf("</p:spTree>")
    if (close === -1) continue
    xml = xml.slice(0, close) + block + xml.slice(close)
    applied.push({ slide: op.slide, shapeId: String(id), shapeName: name, mediaPath, rId: rid })
  }
  return { xml, rels: applied.length > 0 ? new TextEncoder().encode(rels) : undefined, applied }
}

/** 新图片默认放在左上角，4×3 英寸（EMU）。 */
const DEFAULT_PICTURE_BOX = { x: 914400, y: 914400, w: 3657600, h: 2743200 }

function pictureXml(input: { id: number; name: string; box: PptxBox; rid: string }): string {
  return (
    "<p:pic><p:nvPicPr>" +
    '<p:cNvPr id="' +
    input.id +
    '" name="' +
    encodeXml(input.name) +
    '"/>' +
    '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/>' +
    "</p:nvPicPr><p:blipFill>" +
    '<a:blip r:embed="' +
    input.rid +
    '"/>' +
    "<a:stretch><a:fillRect/></a:stretch></p:blipFill>" +
    "<p:spPr><a:xfrm>" +
    '<a:off x="' +
    Math.round(input.box.x) +
    '" y="' +
    Math.round(input.box.y) +
    '"/>' +
    '<a:ext cx="' +
    Math.max(1, Math.round(input.box.w)) +
    '" cy="' +
    Math.max(1, Math.round(input.box.h)) +
    '"/>' +
    '</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
  )
}

const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"

function emptyRels() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships ' + REL_NS + "></Relationships>"
}

async function readSlideRelsText(zip: ZipArchive, part: string) {
  const entry = zip.entries.find((item) => item.name === relsNameOf(part))
  if (!entry) return emptyRels()
  return new TextDecoder().decode(await entryData(zip.bytes, entry))
}

async function readSlideRels(zip: ZipArchive, part: string) {
  const map = new Map<string, string>()
  const xml = await readSlideRelsText(zip, part)
  const pattern = /<Relationship\b[^>]*>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml))) {
    const tag = match[0]
    const id = tag.match(/\bId="([^"]*)"/)?.[1]
    const target = tag.match(/\bTarget="([^"]*)"/)?.[1]
    if (id && target) map.set(id, target)
  }
  return map
}

function nextRelId(rels: string) {
  let max = 0
  const pattern = /\bId="rId(\d+)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(rels))) max = Math.max(max, Number(match[1]))
  return "rId" + (max + 1)
}

function addRelationship(rels: string, id: string, target: string) {
  const node = '<Relationship Id="' + id + '" Type="' + IMAGE_REL_TYPE + '" Target="' + encodeXml(target) + '"/>'
  if (/<\/Relationships>/.test(rels)) return rels.replace(/<\/Relationships>/, node + "</Relationships>")
  return rels + node
}

function uniqueMediaPath(zip: ZipArchive, additions: Map<string, Uint8Array>, ext: string) {
  const taken = new Set([...zip.entries.map((entry) => entry.name), ...additions.keys()])
  let index = 1
  while (true) {
    const candidate = "ppt/media/novaway-" + Date.now().toString(36) + "-" + index + "." + ext
    if (!taken.has(candidate)) return candidate
    index++
  }
}

/** 新扩展名要登记到 `[Content_Types].xml` 的 `<Default>`，否则 PowerPoint 会报错。 */
async function ensureContentTypes(
  zip: ZipArchive,
  additions: Map<string, Uint8Array>,
  replacements: Map<string, Uint8Array>,
) {
  if (additions.size === 0) return []
  const name = "[Content_Types].xml"
  const existing = replacements.get(name)
  const entry = zip.entries.find((item) => item.name === name)
  if (!existing && !entry) return []

  const xml = existing
    ? new TextDecoder().decode(existing)
    : new TextDecoder().decode(await entryData(zip.bytes, entry!))
  let next = xml
  for (const path of additions.keys()) {
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase()
    if (new RegExp('<Default[^>]*Extension="' + ext + '"', "i").test(next)) continue
    const node = '<Default Extension="' + ext + '" ContentType="' + mimeForExtension(ext) + '"/>'
    if (/<Types\b[^>]*>/.test(next)) next = next.replace(/<Types\b[^>]*>/, (tag) => tag + node)
  }
  if (next === xml) return []
  replacements.set(name, new TextEncoder().encode(next))
  return [name]
}

// ---------------------------------------------------------------------------
// 定位与格式读取
// ---------------------------------------------------------------------------

function findBlock(blocks: readonly Block[], edit: { shapeId?: string; shapeName?: string }) {
  return blocks.find((item) =>
    edit.shapeId ? item.id === edit.shapeId : edit.shapeName ? item.name === edit.shapeName : false,
  )
}

// ---------------------------------------------------------------------------
// XML 手术 —— 结构：新建文本框、删除形状
// ---------------------------------------------------------------------------

/** 新文本框的默认位置：贴左上、约 6.7 × 1.0 英寸（EMU）。 */
const DEFAULT_TEXT_BOX: PptxBox = { x: 838200, y: 838200, w: 6096000, h: 914400 }

/** 新形状的默认位置：页面中部偏上，3 × 2 英寸（EMU）。 */
const DEFAULT_SHAPE_BOX: PptxBox = { x: 1371600, y: 1828800, w: 2743200, h: 1828800 }

/** 常见形状的中文名，写进 `p:cNvPr@name`，列表里好认。 */
const SHAPE_NAMES: Record<PptxShapeKind, string> = {
  rect: "矩形",
  roundRect: "圆角矩形",
  ellipse: "椭圆",
  triangle: "三角形",
  diamond: "菱形",
  rightArrow: "箭头",
  line: "线条",
  star5: "五角星",
}

function nextShapeId(xml: string): number {
  const ids = [...xml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1]))
  return Math.max(1, ...ids) + 1
}

/** 段落属性：只有对齐需要写 pPr。 */
function paragraphProps(style: PptxTextStyle | undefined): string {
  if (!style?.align) return ""
  const algn = style.align === "ctr" ? "ctr" : style.align === "r" ? "r" : style.align === "just" ? "just" : "l"
  return '<a:pPr algn="' + algn + '"/>'
}

function textBoxXml(input: { id: number; name: string; box: PptxBox; text: string; style?: PptxTextStyle }): string {
  const { box } = input
  const rPr = patchRunProperties('<a:rPr lang="zh-CN" dirty="0"/>', input.style) ?? '<a:rPr lang="zh-CN" dirty="0"/>'
  const paragraphs = input.text.split(/\r?\n/)
  const body = paragraphs
    .map(
      (line) =>
        "<a:p>" +
        paragraphProps(input.style) +
        (line.length === 0 ? "" : "<a:r>" + rPr + '<a:t xml:space="preserve">' + encodeXml(line) + "</a:t></a:r>") +
        "</a:p>",
    )
    .join("")
  return (
    "<p:sp>" +
    "<p:nvSpPr>" +
    '<p:cNvPr id="' +
    input.id +
    '" name="' +
    encodeXml(input.name) +
    '"/>' +
    '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
    "<p:spPr>" +
    "<a:xfrm>" +
    '<a:off x="' +
    Math.round(box.x) +
    '" y="' +
    Math.round(box.y) +
    '"/>' +
    '<a:ext cx="' +
    Math.max(1, Math.round(box.w)) +
    '" cy="' +
    Math.max(1, Math.round(box.h)) +
    '"/>' +
    "</a:xfrm>" +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    "</p:spPr>" +
    '<p:txBody><a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr><a:lstStyle/>' +
    body +
    "</p:txBody></p:sp>"
  )
}

/**
 * 预设形状的 XML。
 *
 * 用 `p:sp` + `a:prstGeom`：这是 PowerPoint 的原生形状，拖动缩放、改颜色、
 * 加动画都不受影响（图片或路径拼出来的形状会丢掉这些能力）。
 */
function shapeXml(input: {
  id: number
  kind: PptxShapeKind
  box: PptxBox
  fill?: string
  line?: string
  text?: string
  style?: PptxTextStyle
}): string {
  const { box } = input
  const geometry = '<a:prstGeom prst="' + input.kind + '"><a:avLst/></a:prstGeom>'
  const fill = input.fill
    ? '<a:solidFill><a:srgbClr val="' + encodeXml(input.fill.replace(/^#/, "").toUpperCase()) + '"/></a:solidFill>'
    : '<a:solidFill><a:schemeClr val="accent1"><a:lumMod val="20000"/><a:lumOff val="80000"/></a:schemeClr></a:solidFill>'
  // 线条形状本身是描边：默认给个深色，不然页面上什么都看不见。
  const lineColor = input.line?.replace(/^#/, "").toUpperCase() ?? (input.kind === "line" ? "404040" : undefined)
  const stroke = lineColor
    ? '<a:ln w="19050"><a:solidFill><a:srgbClr val="' + encodeXml(lineColor) + '"/></a:solidFill></a:ln>'
    : "<a:ln><a:noFill/></a:ln>"
  const body = input.text
    ? (() => {
        const rPr =
          patchRunProperties('<a:rPr lang="zh-CN" dirty="0"/>', input.style) ?? '<a:rPr lang="zh-CN" dirty="0"/>'
        return (
          '<p:txBody><a:bodyPr anchor="ctr" wrap="square"/><a:lstStyle/>' +
          input.text
            .split(/\r?\n/)
            .map(
              (row) =>
                "<a:p>" +
                paragraphProps({ align: "ctr", ...(input.style ?? {}) }) +
                (row.length === 0
                  ? ""
                  : "<a:r>" + rPr + '<a:t xml:space="preserve">' + encodeXml(row) + "</a:t></a:r>") +
                "</a:p>",
            )
            .join("") +
          "</p:txBody>"
        )
      })()
    : ""
  return (
    "<p:sp>" +
    "<p:nvSpPr>" +
    '<p:cNvPr id="' +
    input.id +
    '" name="' +
    encodeXml(SHAPE_NAMES[input.kind] + " " + input.id) +
    '"/>' +
    "<p:cNvSpPr/><p:nvPr/></p:nvSpPr>" +
    "<p:spPr>" +
    "<a:xfrm>" +
    '<a:off x="' +
    Math.round(box.x) +
    '" y="' +
    Math.round(box.y) +
    '"/>' +
    '<a:ext cx="' +
    Math.max(1, Math.round(box.w)) +
    '" cy="' +
    Math.max(1, Math.round(box.h)) +
    '"/>' +
    "</a:xfrm>" +
    geometry +
    (input.kind === "line" ? "" : fill) +
    stroke +
    "</p:spPr>" +
    body +
    "</p:sp>"
  )
}

/**
 * 结构操作：
 * - `addShape` 追加一个预设形状；
 * - `addTextBox` 在形状树末尾追加一个文本框（新页/空页也适用）；
 * - `deleteShape` 按 id/名称整块删掉——组合里的子形状不允许单独删除
 *   （删掉一个子形状会让组合的坐标映射失效），直接跳过。
 */
function applyShapeOps(xml: string, ops: readonly PptxShapeOp[]): string {
  let next = xml
  for (const op of ops) {
    if (op.op === "addShape") {
      const id = nextShapeId(next)
      const block = shapeXml({
        id,
        kind: op.kind,
        box: op.box ?? DEFAULT_SHAPE_BOX,
        ...(op.fill ? { fill: op.fill } : {}),
        ...(op.line ? { line: op.line } : {}),
        ...(op.text ? { text: op.text } : {}),
        ...(op.style ? { style: op.style } : {}),
      })
      const close = next.lastIndexOf("</p:spTree>")
      if (close === -1) continue
      next = next.slice(0, close) + block + next.slice(close)
      continue
    }

    if (op.op === "addTextBox") {
      const id = nextShapeId(next)
      const name = "文本框 " + id
      const block = textBoxXml({ id, name, box: op.box ?? DEFAULT_TEXT_BOX, text: op.text, style: op.style })
      const close = next.lastIndexOf("</p:spTree>")
      if (close === -1) continue
      next = next.slice(0, close) + block + next.slice(close)
      continue
    }

    // 新增图片由 applyAddPictures 处理（要写媒体和关系，不能在这里同步做）。
    if (op.op === "addPicture") continue

    const block = findBlock(scanBlocks(next), op)
    if (!block || block.parentId !== undefined) continue

    if (op.op === "renameShape") {
      // 只换 cNvPr 的 name：id、几何、文字和关系都不动。
      const body = next.slice(block.start, block.end)
      const patched = body.replace(/<p:cNvPr\b[^>]*>/, (tag) => {
        const cleaned = tag.replace(/\sname="[^"]*"/, "")
        return cleaned.replace(/\/?>$/, (tail) => ' name="' + encodeXml(op.name) + '"' + tail)
      })
      if (patched !== body) next = next.slice(0, block.start) + patched + next.slice(block.end)
      continue
    }

    next = next.slice(0, block.start) + next.slice(block.end)
  }
  return next
}

/** 改过文本的形状：清掉 autofit 上残留的缩放比例，让编辑器打开时自己重算字号。 */ function resetAutoFit(
  xml: string,
  shapeIds: Set<string>,
) {
  if (shapeIds.size === 0) return xml
  const targets = scanBlocks(xml).filter((block) => shapeIds.has(block.id))
  let next = xml
  for (const block of [...targets].sort((a, b) => b.start - a.start)) {
    const body = next.slice(block.start, block.end)
    const patched = body.replace(/<a:normAutofit\b([^>]*?)\/>/g, (_whole, attrs: string) => {
      const cleaned = attrs.replace(/\s(?:fontScale|lnSpcReduction)="[^"]*"/g, "").trimEnd()
      return cleaned ? "<a:normAutofit" + cleaned + "/>" : "<a:normAutofit/>"
    })
    if (patched === body) continue
    next = next.slice(0, block.start) + patched + next.slice(block.end)
  }
  return next
}

function paragraphStyle(xml: string, paragraph: ParagraphBlock): PptxTextStyle {
  const body = xml.slice(paragraph.start, paragraph.end)
  const style: PptxTextStyle = {}
  const align = body.match(/<a:pPr\b[^>]*\balgn="([a-z]+)"/)?.[1]
  if (align === "l" || align === "ctr" || align === "r" || align === "just") style.align = align
  const source = paragraph.runs[0]?.rPr ?? paragraphXmlSuffix(body)
  if (source) Object.assign(style, readRunStyle(source))
  return style
}

function readRunStyle(rPr: string): PptxTextStyle {
  const style: PptxTextStyle = {}
  const attrs = rPr.match(/^<a:(?:rPr|endParaRPr)\b([^>]*?)\/?>/)?.[1] ?? ""
  if (/\bb="(?:1|true)"/.test(attrs)) style.bold = true
  if (/\bi="(?:1|true)"/.test(attrs)) style.italic = true
  if (/\bu="(?:sng|dbl)"/.test(attrs)) style.underline = true
  const size = attrs.match(/\bsz="(\d+)"/)
  if (size) style.size = Number(size[1]) / 100
  const color = rPr.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/)
  if (color) style.color = (color[1] ?? "").toUpperCase()
  const font = rPr.match(/<a:latin typeface="([^"]*)"/)
  if (font) style.font = decodeXml(font[1] ?? "")
  return style
}

function encodeXml(input: string) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function decodeXml(input: string) {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_whole, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
}

/**
 * 演示顺序：`ppt/presentation.xml` 的 `<p:sldIdLst>` 决定页面顺序。
 *
 * 页面文件名（slideN.xml）**不一定**等于顺序：用户拖过页面、或用别的工具删过页，
 * 文件名就和显示顺序错开了。编辑时按顺序定位，写回的仍是同一个部件。
 * 清单读不出来时退回按文件名排序，至少不会把页弄丢。
 */
async function slideParts(zip: ZipArchive): Promise<string[]> {
  const fallback = zip.entries
    .map((item) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(item.name))
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((match) => match[0])

  const entry = zip.entries.find((item) => item.name === "ppt/presentation.xml")
  const relsEntry = zip.entries.find((item) => item.name === "ppt/_rels/presentation.xml.rels")
  if (!entry || !relsEntry) return fallback

  const xml = new TextDecoder().decode(await entryData(zip.bytes, entry))
  const list = /<p:sldIdLst\b[^>]*>([\s\S]*?)<\/p:sldIdLst>/.exec(xml)?.[1]
  if (!list) return fallback

  const rels = new TextDecoder().decode(await entryData(zip.bytes, relsEntry))
  const targets = new Map<string, string>()
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]*)"/.exec(match[0])?.[1]
    const target = /\bTarget="([^"]*)"/.exec(match[0])?.[1]
    if (id && target) targets.set(id, target)
  }

  const parts: string[] = []
  for (const match of list.matchAll(/<p:sldId\b[^>]*\br:id="([^"]*)"/g)) {
    const target = targets.get(match[1]!)
    if (target) parts.push(partNameOf(target))
  }
  return parts.length > 0 ? parts : fallback
}

/** rels 里的 Target（相对 ppt/，可能是绝对路径）→ 包内部件名。 */
function partNameOf(target: string): string {
  if (target.startsWith("/")) return target.slice(1)
  return ("ppt/" + target).replace(/\/\.\//g, "/")
}

/** 部件名 → 它的 .rels 名（`ppt/slides/slide1.xml` → `ppt/slides/_rels/slide1.xml.rels`）。 */
function relsNameOf(part: string): string {
  const slash = part.lastIndexOf("/")
  return part.slice(0, slash) + "/_rels/" + part.slice(slash + 1) + ".rels"
}

/** 一张空白幻灯片：只有空的形状树，版式通过 rels 关联。 */
/**
 * 版式名 → 版式信息。支持三种写法：显示名（`两栏内容`）、部件名
 * （`slideLayout2.xml`）和 1-based 序号。找不到时把可用版式列出来。
 */
async function resolveLayout(zip: ZipArchive, value: string): Promise<PptxLayoutInfo> {
  const layouts = await readLayouts(zip)
  const input = value.trim()
  if (layouts.length === 0) throw new Error("这个 PPTX 里没有版式（slideLayouts）")
  const index = Number(input)
  if (Number.isInteger(index) && index >= 1 && index <= layouts.length) return layouts[index - 1]!
  const lower = input.toLowerCase()
  const found =
    layouts.find((item) => item.name.toLowerCase() === lower) ??
    layouts.find((item) => item.part.toLowerCase() === lower) ??
    layouts.find((item) => "slidelayout" + lower + ".xml" === item.part.toLowerCase()) ??
    layouts.find((item) => item.name.toLowerCase().includes(lower))
  if (!found) {
    throw new Error(
      "找不到版式：" + input + "；可用：" + layouts.map((item) => item.name + "（" + item.part + "）").join("、"),
    )
  }
  return found
}

/** 从版式里挑出占位符形状，带进新页 —— 否则新页只是一张空画布。 */
async function layoutPlaceholderShapes(zip: ZipArchive, part: string): Promise<string> {
  const entry = zip.entries.find((item) => item.name === "ppt/slideLayouts/" + part)
  if (!entry) return ""
  const xml = new TextDecoder().decode(await entryData(zip.bytes, entry))
  const shapes: string[] = []
  let id = 2
  for (const match of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const shape = match[0]
    if (!shape.includes("<p:ph")) continue
    // 同一页里 cNvPr id 必须唯一；版式里的 id 复制过来会和新页自己的冲突。
    shapes.push(shape.replace(/(<p:cNvPr\b[^>]*?)\bid="\d+"/, (_all, head: string) => head + 'id="' + id++ + '"'))
  }
  return shapes.join("")
}

function blankSlideXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    "<p:cSld><p:spTree>" +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    "</p:spTree></p:cSld>" +
    "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
  )
}

/**
 * 新页用哪张版式：先看相邻那页的 slideLayout 关系（新页和它同一版式），
 * 找不到就用包里的第一张版式。
 */
async function slideLayoutTarget(
  zip: ZipArchive,
  additions: Map<string, Uint8Array>,
  sourcePart: string | undefined,
): Promise<string> {
  if (sourcePart) {
    const name = relsNameOf(sourcePart)
    const data =
      additions.get(name) ??
      (await (async () => {
        const entry = zip.entries.find((item) => item.name === name)
        return entry ? entryData(zip.bytes, entry) : undefined
      })())
    if (data) {
      const xml = new TextDecoder().decode(data)
      const match = /<Relationship\b[^>]*Type="[^"]*\/slideLayout"[^>]*>/.exec(xml)
      const target = match ? /\bTarget="([^"]*)"/.exec(match[0])?.[1] : undefined
      if (target) return target
    }
  }
  const layout = zip.entries
    .map((item) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.exec(item.name)?.[0])
    .filter((name): name is string => name !== undefined)
    .sort()[0]
  return layout ? "../" + layout.slice("ppt/".length) : "../slideLayouts/slideLayout1.xml"
}

/** 新页面部件在 [Content_Types].xml 里的 Override（slides 走 Override，不走 Default）。 */
async function ensureSlideContentType(
  zip: ZipArchive,
  additions: Map<string, Uint8Array>,
  replacements: Map<string, Uint8Array>,
  part: string,
): Promise<void> {
  const typesName = "[Content_Types].xml"
  const typesEntry = zip.entries.find((item) => item.name === typesName)
  const current = replacements.get(typesName) ?? additions.get(typesName)
  if (!typesEntry && !current) return
  const types = new TextDecoder().decode(current ?? (await entryData(zip.bytes, typesEntry!)))
  if (types.includes('PartName="/' + part + '"')) return
  const override =
    '<Override PartName="/' +
    part +
    '" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
  const next = /<\/Types>/.test(types)
    ? types.replace("</Types>", override + "</Types>")
    : types.replace(/<Types\b([^>]*)\/>/, "<Types$1>" + override + "</Types>")
  replacements.set(typesName, new TextEncoder().encode(next))
}

async function slideEntryName(zip: ZipArchive, slide: number, parts: readonly string[]) {
  const name = parts[slide - 1]
  if (!name) throw new Error("PPTX 里没有第 " + slide + " 页（共 " + parts.length + " 页）")
  return name
}

// ---------------------------------------------------------------------------
// ZIP 读写：只重写被改的条目，其余条目原样拷贝字节
// ---------------------------------------------------------------------------

export type ZipEntry = {
  name: string
  nameBytes: Uint8Array
  method: number
  flags: number
  crc: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
  extra: Uint8Array
  comment: Uint8Array
  /** 本地头的名字/扩展区长度可能与中央目录不同，必须各读各的 */
  localNameLength: number
  localExtraLength: number
}

export type ZipArchive = { bytes: Uint8Array; entries: ZipEntry[]; comment: Uint8Array }

export async function readZip(bytes: Uint8Array): Promise<ZipArchive> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEndOfCentralDirectory(view)
  if (eocd === -1) throw new Error("不是有效的 ZIP/PPTX 文件（找不到中央目录）")
  const count = view.getUint16(eocd + 10, true)
  const offset = view.getUint32(eocd + 16, true)
  if (offset === 0xffffffff || count === 0xffff) {
    throw new Error("暂不支持 ZIP64 的 PPTX（通常是单文件超过 4GB）")
  }
  const commentLength = view.getUint16(eocd + 20, true)
  const comment = bytes.slice(eocd + 22, eocd + 22 + commentLength)

  const entries: ZipEntry[] = []
  let cursor = offset
  for (let index = 0; index < count; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("中央目录损坏")
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const crc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentSize = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLength)
    const extra = bytes.slice(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength)
    const entryComment = bytes.slice(
      cursor + 46 + nameLength + extraLength,
      cursor + 46 + nameLength + extraLength + commentSize,
    )
    cursor += 46 + nameLength + extraLength + commentSize

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("本地文件头损坏")
    entries.push({
      name: new TextDecoder("utf-8", { fatal: false }).decode(nameBytes),
      nameBytes,
      method,
      flags,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
      extra,
      comment: entryComment,
      localNameLength: view.getUint16(localOffset + 26, true),
      localExtraLength: view.getUint16(localOffset + 28, true),
    })
  }
  return { bytes, entries, comment }
}

function findEndOfCentralDirectory(view: DataView) {
  const min = Math.max(0, view.byteLength - 0xffff - 22)
  for (let cursor = view.byteLength - 22; cursor >= min; cursor--) {
    if (view.getUint32(cursor, true) === 0x06054b50) return cursor
  }
  return -1
}

export async function entryData(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const start = entry.localOffset + 30 + entry.localNameLength + entry.localExtraLength
  const raw = bytes.slice(start, start + entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method !== 8) throw new Error("不支持的压缩方式 " + entry.method + "（" + entry.name + "）")
  return inflateRaw(raw)
}

async function inflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(raw)]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export function rebuildZip(
  zip: ZipArchive,
  replacements: Map<string, Uint8Array>,
  additions: Map<string, Uint8Array> = new Map(),
) {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of zip.entries) {
    const replacement = replacements.get(entry.name)
    if (replacement) {
      // 改动条目以 stored 形式写入：不重新压缩，内容可复现。
      const crc = crc32(replacement)
      const flags = entry.flags & ~0x8
      const record = concat([
        u32(0x04034b50),
        u16(20),
        u16(flags),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(replacement.length),
        u32(replacement.length),
        u16(entry.nameBytes.length),
        u16(entry.extra.length),
        entry.nameBytes,
        entry.extra,
        replacement,
      ])
      localParts.push(record)
      centralParts.push(
        concat([
          u32(0x02014b50),
          u16(20),
          u16(20),
          u16(flags),
          u16(0),
          u16(0),
          u16(0),
          u32(crc),
          u32(replacement.length),
          u32(replacement.length),
          u16(entry.nameBytes.length),
          u16(entry.extra.length),
          u16(entry.comment.length),
          u16(0),
          u16(0),
          u32(0),
          u32(offset),
          entry.nameBytes,
          entry.extra,
          entry.comment,
        ]),
      )
      offset += record.length
      continue
    }
    // 未改动的条目：连本地头一起原样拷贝，压缩流一个字节都不碰。
    const end = entry.localOffset + 30 + entry.localNameLength + entry.localExtraLength + entry.compressedSize
    const record = zip.bytes.slice(entry.localOffset, end)
    localParts.push(record)
    centralParts.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(entry.flags),
        u16(entry.method),
        u16(0),
        u16(0),
        u32(entry.crc),
        u32(entry.compressedSize),
        u32(entry.uncompressedSize),
        u16(entry.nameBytes.length),
        u16(entry.extra.length),
        u16(entry.comment.length),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        entry.nameBytes,
        entry.extra,
        entry.comment,
      ]),
    )
    offset += record.length
  }

  // 新增条目（图片替换新插入的媒体）：以 stored 形式追加在末尾。
  const added: Array<{ name: Uint8Array; data: Uint8Array; crc: number; offset: number }> = []
  for (const [name, data] of additions) {
    if (zip.entries.some((entry) => entry.name === name)) continue
    const nameBytes = new TextEncoder().encode(name)
    const crc = crc32(data)
    added.push({ name: nameBytes, data, crc, offset })
    const record = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ])
    localParts.push(record)
    offset += record.length
  }
  for (const entry of added) {
    centralParts.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(entry.crc),
        u32(entry.data.length),
        u32(entry.data.length),
        u16(entry.name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(entry.offset),
        entry.name,
      ]),
    )
  }

  const count = zip.entries.length + added.length
  const central = concat(centralParts)
  return concat([
    ...localParts,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(count),
    u16(count),
    u32(central.length),
    u32(offset),
    u16(zip.comment.length),
    zip.comment,
  ])
}

/**
 * 从零写一个 zip（新建文档用）。
 *
 * 和 `rebuildZip` 共用同一套 CRC / 头格式，条目一律以 stored 形式写：
 * 新建的是空模板，体积可以忽略，换来的是输出可复现（同样的输入 → 同样的字节）。
 */
export function buildZip(entries: ReadonlyArray<{ name: string; data: Uint8Array }>): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name)
    const crc = crc32(entry.data)
    const record = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      entry.data,
    ])
    localParts.push(record)
    centralParts.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(entry.data.length),
        u32(entry.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    )
    offset += record.length
  }
  const central = concat(centralParts)
  return concat([
    ...localParts,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function u16(value: number) {
  const data = new Uint8Array(2)
  new DataView(data.buffer).setUint16(0, value, true)
  return data
}

function u32(value: number) {
  const data = new Uint8Array(4)
  new DataView(data.buffer).setUint32(0, value >>> 0, true)
  return data
}

let crcTable: Uint32Array | undefined

function crc32(bytes: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let index = 0; index < 256; index++) {
      let value = index
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      crcTable[index] = value >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
