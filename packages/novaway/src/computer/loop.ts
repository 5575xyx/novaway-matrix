export type ComputerAction =
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { type: "move"; x: number; y: number }
  | { type: "scroll"; amount: number }
  | { type: "type"; text: string }
  | { type: "key"; keys: string }

export interface ComputerLoopBackend<Observation> {
  screenshot(): Promise<Observation>
  decide(observation: Observation, step: number): Promise<ComputerAction | "done">
  approve(action: ComputerAction): Promise<boolean>
  act(action: ComputerAction): Promise<void>
}

export async function runComputerLoop<Observation>(input: {
  enabled: boolean
  maxSteps: number
  backend: ComputerLoopBackend<Observation>
}) {
  if (!input.enabled) return { status: "disabled" as const, steps: 0 }

  let observation = await input.backend.screenshot()
  for (let step = 1; step <= input.maxSteps; step++) {
    const action = await input.backend.decide(observation, step)
    if (action === "done") return { status: "completed" as const, steps: step - 1 }
    if (!(await input.backend.approve(action))) return { status: "rejected" as const, steps: step - 1 }
    await input.backend.act(action)
    observation = await input.backend.screenshot()
  }
  return { status: "max_steps" as const, steps: input.maxSteps }
}
