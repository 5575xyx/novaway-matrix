import { describe, expect, test } from "bun:test"
import { officeTemplateCards } from "./office-template-cards"
import { zenActions } from "./zen-office"
import { officePptTemplates } from "@/pages/session/office-export"

describe("office template cards", () => {
  test("provides template cards for every office scene", () => {
    expect(Object.keys(officeTemplateCards)).toEqual(zenActions.map((action) => action.id))

    for (const action of zenActions) {
      const cards = officeTemplateCards[action.id]
      expect(cards.length).toBeGreaterThanOrEqual(4)
      for (const card of cards) {
        expect(card.title.length).toBeGreaterThan(0)
        expect(card.description.length).toBeGreaterThan(0)
        expect(card.prompt.length).toBeGreaterThan(0)
      }
    }
  })

  test("ppt template cards point to real ppt templates", () => {
    for (const card of officeTemplateCards.ppt) {
      expect(card.pptTemplate).toBeDefined()
      expect(officePptTemplates.some((template) => template.id === card.pptTemplate)).toBe(true)
    }
  })

  test("only exposes real open-source ppt templates in the selector", () => {
    expect(officeTemplateCards.ppt.length).toBeGreaterThanOrEqual(20)
    for (const card of officeTemplateCards.ppt) {
      const template = officePptTemplates.find((item) => item.id === card.pptTemplate)
      expect(template?.source === "Pptx" || template?.source === "Presenton").toBe(true)
      if (template?.source === "Pptx" || template?.source === "Presenton") {
        expect(template?.template?.endsWith("template.pptx")).toBe(true)
      }
    }
  })

  test("keeps the original Presenton templates first", () => {
    const cards = officeTemplateCards.ppt
    expect(cards[0]?.pptTemplate).toBe("presenton-dynamic")
    expect(cards.slice(0, 8).every((card) => card.id.startsWith("ppt-presenton-"))).toBe(true)
  })
})
