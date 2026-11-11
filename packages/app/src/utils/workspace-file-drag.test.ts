import { describe, expect, test } from "bun:test"
import {
  WORKSPACE_FILE_DRAG_MIME,
  parseWorkspaceFileDragPayload,
  readWorkspaceFileDragPayload,
  serializeWorkspaceFileDragPayload,
} from "./workspace-file-drag"

function fakeDataTransfer(types: string[], data: Record<string, string>): DataTransfer {
  return {
    types,
    getData: (format: string) => data[format] ?? "",
  } as unknown as DataTransfer
}

describe("workspace file drag payload", () => {
  test("serializes and parses a directory payload", () => {
    const payload = { type: "directory" as const, path: "src/components", name: "components" }
    expect(parseWorkspaceFileDragPayload(serializeWorkspaceFileDragPayload(payload))).toEqual(payload)
  })

  test("rejects malformed payloads", () => {
    expect(parseWorkspaceFileDragPayload(null)).toBeNull()
    expect(parseWorkspaceFileDragPayload("not json")).toBeNull()
    expect(parseWorkspaceFileDragPayload(JSON.stringify({ type: "file", path: "" }))).toBeNull()
    expect(parseWorkspaceFileDragPayload(JSON.stringify({ type: "link", path: "a", name: "a" }))).toBeNull()
    expect(parseWorkspaceFileDragPayload(JSON.stringify([]))).toBeNull()
  })

  test("reads only when the custom MIME is present", () => {
    const data = { [WORKSPACE_FILE_DRAG_MIME]: JSON.stringify({ type: "file", path: "a.ts", name: "a.ts" }) }
    expect(readWorkspaceFileDragPayload(fakeDataTransfer([WORKSPACE_FILE_DRAG_MIME], data))).toEqual({
      type: "file",
      path: "a.ts",
      name: "a.ts",
    })
    expect(readWorkspaceFileDragPayload(fakeDataTransfer(["text/plain"], data))).toBeNull()
    expect(readWorkspaceFileDragPayload(null)).toBeNull()
  })
})
