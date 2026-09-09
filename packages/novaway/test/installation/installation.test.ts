import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"
import { InstallationChannel } from "@novaway/core/installation/version"
import { AppProcess } from "@novaway/core/process"
import { testEffect } from "../lib/effect"

const encoder = new TextEncoder()

function mockHttpClient(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

type SpawnResponse = string | { stdout?: string; stderr?: string; exitCode?: number }

function mockSpawner(handler: (cmd: string, args: readonly string[]) => SpawnResponse = () => "") {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const response = handler(std?.command ?? "", std?.args ?? [])
    const output = typeof response === "string" ? { stdout: response } : response
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(output.exitCode ?? 0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output.stdout ? Stream.make(encoder.encode(output.stdout)) : Stream.empty,
        stderr: output.stderr ? Stream.make(encoder.encode(output.stderr)) : Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function testLayer(
  httpHandler: (request: HttpClientRequest.HttpClientRequest) => Response,
  spawnHandler?: (cmd: string, args: readonly string[]) => SpawnResponse,
) {
  const appProcess = AppProcess.layer.pipe(Layer.provide(mockSpawner(spawnHandler)))
  return Installation.layer.pipe(Layer.provide(mockHttpClient(httpHandler)), Layer.provide(appProcess))
}

describe("installation", () => {
  describe("latest", () => {
    testEffect(testLayer(() => jsonResponse({ tag_name: "v1.2.3" }))).effect(
      "reads release version from GitHub releases",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.Service.use((svc) => svc.latest("unknown"))
          expect(result).toBe("1.2.3")
        }),
    )

    testEffect(testLayer(() => jsonResponse({ tag_name: "v4.0.0-beta.1" }))).effect(
      "strips v prefix from GitHub release tag",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.Service.use((svc) => svc.latest("curl"))
          expect(result).toBe("4.0.0-beta.1")
        }),
    )

    const npmCalls: string[] = []
    testEffect(
      testLayer((request) => {
        npmCalls.push(request.url)
        return jsonResponse({ version: "1.5.0" })
      }),
    ).effect("reads npm versions via registry", () =>
      Effect.gen(function* () {
        const result = yield* Installation.Service.use((svc) => svc.latest("npm"))
        expect(result).toBe("1.5.0")
        // registry host 随用户 .npmrc 走（本机可能是 npmmirror），只断言路径
        expect(npmCalls.some((u) => u.endsWith(`/${Installation.NPM_PACKAGE}/${InstallationChannel}`))).toBe(true)
      }),
    )

    const bunCalls: string[] = []
    testEffect(
      testLayer((request) => {
        bunCalls.push(request.url)
        return jsonResponse({ version: "1.6.0" })
      }),
    ).effect("reads bun versions via registry", () =>
      Effect.gen(function* () {
        const result = yield* Installation.Service.use((svc) => svc.latest("bun"))
        expect(result).toBe("1.6.0")
        expect(bunCalls.some((u) => u.endsWith(`/${Installation.NPM_PACKAGE}/${InstallationChannel}`))).toBe(true)
      }),
    )

    const pnpmCalls: string[] = []
    testEffect(
      testLayer((request) => {
        pnpmCalls.push(request.url)
        return jsonResponse({ version: "1.7.0" })
      }),
    ).effect("reads pnpm versions via registry", () =>
      Effect.gen(function* () {
        const result = yield* Installation.Service.use((svc) => svc.latest("pnpm"))
        expect(result).toBe("1.7.0")
        expect(pnpmCalls.some((u) => u.endsWith(`/${Installation.NPM_PACKAGE}/${InstallationChannel}`))).toBe(true)
      }),
    )

    testEffect(testLayer(() => jsonResponse({ version: "2.3.4" }))).effect("reads scoop manifest versions", () =>
      Effect.gen(function* () {
        const result = yield* Installation.Service.use((svc) => svc.latest("scoop"))
        expect(result).toBe("2.3.4")
      }),
    )

    testEffect(testLayer(() => jsonResponse({ d: { results: [{ Version: "3.4.5" }] } }))).effect(
      "reads chocolatey feed versions",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.Service.use((svc) => svc.latest("choco"))
          expect(result).toBe("3.4.5")
        }),
    )

    testEffect(
      testLayer(
        () => jsonResponse({ versions: { stable: "2.0.0" } }),
        (cmd, args) => {
          // getBrewFormula: return core formula (no tap)
          if (cmd === "brew" && args.includes("--formula") && args.includes("anomalyco/tap/NovaWay")) return ""
          if (cmd === "brew" && args.includes("--formula") && args.includes("novaway")) return "novaway"
          return ""
        },
      ),
    ).effect("reads brew formulae API versions", () =>
      Effect.gen(function* () {
        const result = yield* Installation.Service.use((svc) => svc.latest("brew"))
        expect(result).toBe("2.0.0")
      }),
    )

    const brewInfoJson = JSON.stringify({
      formulae: [{ versions: { stable: "2.1.0" } }],
    })
    testEffect(
      testLayer(
        () => jsonResponse({}), // HTTP not used for tap formula
        (cmd, args) => {
          if (cmd === "brew" && args.includes("anomalyco/tap/NovaWay") && args.includes("--formula")) return "novaway"
          if (cmd === "brew" && args.includes("--json=v2")) return brewInfoJson
          return ""
        },
      ),
    ).effect("reads brew tap info JSON via CLI", () =>
      Effect.gen(function* () {
        const result = yield* Installation.Service.use((svc) => svc.latest("brew"))
        expect(result).toBe("2.1.0")
      }),
    )

    testEffect(
      testLayer(
        () => jsonResponse({}),
        (cmd) => (cmd === "npm.cmd" ? { exitCode: 1, stderr: "npm ERR! EACCES permission denied" } : ""),
      ),
    ).effect("preserves package manager stderr when upgrade fails", () =>
      Effect.gen(function* () {
        const exit = yield* Installation.Service.use((svc) => svc.upgrade("npm", "0.1.9").pipe(Effect.exit))
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause)
          expect(error).toMatchObject({ stderr: "npm ERR! EACCES permission denied" })
        }
      }),
    )
  })
})
