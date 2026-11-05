/**
 * 发布前预检（规则本身在 `@novaway/core/publish-precheck`）。
 *
 * 规则放在 core 而不是这里，是因为要同时被三处使用：
 * - 主进程（发布执行器，最后一道闸）；
 * - 渲染层（弹窗里先给人看，Web 版没有主进程也能跑）；
 * - 服务端 / CLI。
 * 只要有一处另抄一份词表，两边迟早会给出不同结论。
 */
export {
  charCount,
  PLATFORM_LIMITS,
  platformNames,
  precheckPublish,
  summarizeIssues,
  type PrecheckInput,
  type PrecheckIssue,
  type PrecheckLevel,
  type PrecheckResult,
} from "@novaway/core/publish-precheck"
