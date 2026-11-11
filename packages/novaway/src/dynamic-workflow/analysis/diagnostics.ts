/**
 * analyzer 自造的诊断码。与 TS 的码段（1–9999 里那些）**刻意不重叠**：9000 段留给
 * 「脚本语法没问题，但它不是一份能跑的工作流」这一类判断。模型看到 `L3:C9` 加一句中文，
 * 就知道该改哪儿，不需要理解 TS 的编号。
 *
 * 码值一经发布就不改：分类 UI 与评测集按它们统计，改号等于让历史数据失去意义。
 */

/** 一个 facade 可调用物只能出现在直接调用的位置。 */
export const FACADE_NOT_DIRECT_CALL = 9001
/** `ask<T>` 的 T 必须能表达成 JSON Schema（运行时要按它校验）。 */
export const ASK_TYPE_NOT_SCHEMA_ABLE = 9002
/** `world.run` 的命令必须是字符串字面量。 */
export const WORLD_RUN_COMMAND_NOT_LITERAL = 9003
/** `phase()` 的名字必须是字面量，且调用要独立成句。 */
export const PHASE_SITE_INVALID = 9004
/** 两个 `agent()` 不能共用同一个字面量名字。 */
export const ACTOR_NAME_DUPLICATE = 9005
/** fan-out 体里不能给每个元素同一个固定名字。 */
export const ACTOR_NAME_IN_FANOUT = 9006
/** `report()` 的 item 必须能 JSON 序列化。 */
export const REPORT_NOT_SERIALIZABLE = 9100

/**
 * 内部自检失败：降级产物里的站点与分析结果对不上。
 *
 * 这不是作者的错误，是 NovaWay 自己的 bug。单独一个码，是为了让日志能一眼把它和
 * 「脚本写错了」分开——两者的处置完全不同。
 */
export const LOWERED_SITES_MISMATCH = 9900
