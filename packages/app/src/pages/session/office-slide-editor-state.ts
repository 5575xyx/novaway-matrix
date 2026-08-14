import type { OfficeSlide } from "./office-artifact"

export function addOfficeSlide(slides: OfficeSlide[]) {
  const nextIndex = slides.reduce((max, slide) => Math.max(max, slide.index), 0) + 1
  return [...slides, { index: nextIndex, title: `第 ${nextIndex} 页`, content: "" }]
}

export function removeOfficeSlide(slides: OfficeSlide[], index: number) {
  if (slides.length <= 1 || index < 0 || index >= slides.length) return slides
  return slides.filter((_, current) => current !== index).map((slide, current) => ({ ...slide, index: current + 1 }))
}

export function moveOfficeSlide(slides: OfficeSlide[], index: number, direction: -1 | 1) {
  const target = index + direction
  if (index < 0 || index >= slides.length || target < 0 || target >= slides.length) return slides
  return slides.map((slide, current) => {
    if (current === target) return { ...slides[index], index: current + 1 }
    if (current === index) return { ...slides[target], index: current + 1 }
    return slide
  })
}
