/**
 * Small DOM-motion adapter used by the Solid UI.
 *
 * `motion` currently re-exports its DOM API through `framer-motion/dom`.
 * Some workspace consumers compile the UI source from a copied workspace
 * package and resolve that transitive declaration against an older
 * framer-motion package. Keep the runtime package boundary here and expose
 * only the small, stable surface the UI needs.
 */

export type AnimationPlaybackControls = {
  stop: () => void
  finished: Promise<unknown>
}

export type SpringOptions = {
  visualDuration?: number
  bounce?: number
  stiffness?: number
  damping?: number
  mass?: number
  velocity?: number
}

type MotionValue<T> = {
  set: (value: T) => void
  get: () => T
  on: (event: "change", callback: (value: T) => void) => () => void
  destroy: () => void
}

type MotionRuntime = {
  animate: (
    element: Element,
    keyframes: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => AnimationPlaybackControls
  motionValue: <T>(initial: T) => MotionValue<T>
  attachSpring: <T>(
    value: MotionValue<T>,
    source: T | MotionValue<T>,
    options?: SpringOptions,
  ) => () => void
}

import * as Motion from "motion"

const runtime = Motion as unknown as MotionRuntime

export const animate = runtime.animate
export const motionValue = runtime.motionValue
export const attachSpring = runtime.attachSpring
