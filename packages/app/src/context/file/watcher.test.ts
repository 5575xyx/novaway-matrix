import { describe, expect, test } from "bun:test"
import {
  invalidateFromWatcher,
  isPreviewRefreshPath,
  nextMediaRevision,
  nextPreviewRevision,
  shouldReloadOfficePreview,
} from "./watcher"

describe("media watcher revision", () => {
  test("increments only while the media file is open", () => {
    expect(nextMediaRevision(0, true)).toBe(1)
    expect(nextMediaRevision(4, true)).toBe(5)
    expect(nextMediaRevision(4, false)).toBe(4)
  })
})

describe("Office preview watcher revision", () => {
  test("recognizes Office and image files but not regular text files", () => {
    expect(
      isPreviewRefreshPath(
        "report.docx",
        (path) => path.endsWith(".docx"),
        (path) => path.endsWith(".png"),
      ),
    ).toBe(true)
    expect(
      isPreviewRefreshPath(
        "photo.png",
        (path) => path.endsWith(".docx"),
        (path) => path.endsWith(".png"),
      ),
    ).toBe(true)
    expect(
      isPreviewRefreshPath(
        "notes.md",
        (path) => path.endsWith(".docx"),
        (path) => path.endsWith(".png"),
      ),
    ).toBe(false)
  })

  test("increments only while an Office preview is open", () => {
    expect(nextPreviewRevision(0, true)).toBe(1)
    expect(nextPreviewRevision(3, true)).toBe(4)
    expect(nextPreviewRevision(3, false)).toBe(3)
  })

  test("reloads on a changed revision but not on first read or inactive files", () => {
    expect(shouldReloadOfficePreview({ target: "report.docx", watcherRevision: 0 })).toBe(false)
    expect(
      shouldReloadOfficePreview({
        target: "report.docx",
        watcherRevision: 2,
        previousWatcherRevision: 2,
      }),
    ).toBe(false)
    expect(
      shouldReloadOfficePreview({
        target: "report.docx",
        watcherRevision: 3,
        previousWatcherRevision: 2,
      }),
    ).toBe(true)
    expect(shouldReloadOfficePreview({ watcherRevision: 1, previousWatcherRevision: 0 })).toBe(false)
    expect(shouldReloadOfficePreview({ target: "report.docx", livePath: "report.docx", watcherRevision: 0 })).toBe(true)
  })
})

describe("file watcher invalidation", () => {
  test("reloads open files and refreshes loaded parent on add", () => {
    const loads: string[] = []
    const refresh: string[] = []
    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src/new.ts",
          event: "add",
        },
      },
      {
        normalize: (input) => input,
        hasFile: (path) => path === "src/new.ts",
        loadFile: (path) => loads.push(path),
        node: () => undefined,
        isDirLoaded: (path) => path === "src",
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(loads).toEqual(["src/new.ts"])
    expect(refresh).toEqual(["src"])
  })

  test("reloads files that are open in tabs", () => {
    const loads: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src/open.ts",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        hasFile: () => false,
        isOpen: (path) => path === "src/open.ts",
        loadFile: (path) => loads.push(path),
        node: () => ({
          path: "src/open.ts",
          type: "file",
          name: "open.ts",
          absolute: "/repo/src/open.ts",
          ignored: false,
        }),
        isDirLoaded: () => false,
        refreshDir: () => {},
      },
    )

    expect(loads).toEqual(["src/open.ts"])
  })

  test("refreshes only changed loaded directory nodes", () => {
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        hasFile: () => false,
        loadFile: () => {},
        node: () => ({ path: "src", type: "directory", name: "src", absolute: "/repo/src", ignored: false }),
        isDirLoaded: (path) => path === "src",
        refreshDir: (path) => refresh.push(path),
      },
    )

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src/file.ts",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        hasFile: () => false,
        loadFile: () => {},
        node: () => ({
          path: "src/file.ts",
          type: "file",
          name: "file.ts",
          absolute: "/repo/src/file.ts",
          ignored: false,
        }),
        isDirLoaded: () => true,
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(refresh).toEqual(["src"])
  })

  test("ignores invalid or git watcher updates", () => {
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: ".git/index.lock",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        hasFile: () => true,
        loadFile: () => {
          throw new Error("should not load")
        },
        node: () => undefined,
        isDirLoaded: () => true,
        refreshDir: (path) => refresh.push(path),
      },
    )

    invalidateFromWatcher(
      {
        type: "project.updated",
        properties: {},
      },
      {
        normalize: (input) => input,
        hasFile: () => false,
        loadFile: () => {},
        node: () => undefined,
        isDirLoaded: () => true,
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(refresh).toEqual([])
  })

  test("refreshes parent directory for Windows paths with backslashes", () => {
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "C:\\repo\\src\\new.ts",
          event: "add",
        },
      },
      {
        normalize: (input) => input.replace(/^C:\\repo\\/, ""),
        hasFile: () => false,
        loadFile: () => {},
        node: () => undefined,
        isDirLoaded: (path) => path === "src",
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(refresh).toEqual(["src"])
  })
})
