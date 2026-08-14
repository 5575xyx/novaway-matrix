import type { OfficeArtifact } from "./office-artifact"

export function createOfficeArtifactRevisionPrompt(artifact: OfficeArtifact) {
  return [
    `请继续修改办公产物「${artifact.title}」。`,
    "",
    "当前办公产物：",
    artifact.body,
    "",
    "请基于当前内容继续修改或补充，并仍按结构化办公产物契约输出新的完整正文。",
  ].join("\n")
}
