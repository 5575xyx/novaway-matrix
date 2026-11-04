// @ts-nocheck

import { NovaWay } from "@novaway/core"
import { ReadTool } from "@novaway/core/tools"

const novaway = NovaWay.make({})

novaway.tool.add(ReadTool)

novaway.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

novaway.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

novaway.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await novaway.session.create({
  agent: "build",
})

novaway.subscribe((event) => {
  console.log(event)
})

await novaway.session.prompt({
  sessionID,
  text: "hey what is up",
})

await novaway.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await novaway.session.wait()

console.log(await novaway.session.messages(sessionID))
