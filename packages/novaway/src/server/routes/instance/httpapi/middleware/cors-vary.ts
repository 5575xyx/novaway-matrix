import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

// effect-smol's HttpMiddleware.cors builds OPTIONS preflight responses by
// spreading allowOrigin() and allowHeaders() into the same record. Both set
// the `vary` key, so allowHeaders' `Vary: Access-Control-Request-Headers`
// overwrites allowOrigin's `Vary: Origin`. With dynamic origin echoing, the
// missing `Vary: Origin` lets shared caches reuse a preflight cached for one
// origin against a different origin.
//
// TODO: upstream a fix that merges Vary values in headersFromRequestOptions
// (packages/effect/src/unstable/http/HttpMiddleware.ts ~line 332).
export const corsVaryFix = HttpRouter.middleware(
  (effect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const response = yield* effect

      // Electron's `oc://renderer` page is a secure custom origin. Chromium's
      // Local Network Access check therefore adds
      // `Access-Control-Request-Private-Network` when the renderer calls the
      // loopback sidecar. Without the matching response header Chromium
      // rejects the actual POST as a generic `Failed to fetch`, even though
      // the server returned a valid 204 preflight response.
      if (request.headers["access-control-request-private-network"] === "true") {
        return HttpServerResponse.setHeader(response, "access-control-allow-private-network", "true")
      }

      const allowOrigin = response.headers["access-control-allow-origin"]
      if (!allowOrigin || allowOrigin === "*") return response

      const vary = response.headers["vary"]
      if (!vary) return HttpServerResponse.setHeader(response, "vary", "Origin")

      const tokens = vary.split(",").map((s) => s.trim().toLowerCase())
      if (tokens.includes("origin") || tokens.includes("*")) return response

      return HttpServerResponse.setHeader(response, "vary", `${vary}, Origin`)
    }),
  { global: true },
)
