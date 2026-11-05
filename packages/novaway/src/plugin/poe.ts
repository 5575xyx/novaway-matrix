import type { Hooks, PluginInput } from "@novaway/plugin"
import open from "open"
import { createOAuthClient } from "poe-oauth"

// Poe 的公开 OAuth 客户端标识（poe-oauth 官方示例里用的同一个）。
const POE_CLIENT_ID = "client_728290227fc048cc9262091a1ea197ea"

function expiry(expiresIn: number | null | undefined) {
  if (expiresIn == null) return Number.MAX_SAFE_INTEGER
  return Date.now() + expiresIn * 1000
}

async function authorize() {
  const client = createOAuthClient({
    clientId: POE_CLIENT_ID,
    landingPage: {
      title: "Connected to NovaWay",
      body: "You can close this tab and return to NovaWay.",
    },
    openBrowser: async (url) => {
      await open(url)
    },
  })

  const authorization = await client.authorize()

  return {
    url: authorization.authorizationUrl,
    instructions: "Complete authorization in your browser. This window will close automatically.",
    method: "auto" as const,
    async callback() {
      const result = await authorization.waitForResult()
      return {
        type: "success" as const,
        access: result.apiKey,
        refresh: result.apiKey,
        expires: expiry(result.expiresIn),
      }
    },
  }
}

export const PoeAuthPlugin = async (_input: PluginInput): Promise<Hooks> => ({
  auth: {
    provider: "poe",
    async loader(getAuth) {
      const auth = await getAuth()
      if (auth.type === "api") return { apiKey: auth.key }
      if (auth.type !== "oauth") return {}
      if (auth.expires < Date.now()) {
        throw new Error("Poe API key expired. Run `novaway providers login poe` again.")
      }
      return { apiKey: auth.access }
    },
    methods: [
      {
        type: "oauth",
        label: "Login with Poe (browser)",
        authorize,
      },
      {
        type: "api",
        label: "Manually enter API Key",
      },
    ],
  },
})
