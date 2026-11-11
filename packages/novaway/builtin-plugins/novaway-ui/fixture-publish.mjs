const now = () => Date.now()

/**
 * Deterministic release fixture for the publish Host bridge.
 * It does not contact an external platform: the returned externalId and
 * timestamps make the HTTP consumer prove that the active runtime driver was
 * invoked, while keeping the release smoke test network-independent.
 */
export default {
  id: "fixture-publish",
  name: "NovaWay Fixture Publish",
  icon: "paper-plane",
  hosts: ["web", "desktop"],
  supports: ["article", "image_text"],
  urls: { article: "https://example.invalid/fixture/article", image_text: "https://example.invalid/fixture/image" },
  automation: { mode: "deterministic-fixture", execution: "runtime-bridge" },
  account: { login: "cookie", profileFields: ["label"] },
  ui: { accent: "#635bff", docs: "https://example.invalid/fixture-publish" },
  runtime: {
    async login(input) {
      const label = typeof input?.profile?.label === "string" && input.profile.label.trim()
        ? input.profile.label.trim()
        : "Fixture account"
      return {
        id: `fixture-account-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "default"}`,
        label,
        profile: { label },
        token: `fixture-token-${now()}`,
      }
    },
    async publish({ account, kind, payload }) {
      return {
        ok: true,
        driverID: "fixture-publish",
        accountID: account.id,
        kind,
        externalId: `fixture-${now()}`,
        title: typeof payload.title === "string" ? payload.title : "",
      }
    },
  },
}
