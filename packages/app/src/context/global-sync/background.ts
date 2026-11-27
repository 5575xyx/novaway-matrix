type Job = { priority: number; start: () => void; cancel: () => void }

/** A per-server budget for speculative work. Foreground calls never use these slots. */
export function createBackgroundQueue(input: { concurrency: number; schedule: (run: () => void) => () => void }) {
  const jobs: Job[] = []
  let open = false
  let disposed = false
  let running = 0
  let cancelTick: (() => void) | undefined

  function pump() {
    if (!open || disposed || cancelTick || running >= input.concurrency || !jobs.length) return
    cancelTick = input.schedule(() => {
      cancelTick = undefined
      if (!open || disposed) return
      const job = jobs.shift()
      if (!job) return
      running++
      job.start()
      pump()
    })
  }

  return {
    setOpen(next: boolean) {
      open = next
      if (!open) {
        cancelTick?.()
        cancelTick = undefined
      }
      pump()
    },
    run<T>(task: () => Promise<T> | T, priority = 1) {
      return new Promise<T | undefined>((resolve, reject) => {
        if (disposed) return resolve(undefined)
        const job: Job = {
          priority,
          start: () => {
            void Promise.resolve()
              .then(task)
              .then(resolve, reject)
              .finally(() => {
                running--
                pump()
              })
          },
          cancel: () => resolve(undefined),
        }
        const index = jobs.findIndex((item) => item.priority > priority)
        jobs.splice(index < 0 ? jobs.length : index, 0, job)
        pump()
      })
    },
    dispose() {
      disposed = true
      cancelTick?.()
      for (const job of jobs.splice(0)) job.cancel()
    },
  }
}

/** Yield between invocations, even when all preceding imports/queries were cached. */
export function scheduleIdle(run: () => void) {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(run, { timeout: 250 })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(run, 16)
  return () => clearTimeout(id)
}
