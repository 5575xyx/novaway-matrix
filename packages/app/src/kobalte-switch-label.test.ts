import { describe, expect, test } from "bun:test"

// 手写 label 包住 Kobalte 的 Switch，会让开关永远点不动：
// 没写 for 的 label 会绑定到「第一个可关联后代」，也就是 Kobalte 藏起来的 <input type="checkbox">；
// 点开关时 Control（Kobalte 用 <div onClick> 实现，见 @kobalte/core 的 switch-control.tsx）
// 先 toggle 一次，事件冒泡到 label 后浏览器再对那个 checkbox 补发一次合成点击把它翻回来，
// 两次相互抵消，onChange 永远拿不到稳定结果。
// 正确写法是让 Switch 自己的 Label 承载文案（可配 hideLabel 只给读屏用）。
// 仓库里没有组件渲染夹具（见 pages/session/status-panel/status-panel.test.ts 的说明），
// 所以这里用源码扫描把这一类写法钉死。
function findLabelWrappedSwitches(source: string): number[] {
  const hits: number[] = []
  let from = 0
  while (true) {
    const open = source.indexOf("<label", from)
    if (open < 0) return hits
    const close = source.indexOf("</label>", open)
    if (close < 0) return hits
    if (source.slice(open, close).includes("<Switch")) hits.push(open)
    from = close + 1
  }
}

describe("Kobalte Switch 不能被手写 label 包住", () => {
  test("app 源码里不存在 label 包 Switch 的写法", async () => {
    const glob = new Bun.Glob("**/*.tsx")
    const offenders: string[] = []
    let scanned = 0
    for await (const file of glob.scan({ cwd: `${import.meta.dir}/..` })) {
      scanned++
      const source = await Bun.file(`${import.meta.dir}/../${file}`).text()
      if (findLabelWrappedSwitches(source).length > 0) offenders.push(file)
    }
    // 扫描器空转会让这条断言永远为真，所以先确认它真的扫到了源码。
    expect(scanned).toBeGreaterThan(100)
    expect(offenders).toEqual([])
  })

  test("扫描器确实能认出这种写法（防止扫描器本身失效）", () => {
    expect(findLabelWrappedSwitches(`<label><Switch checked={x()} onChange={setX} /></label>`)).toHaveLength(1)
    expect(findLabelWrappedSwitches(`<div><Switch checked={x()} onChange={setX} /></div>`)).toEqual([])
  })
})
