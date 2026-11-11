import { afterEach, describe, expect, test } from "bun:test"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { PtyPaths } from "../../src/server/routes/instance/httpapi/groups/pty"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { PtyID } from "../../src/pty/schema"
import { File } from "../../src/file"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import * as Log from "@novaway/core/util/log"

void Log.init({ print: false })

function app(input: { password?: string; username?: string }) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            NOVAWAY_SERVER_PASSWORD: input.password,
            NOVAWAY_SERVER_USERNAME: input.username,
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler

  return {
    fetch: (request: Request) => handler(request, HttpApiApp.context),
    request(input: string | URL | Request, init?: RequestInit) {
      return this.fetch(input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init))
    },
  }
}

function basic(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

async function cancelBody(response: Response) {
  await response.body?.cancel().catch(() => {})
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("HttpApi raw route authorization", () => {
  test("serves media tickets and ranges without Basic Auth after ticket minting", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    await Bun.write(`${tmp.path}/clip.mp4`, "0123456789")
    const server = app({ password: "secret" })
    const headers = { "x-novaway-directory": tmp.path, authorization: basic("novaway", "secret") }
    const tokenURL = new URL(PtyPaths.mediaToken, "http://localhost")
    tokenURL.searchParams.set("path", "clip.mp4")
    tokenURL.searchParams.set("directory", tmp.path)
    const tokenResponse = await server.request(tokenURL, { method: "POST", headers })
    expect(tokenResponse.status).toBe(200)
    const token = (await tokenResponse.json()) as { ticket: string }
    const response = await server.request(`${File.MEDIA_PREVIEW_PATH}?path=clip.mp4&ticket=${token.ticket}`, {
      headers: { "x-novaway-directory": tmp.path, range: "bytes=2-5" },
    })
    expect(response.status).toBe(206)
    expect(await response.text()).toBe("2345")
    const missingTicket = await server.request(`${File.MEDIA_PREVIEW_PATH}?path=clip.mp4`, {
      headers: { "x-novaway-directory": tmp.path },
    })
    expect(missingTicket.status).toBe(401)
  })

  test("requires configured auth before opening the raw instance event stream", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const server = app({ password: "secret" })
    const headers = { "x-novaway-directory": tmp.path }

    const missing = await server.request(EventPaths.event, { headers })
    await cancelBody(missing)
    expect(missing.status).toBe(401)

    const authed = await server.request(EventPaths.event, {
      headers: { ...headers, authorization: basic("novaway", "secret") },
    })
    await cancelBody(authed)
    expect(authed.status).toBe(200)
  })

  test("requires configured auth before resolving the raw PTY websocket route", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const server = app({ password: "secret" })
    const route = PtyPaths.connect.replace(":ptyID", PtyID.ascending())
    const headers = { "x-novaway-directory": tmp.path }

    const missing = await server.request(route, { headers })
    await cancelBody(missing)
    expect(missing.status).toBe(401)

    const authed = await server.request(route, {
      headers: { ...headers, authorization: basic("novaway", "secret") },
    })
    await cancelBody(authed)
    expect(authed.status).toBe(404)
  })
})
