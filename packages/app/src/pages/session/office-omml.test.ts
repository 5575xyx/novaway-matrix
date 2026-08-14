import { describe, expect, test } from "bun:test"
import { ommlMathXml, ommlWordXml, splitFormulaSegments } from "./office-omml"

describe("office-omml", () => {
  test("splits inline and block formula markers", () => {
    expect(splitFormulaSegments("已知 $E=mc^2$，平方根为 $\\sqrt{x}$")).toEqual([
      { kind: "text", value: "已知 " },
      { kind: "inline", latex: "E=mc^2" },
      { kind: "text", value: "，平方根为 " },
      { kind: "inline", latex: "\\sqrt{x}" },
    ])
    expect(splitFormulaSegments("$$\\frac{a}{b}$$")).toEqual([{ kind: "block", latex: "\\frac{a}{b}" }])
  })

  test("converts fractions to editable OMML", () => {
    const xml = ommlMathXml("\\frac{a}{b}")
    expect(xml).toContain("<m:oMath>")
    expect(xml).toContain("<m:f>")
    expect(xml).toContain("<m:num><m:r><m:t")
    expect(xml).toContain(">a</m:t>")
    expect(xml).toContain("<m:den>")
    expect(xml).toContain(">b</m:t>")
  })

  test("converts subscripts and superscripts to OMML script objects", () => {
    const xml = ommlMathXml("x_i^2")
    expect(xml).toContain("<m:sSubSup>")
    expect(xml).toContain("<m:sub>")
    expect(xml).toContain("<m:sup>")
    expect(xml).toContain(">i</m:t>")
    expect(xml).toContain(">2</m:t>")
  })

  test("converts radicals with optional degree to OMML", () => {
    const square = ommlMathXml("\\sqrt{x+1}")
    expect(square).toContain("<m:rad>")
    expect(square).toContain('<m:degHide m:val="1"/>')
    const cube = ommlMathXml("\\sqrt[3]{x}")
    expect(cube).toContain('<m:degHide m:val="0"/>')
    expect(cube).toContain("<m:deg>")
  })

  test("maps common Greek letters and math operators", () => {
    const xml = ommlMathXml("\\alpha + \\beta \\times \\infty")
    expect(xml).toContain("α")
    expect(xml).toContain("β")
    expect(xml).toContain("×")
    expect(xml).toContain("∞")
  })

  test("converts matrix and cases environments to OMML", () => {
    const pmatrix = ommlMathXml("\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}")
    expect(pmatrix).toContain("<m:m>")
    expect(pmatrix).toContain("<m:mr>")
    expect(pmatrix).toContain('<m:count m:val="2"/>')
    expect(pmatrix).toContain('<m:begChr m:val="("')

    const cases = ommlMathXml("\\begin{cases}x^2 & x > 0 \\\\ -x & x \\le 0\\end{cases}")
    expect(cases).toContain('<m:begChr m:val="{"/>')
    expect(cases).toContain("<m:sSup>")
    expect(cases).toContain("≤")

    const rcases = ommlMathXml("\\begin{rcases}x \\\\ y\\end{rcases}")
    expect(rcases).toContain('<m:endChr m:val="}"/>')
  })

  test("converts array column specs and binomial coefficients", () => {
    const array = ommlMathXml("\\begin{array}{cc}a & b \\\\ c & d\\end{array}")
    expect(array).toContain("<m:m>")
    expect(array).toContain("<m:mr>")
    expect(array).not.toContain("cc")

    const binom = ommlMathXml("\\binom{n}{k}")
    expect(binom).toContain("<m:m>")
    expect(binom).toContain('<m:begChr m:val="("')
  })

  test("converts sum and integral scripts to native n-ary objects", () => {
    const sum = ommlMathXml("\\sum_{i=1}^{n} x_i")
    expect(sum).toContain("<m:nary>")
    expect(sum).toContain('<m:chr m:val="∑"/>')
    expect(sum).toContain("<m:sub>")
    expect(sum).toContain("<m:sup>")
    expect(sum).toContain("<m:e>")
    expect(sum).toContain("<m:sSub>")

    const integral = ommlMathXml("\\int_0^1 f(x) dx")
    expect(integral).toContain("<m:nary>")
    expect(integral).toContain('<m:chr m:val="∫"/>')
  })

  test("converts limit operators to native OMML", () => {
    const limit = ommlMathXml("\\lim_{x \\to 0} f(x)")
    expect(limit).toContain("<m:limLow>")
    expect(limit).toContain("<m:lim>")
    expect(limit).toContain("→")

    const max = ommlMathXml("\\max\\limits_{i \\in I} a_i")
    expect(max).toContain("<m:limLow>")
    expect(max).toContain("<m:e>")
  })

  test("converts bars and accents to native OMML", () => {
    const overline = ommlMathXml("\\overline{x+y}")
    expect(overline).toContain("<m:bar>")
    expect(overline).toContain('<m:pos m:val="top"/>')

    const underline = ommlMathXml("\\underline{x}")
    expect(underline).toContain('<m:pos m:val="bottom"/>')

    const hat = ommlMathXml("\\hat{x}")
    expect(hat).toContain("<m:acc>")
    expect(hat).toContain('<m:chr m:val="^"/>')

    const vec = ommlMathXml("\\vec{v}")
    expect(vec).toContain('<m:chr m:val="→"/>')
  })

  test("converts multi-character left and right delimiters", () => {
    const angle = ommlMathXml("\\left\\langle x \\right\\rangle")
    expect(angle).toContain('<m:begChr m:val="⟨"/>')
    expect(angle).toContain('<m:endChr m:val="⟩"/>')

    const floor = ommlMathXml("\\left\\lfloor \\frac{x}{2} \\right\\rfloor")
    expect(floor).toContain('<m:begChr m:val="⌊"/>')
    expect(floor).toContain('<m:endChr m:val="⌋"/>')
  })

  test("preserves text spaces and converts overset and underset", () => {
    const text = ommlMathXml("x = \\text{hello world}")
    expect(text).toContain("hello world")

    const overset = ommlMathXml("\\overset{a}{b}")
    expect(overset).toContain("<m:limUpp>")
    expect(overset).toContain("<m:e>")
    expect(overset).toContain("<m:lim>")

    const underset = ommlMathXml("\\underset{c}{d}")
    expect(underset).toContain("<m:limLow>")
  })

  test("wraps block formulas in the PowerPoint math extension", () => {
    const xml = ommlMathXml("\\frac{1}{2}", true)
    expect(xml).toContain('xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"')
    expect(xml).toContain("<m:oMathPara>")
    expect(xml).toContain("</m:oMathPara>")
  })

  test("wraps Word formulas in native OMML", () => {
    expect(ommlWordXml("x^2")).toContain(
      '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">',
    )
    expect(ommlWordXml("\\frac{1}{2}", true)).toContain(
      '<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">',
    )
    expect(ommlWordXml("\\frac{1}{2}", true)).toContain("<m:f>")
  })
})
