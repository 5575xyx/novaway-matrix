export * from "./client.js"
export * from "./server.js"

import { createNovawayClient } from "./client.js"
import { createNovawayServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createNovaway(options?: ServerOptions) {
  const server = await createNovawayServer({
    ...options,
  })

  const client = createNovawayClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
