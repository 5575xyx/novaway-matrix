/**
 * 图片编辑的纯几何/编码助手（与 DOM 组件解耦，便于单测）：
 * 旋转 / 翻转 / 裁剪都在离屏 canvas 上重编码成 base64。
 */

export type CropRect = { x: number; y: number; w: number; h: number }

export function mimeOf(path: string): string {
  const lower = path.toLowerCase()
  const ext = lower.slice(lower.lastIndexOf(".") + 1)
  if (ext === "svg") return "image/svg+xml"
  if (ext === "jpg") return "image/jpeg"
  return `image/${ext}`
}

/** 旋转 n 个 90°（顺时针）后保持原图内容，画布尺寸按 90/270 对调。 */
export function drawRotated(img: HTMLImageElement, quarters: number): HTMLCanvasElement {
  const swap = ((quarters % 2) + 2) % 2 === 1
  const canvas = document.createElement("canvas")
  canvas.width = swap ? img.naturalHeight : img.naturalWidth
  canvas.height = swap ? img.naturalWidth : img.naturalHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) return canvas
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((quarters * Math.PI) / 2)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  return canvas
}

export function drawFlipped(img: HTMLImageElement, flipH: boolean, flipV: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) return canvas
  ctx.translate(flipH ? canvas.width : 0, flipV ? canvas.height : 0)
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
  ctx.drawImage(img, 0, 0)
  return canvas
}

/** 裁剪：把选中的矩形区域放大到整幅新图。 */
export function drawCropped(img: HTMLImageElement, rect: CropRect): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(rect.w))
  canvas.height = Math.max(1, Math.round(rect.h))
  const ctx = canvas.getContext("2d")
  if (ctx) ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** 画布重新编码成 base64（去掉 dataURL 前缀）。 */
export function canvasToBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL().split(",")[1] ?? ""
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("图片解码失败"))
    img.src = src
  })
}

export type AnnotateTool = "pen" | "highlighter" | "arrow" | "text" | "rect" | "circle"
export type Stroke = { tool: AnnotateTool; color: string; size: number; points: Array<[number, number]>; text?: string }

/** 把一条笔画按工具类型画到 canvas 上。 */
export function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const { tool, color, size, points } = stroke
  ctx.strokeStyle = color
  ctx.lineWidth = size
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.fillStyle = color
  if (tool === "text") {
    ctx.font = `${Math.round(size * 2)}px system-ui, sans-serif`
    const [x, y] = points[0] ?? [0, 0]
    ctx.fillText(stroke.text ?? "", x, y)
    return
  }
  if (tool === "rect" || tool === "circle") {
    const [x0, y0] = points[0] ?? [0, 0]
    const [x1, y1] = points[1] ?? [x0, y0]
    const x = Math.min(x0, x1)
    const y = Math.min(y0, y1)
    const w = Math.abs(x1 - x0)
    const h = Math.abs(y1 - y0)
    if (tool === "rect") ctx.strokeRect(x, y, w, h)
    else {
      ctx.beginPath()
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    return
  }
  if (tool === "arrow") {
    const [x0, y0] = points[0] ?? [0, 0]
    const [x1, y1] = points[1] ?? [x0, y0]
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    const angle = Math.atan2(y1 - y0, x1 - x0)
    const head = Math.max(8, size * 2)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 - head * Math.cos(angle - Math.PI / 6), y1 - head * Math.sin(angle - Math.PI / 6))
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 - head * Math.cos(angle + Math.PI / 6), y1 - head * Math.sin(angle + Math.PI / 6))
    ctx.stroke()
    return
  }
  if (points.length === 1) {
    const [x, y] = points[0]
    ctx.fillRect(x - size / 2, y - size / 2, size, size)
    return
  }
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1])
  ctx.stroke()
}
