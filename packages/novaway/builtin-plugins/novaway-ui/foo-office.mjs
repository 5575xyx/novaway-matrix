import { textEngine } from "@novaway/core/office/text/engine"

/** The release fixture deliberately marks its write path so HTTP tests can prove
 * the Runtime Host selected the plugin engine rather than Core's text fallback. */
export default {
  ...textEngine,
  format: "foo",
  async apply(state, ops, bytes) {
    const result = await textEngine.apply(state, ops, bytes)
    if (!result.ok) return result
    return { ...result, data: { ...result.data, changed: ["foo"] } }
  },
}
