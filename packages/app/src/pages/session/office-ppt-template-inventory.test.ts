import { describe, expect, test } from "bun:test"
import JSZip from "jszip"
import type { OfficeArtifact } from "./office-artifact"
import { officePptTemplateFile, officePptTemplates } from "./office-export"
import { fillPptxTemplate, officePptTemplateSlideCount, officePptTemplateSlideShapes } from "./office-ppt-template-fill"

function artifact(): OfficeArtifact {
  return {
    body: "# 办公产物\n\n## 项目汇报\n\n- 完成本周交付",
    filename: "项目汇报.md",
    memory: "",
    slides: [
      { index: 1, title: "项目目标", content: "- 背景\n- 目标" },
      { index: 2, title: "推进计划", content: "- 节奏\n- 风险" },
      { index: 3, title: "下步动作", content: "- 确认资源\n- 启动试点" },
    ],
    title: "项目汇报",
  }
}

const templates = officePptTemplates.filter((item) => officePptTemplateFile(item.id))
const previewRoles = ["cover", "overview", "content", "cards", "data", "closing"]

describe("真实 PPTX 模板库", () => {
  test("登记了至少 20 套可导出真实模板", () => {
    expect(templates.length).toBeGreaterThanOrEqual(20)
  })

  test("全部真实模板都能解压并导出为完整 PPTX", async () => {
    for (const template of templates) {
      const path = officePptTemplateFile(template.id)
      if (!path) continue
      const filePath = path.startsWith("/") ? `public${path}` : path
      const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer())
      const zip = await JSZip.loadAsync(bytes)
      expect(zip.file("ppt/presentation.xml"), `${template.id} 缺少 presentation.xml`).toBeTruthy()
      expect(
        Object.keys(zip.files).some((name) => name.startsWith("ppt/slideMasters/") && name.endsWith(".xml")),
        `${template.id} 缺少幻灯片母版`,
      ).toBe(true)
      expect(
        Object.keys(zip.files).some((name) => name.startsWith("ppt/theme/") && name.endsWith(".xml")),
        `${template.id} 缺少主题`,
      ).toBe(true)
      const output = await fillPptxTemplate(bytes, artifact())
      expect(output.length, `${template.id} 导出结果为空`).toBeGreaterThan(1000)
      const outputZip = await JSZip.loadAsync(output)
      for (let slideIndex = 1; slideIndex <= 3; slideIndex++) {
        expect(
          outputZip.file(`ppt/slides/slide${slideIndex}.xml`),
          `${template.id} 缺少导出页面 slide${slideIndex}`,
        ).toBeTruthy()
        const slideRels = await outputZip.file(`ppt/slides/_rels/slide${slideIndex}.xml.rels`)?.async("string")
        expect(slideRels, `${template.id} slide${slideIndex} 缺少关系文件`).toBeTruthy()
        if (slideRels) assertSlideRelationshipsExist(outputZip, slideRels, template.id, slideIndex)
      }
      const contentTypes = await outputZip.file("[Content_Types].xml")?.async("string")
      expect(contentTypes).toContain("/ppt/slides/slide1.xml")
    }
  })

  test("全部真实模板都能返回源模板页数", async () => {
    for (const template of templates) {
      const path = officePptTemplateFile(template.id)
      if (!path) continue
      const filePath = path.startsWith("/") ? `public${path}` : path
      const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer())
      const count = await officePptTemplateSlideCount(bytes)
      expect(count, `${template.id} 源页数应为正数`).toBeGreaterThan(0)
    }
  })

  test("全部真实模板都有完整逐页预览", async () => {
    for (const template of templates) {
      const preview = template.preview
      if (!preview) continue
      const base = preview.replace(/\/cover\.jpg$/, "")
      for (const role of previewRoles) {
        const file = Bun.file(`public${base}/${role}.jpg`)
        expect(await file.exists(), `${template.id} 缺少 ${role}.jpg`).toBe(true)
      }
    }
  })

  test("全部真实模板的每种页面角色都能解析出可编辑对象", async () => {
    for (const template of templates) {
      const path = officePptTemplateFile(template.id)
      if (!path) continue
      const filePath = path.startsWith("/") ? `public${path}` : path
      const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer())
      for (const role of previewRoles) {
        const shapes = await officePptTemplateSlideShapes(template.id, role, bytes)
        expect(shapes.length, `${template.id} ${role} 无可编辑对象`).toBeGreaterThan(0)
      }
    }
  })
})

function assertSlideRelationshipsExist(zip: JSZip, relsXml: string, templateId: string, slideIndex: number) {
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*Target="([^"]+)"/g)) {
    const target = match[1] ?? ""
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue
    const resolved = target.startsWith("../")
      ? `ppt/${target.replace(/^\.\.\//, "")}`
      : target.startsWith("/")
        ? target.slice(1)
        : target
    expect(zip.file(resolved), `${templateId} slide${slideIndex} 关系目标缺失：${resolved}`).toBeTruthy()
  }
}
