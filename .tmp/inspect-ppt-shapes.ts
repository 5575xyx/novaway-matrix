import JSZip from "jszip"

const files = [
  "public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx",
  "public/assets/office-ppt-templates/presenton-pptx/swift/template.pptx",
]

for (const file of files) {
  const zip = await JSZip.loadAsync(await Bun.file(file).arrayBuffer())
  for (const slideName of ["slide1.xml", "slide2.xml", "slide4.xml", "slide6.xml"]) {
    const xml = await zip.file(`ppt/slides/${slideName}`)?.async("string")
    if (!xml) continue
    const names = [...xml.matchAll(/<p:cNvPr id="(\d+)" name="([^"]*)"/g)].map((match) => ({
      id: Number(match[1]),
      name: match[2],
      hasText: xml.slice(match.index ?? 0, (match.index ?? 0) + 4000).includes("<p:txBody>"),
    }))
    console.log(file, slideName, names)
  }
}
