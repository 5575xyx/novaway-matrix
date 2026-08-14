import { describe, expect, test } from "bun:test"
import { createOfficeArtifactRevisionPrompt } from "./office-artifact-revise"

describe("createOfficeArtifactRevisionPrompt", () => {
  test("keeps the artifact context and asks for structured continuation", () => {
    const artifact = {
      title: "产品周报",
      body: "# 办公产物\n\n## 本周进展\n- 完成 A 模块",
      memory: "",
      slides: [],
      filename: "产品周报.md",
    }
    const prompt = createOfficeArtifactRevisionPrompt(artifact)

    expect(prompt).toContain("产品周报")
    expect(prompt).toContain("本周进展")
    expect(prompt).toContain("继续修改")
    expect(prompt).toContain("结构化办公产物契约")
  })
})
