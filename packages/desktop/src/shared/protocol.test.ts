import { describe, expect, test } from "bun:test"
import { toLocalFileUrl } from "./protocol"

describe("local file preview URL", () => {
  test("converts Windows paths to the desktop protocol", () => {
    expect(toLocalFileUrl("file:///C:/Media/clip%20one.mp4")).toBe("oc-file://local/C:/Media/clip%20one.mp4")
  })

  test("converts UNC paths without changing the host", () => {
    expect(toLocalFileUrl("file://server/share/clip.mp4")).toBe("oc-file://local/server/share/clip.mp4")
  })

  test("converts POSIX paths", () => {
    expect(toLocalFileUrl("file:///Users/alex/Movies/clip.mp4")).toBe("oc-file://local/Users/alex/Movies/clip.mp4")
  })

  test("leaves non-file URLs unchanged", () => {
    expect(toLocalFileUrl("https://example.invalid/clip.mp4")).toBe("https://example.invalid/clip.mp4")
  })
})
