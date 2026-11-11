export function createDragFeedback(
  setDraggingType: (type: "image" | "@mention" | null) => void,
  schedule: (callback: () => void) => unknown = (callback) => setTimeout(callback, 300),
  cancel: (timer: unknown) => void = (timer) => {
    if (typeof timer === "number") clearTimeout(timer)
  },
) {
  let resetTimer: unknown

  const reset = () => {
    if (resetTimer) cancel(resetTimer)
    resetTimer = undefined
    setDraggingType(null)
  }

  const activate = (type: "image" | "@mention") => {
    setDraggingType(type)
    if (resetTimer) cancel(resetTimer)
    resetTimer = schedule(reset)
  }

  return { activate, reset }
}
