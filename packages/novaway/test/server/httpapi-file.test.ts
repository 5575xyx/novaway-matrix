import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import path from "path"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import { PtyPaths } from "../../src/server/routes/instance/httpapi/groups/pty"
import { File } from "../../src/file"
import * as Log from "@novaway/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>

function request(
  route: string,
  directory: string,
  query?: Record<string, string>,
  headers?: Record<string, string>,
  method = "GET",
) {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
  return HttpApiApp.webHandler().handler(
    new Request(url, {
      method,
      headers: {
        "x-novaway-directory": directory,
        ...headers,
      },
    }),
    context,
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("file HttpApi", () => {
  test("serves read endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "hello")

    const [list, content, status] = await Promise.all([
      request(FilePaths.list, tmp.path, { path: "." }),
      request(FilePaths.content, tmp.path, { path: "hello.txt" }),
      request(FilePaths.status, tmp.path),
    ])

    expect(list.status).toBe(200)
    expect(await list.json()).toContainEqual(
      expect.objectContaining({ name: "hello.txt", path: "hello.txt", type: "file" }),
    )

    expect(content.status).toBe(200)
    expect(await content.json()).toMatchObject({ type: "text", content: "hello" })

    expect(status.status).toBe(200)
    expect(await status.json()).toContainEqual({ path: "hello.txt", added: 1, removed: 0, status: "added" })
  })

  test("serves media byte ranges with a short-lived ticket", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "clip.mp4"), "0123456789")

    const tokenResponse = await request(
      PtyPaths.mediaToken,
      tmp.path,
      { path: "clip.mp4", directory: tmp.path },
      undefined,
      "POST",
    )
    expect(tokenResponse.status).toBe(200)
    const token = (await tokenResponse.json()) as { ticket: string }
    const response = await request(
      File.MEDIA_PREVIEW_PATH,
      tmp.path,
      { path: "clip.mp4", ticket: token.ticket },
      { range: "bytes=2-5" },
      "GET",
    )
    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10")
    expect(response.headers.get("accept-ranges")).toBe("bytes")
    expect(await response.text()).toBe("2345")

    const invalidTokenResponse = await request(
      PtyPaths.mediaToken,
      tmp.path,
      { path: "clip.mp4", directory: tmp.path },
      undefined,
      "POST",
    )
    const invalidToken = (await invalidTokenResponse.json()) as { ticket: string }
    const invalid = await request(
      File.MEDIA_PREVIEW_PATH,
      tmp.path,
      { path: "clip.mp4", ticket: invalidToken.ticket },
      { range: "bytes=0-1,4-5" },
      "GET",
    )
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get("content-range")).toBe("bytes */*")

    const invalidNumber = await request(
      File.MEDIA_PREVIEW_PATH,
      tmp.path,
      { path: "clip.mp4", ticket: token.ticket },
      { range: "bytes=9007199254740992-" },
    )
    expect(invalidNumber.status).toBe(416)

    const suffix = await request(
      File.MEDIA_PREVIEW_PATH,
      tmp.path,
      { path: "clip.mp4", ticket: token.ticket },
      { range: "bytes=-4" },
      "GET",
    )
    expect(suffix.status).toBe(206)
    expect(suffix.headers.get("content-range")).toBe("bytes 6-9/10")
    expect(await suffix.text()).toBe("6789")

    const pastEnd = await request(
      File.MEDIA_PREVIEW_PATH,
      tmp.path,
      { path: "clip.mp4", ticket: token.ticket },
      { range: "bytes=8-99" },
      "GET",
    )
    expect(pastEnd.status).toBe(206)
    expect(pastEnd.headers.get("content-range")).toBe("bytes 8-9/10")
    expect(await pastEnd.text()).toBe("89")

    await Bun.write(path.join(tmp.path, "removed.mp4"), "0123456789")
    const removedTokenResponse = await request(
      PtyPaths.mediaToken,
      tmp.path,
      { path: "removed.mp4", directory: tmp.path },
      undefined,
      "POST",
    )
    const removedToken = (await removedTokenResponse.json()) as { ticket: string }
    await Bun.file(path.join(tmp.path, "removed.mp4")).delete()
    const removed = await request(
      File.MEDIA_PREVIEW_PATH,
      tmp.path,
      { path: "removed.mp4", ticket: removedToken.ticket },
      { range: "bytes=0-1" },
    )
    expect(removed.status).toBe(404)

    await Bun.write(path.join(tmp.path, "empty.mp4"), "")
    const emptyTokenResponse = await request(
      PtyPaths.mediaToken,
      tmp.path,
      { path: "empty.mp4", directory: tmp.path },
      undefined,
      "POST",
    )
    expect(emptyTokenResponse.status).toBe(200)
    const emptyToken = (await emptyTokenResponse.json()) as { ticket: string }
    const empty = await request(
      File.MEDIA_PREVIEW_PATH,
      tmp.path,
      { path: "empty.mp4", ticket: emptyToken.ticket },
      { range: "bytes=0-" },
    )
    expect(empty.status).toBe(416)
    expect(empty.headers.get("content-range")).toBe("bytes */0")

    const zeroSuffix = await request(
      File.MEDIA_PREVIEW_PATH,
      tmp.path,
      { path: "clip.mp4", ticket: token.ticket },
      { range: "bytes=-0" },
    )
    expect(zeroSuffix.status).toBe(416)
    expect(zeroSuffix.headers.get("content-range")).toBe("bytes */10")
  })

  test("serves search endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "needle")

    const [text, files, symbols] = await Promise.all([
      request(FilePaths.findText, tmp.path, { pattern: "needle" }),
      request(FilePaths.findFile, tmp.path, { query: "hello", type: "file" }),
      request(FilePaths.findSymbol, tmp.path, { query: "hello" }),
    ])

    expect(text.status).toBe(200)
    expect(await text.json()).toContainEqual(expect.objectContaining({ line_number: 1 }))

    expect(files.status).toBe(200)
    expect(await files.json()).toContain("hello.txt")

    expect(symbols.status).toBe(200)
    expect(await symbols.json()).toEqual([])
  })

  test("writes text file content", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "before")

    const url = new URL(`http://localhost${FilePaths.write}`)
    const res = await HttpApiApp.webHandler().handler(
      new Request(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-novaway-directory": tmp.path,
        },
        body: JSON.stringify({ path: "hello.txt", content: "after" }),
      }),
      context,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toBe(true)
    expect(await Bun.file(path.join(tmp.path, "hello.txt")).text()).toBe("after")
  })
})
