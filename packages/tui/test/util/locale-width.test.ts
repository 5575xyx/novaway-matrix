import { expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

// 这一组盯的是「宽度预算按显示列算,不是按字符个数算」。
// truncate/oneLine 那几个老函数数的是 UTF-16 码元,遇到中文路径就会把预算撑穿 ——
// 实测「中文目录/子目录/很长的中文文件名.ts」按 33 个码元截断后是 50 列,
// 远超过侧栏卡里给的 36 列,于是被渲染器硬裁掉,连省略号都没有,扩展名直接消失。
test("displayWidth 按终端列数算:ASCII 1 列、CJK 2 列、emoji 2 列", () => {
  expect(Locale.displayWidth("abc")).toBe(3)
  expect(Locale.displayWidth("中文")).toBe(4)
  expect(Locale.displayWidth("a中b")).toBe(4)
  expect(Locale.displayWidth("📁")).toBe(2)
  expect(Locale.displayWidth("")).toBe(0)
})

test("truncateToWidth 超预算时留一个省略号,且结果一定不超预算", () => {
  expect(Locale.truncateToWidth("abcdef", 10)).toBe("abcdef")
  // 6 列字符串塞进 4 列:3 个字符 + 省略号(1 列)。
  expect(Locale.truncateToWidth("abcdef", 4)).toBe("abc…")
  // 中文:「中文中」是 6 列,预算 5 列只能留「中文」(4)+ 省略号。
  expect(Locale.truncateToWidth("中文中", 5)).toBe("中文…")
  expect(Locale.displayWidth(Locale.truncateToWidth("中文中", 5))).toBeLessThanOrEqual(5)
})

test("truncateToWidth 预算只剩 1 列时只给省略号,预算为 0 时给空串", () => {
  // 省略号自己就占 1 列:预算 1 列时正文一列都放不下,但这个省略号是称职的。
  expect(Locale.truncateToWidth("abcdef", 1)).toBe("…")
  expect(Locale.truncateToWidth("中文", 1)).toBe("…")
  // 预算 0 连省略号都放不下。
  expect(Locale.truncateToWidth("abcdef", 0)).toBe("")
  expect(Locale.truncateToWidth("中文", 0)).toBe("")
})

test("truncateLeftToWidth 保头尾:左端一个省略号,文件名和扩展名都还在", () => {
  expect(Locale.truncateLeftToWidth("abcdef", 10)).toBe("abcdef")
  expect(Locale.truncateLeftToWidth("abcdef", 4)).toBe("…def")
  // 中文路径按列截(不是按码元):7 个汉字 = 14 列,预算 8 列。
  const path = "中文目录/子目录/名字.ts"
  const cut = Locale.truncateLeftToWidth(path, 8)
  expect(Locale.displayWidth(cut)).toBeLessThanOrEqual(8)
  // 尾部(扩展名)必须保住 —— 这正是 33 码元硬裁会丢的东西。
  expect(cut.endsWith(".ts")).toBe(true)
  expect(cut.startsWith("…")).toBe(true)
})

test("oneLineToWidth 先压平硬换行再按列截断", () => {
  expect(Locale.oneLineToWidth("a\nb\tc   d", 20)).toBe("a b c d")
  const cut = Locale.oneLineToWidth("第一行\n第二行\n第三行", 8)
  expect(cut).not.toContain("\n")
  expect(Locale.displayWidth(cut)).toBeLessThanOrEqual(8)
})
