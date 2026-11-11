import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const component = readFileSync(join(import.meta.dir, "file-preview-binary-content.tsx"), "utf8")
const tabs = readFileSync(join(import.meta.dir, "file-tabs.tsx"), "utf8")
const fileContext = readFileSync(join(import.meta.dir, "../../context/file.tsx"), "utf8")

describe("media preview recovery", () => {
  test("audio and video errors request a ticket refresh", () => {
    expect(component.match(/onError=\{\(\) => props\.onMediaError\?\.\(\)\}/g)).toHaveLength(2)
  })

  test("ticket refresh is limited to one retry for the current media path", () => {
    expect(tabs).toContain("file.isExternal(current) ||")
    expect(tabs).toContain("mediaTicket()?.refreshed ||")
    expect(tabs).toContain("setMediaTicket({ path: current, ticket: payload.ticket, refreshed: true })")
    expect(tabs).toContain("onMediaError={refreshMediaTicket}")
  })

  test("a watcher update for a media path changes the media URL revision", () => {
    expect(fileContext).toContain("revision: (input: string) => revision[path.normalize(input)] ?? 0")
    expect(tabs).toContain('url.searchParams.set("revision", String(mediaRevision()))')
  })

  test("external desktop media uses the local range-capable preview protocol", () => {
    expect(tabs).toContain("platform.toPreviewUrl?.(localUrl) ?? localUrl")
    expect(tabs).toContain("if (file.isExternal(current))")
    expect(tabs).toContain("ticket?.path !== current || !ticket")
  })

  test("project files use installed editors only with a local desktop connection", () => {
    expect(tabs).toContain('platform.platform !== "desktop" || !platform.getInstalledEditors')
    expect(tabs).toContain("!p || file.isExternal(p) || !platform.openInEditor || !server.isLocal() || !connection")
    expect(tabs).toContain('platform.openInEditor(editorId, absolute, "file", connection)')
    expect(tabs).toContain("if (!file.isExternal(p))")
    const header = readFileSync(join(import.meta.dir, "file-preview-header.tsx"), "utf8")
    expect(header).toContain("props.onOpenNative || (props.openNativeMenu?.length ?? 0) > 0")
    expect(tabs).toContain("openNativeMenu={officeNativeMenu()}")
  })
})
