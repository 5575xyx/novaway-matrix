import { describe, expect, test } from "bun:test"
import { MAX_PAGES_PER_READ, parsePageRange, validatePageRange } from "../../src/util/pdf"

describe("pdf.parsePageRange", () => {
  test("single page", () => {
    expect(parsePageRange("5")).toEqual({ firstPage: 5, lastPage: 5 })
  })

  test("closed range", () => {
    expect(parsePageRange("1-10")).toEqual({ firstPage: 1, lastPage: 10 })
  })

  test("open-ended range", () => {
    expect(parsePageRange("3-")).toEqual({ firstPage: 3, lastPage: Number.POSITIVE_INFINITY })
  })

  test("trims whitespace", () => {
    expect(parsePageRange("  2-4  ")).toEqual({ firstPage: 2, lastPage: 4 })
  })

  test("rejects malformed input", () => {
    for (const input of ["", " ", "0", "-5", "abc", "5-3", "-"]) {
      expect(parsePageRange(input)).toBeUndefined()
    }
  })
})

describe("pdf.validatePageRange", () => {
  test("accepts ranges within the per-call cap", () => {
    expect(validatePageRange("1")).toBeUndefined()
    expect(validatePageRange(`1-${MAX_PAGES_PER_READ}`)).toBeUndefined()
  })

  test("reports malformed ranges", () => {
    expect(validatePageRange("nope")).toContain("Invalid pages parameter")
  })

  test("reports ranges above the cap", () => {
    expect(validatePageRange("1-30")).toContain("exceeds maximum of 20 pages")
    expect(validatePageRange("3-")).toContain("exceeds maximum of 20 pages")
  })
})
