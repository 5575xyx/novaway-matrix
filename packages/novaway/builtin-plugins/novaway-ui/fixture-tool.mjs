export default function fixtureRendererTool(_context) {
  return {
    async execute(_input, toolContext) {
      toolContext.metadata({ title: "renderer fixture" })
      return { output: "renderer-fixture" }
    },
  }
}
