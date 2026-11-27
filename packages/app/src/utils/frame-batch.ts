/**
 * Delay a burst of callbacks until the next paint.
 *
 * SSE can deliver dozens of state changes while a model is streaming. Applying
 * each event immediately makes Solid re-run all subscribers once per event and
 * competes with painting. Keeping the events (rather than only the last one)
 * preserves ordering while still limiting reactive flushes to one per frame.
 */
export function createFrameBatch<T>(flush: (items: T[]) => void) {
  let scheduled = false
  let frame: number | undefined
  let pending: T[] = []

  const run = () => {
    scheduled = false
    frame = undefined
    if (pending.length === 0) return
    const items = pending
    pending = []
    flush(items)
  }

  const schedule = () => {
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(run)
      return
    }
    queueMicrotask(run)
  }

  return {
    push(item: T) {
      pending.push(item)
      if (scheduled) return
      scheduled = true
      schedule()
    },
    cancel() {
      if (frame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame)
      frame = undefined
      scheduled = false
      pending = []
    },
  }
}
