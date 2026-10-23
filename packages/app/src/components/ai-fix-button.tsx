import type { IconProps } from "@novaway/ui/icon"
import { Button } from "@novaway/ui/button"
import { useNavigate, useParams } from "@solidjs/router"
import { showToast } from "@novaway/ui/toast"
import { base64Encode } from "@novaway/core/util/encode"
import type { Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { aiFixLabels, buildAiFixDetails, type AiFixContext } from "@/utils/ai-fix"

/**
 * 「让 AI 帮我装 / 帮我修」通用按钮。
 *
 * 用法：把它放在任何「缺失 / 失败」的提示旁边，传入当前状态与日志，
 * 点击后会新建一个会话并把上下文作为第一条消息自动提交，
 * 由 Agent 调用对应的 *setup 工具（或回退到终端）在你的机器上解决问题。
 *
 * 约定：
 * - 不把密钥、密码、token 放进 context；
 * - 日志只传尾部（由 buildAiFixDetails 截断）；
 * - 具体「要 AI 做什么」由 promptKey 对应的提示词决定，能力之间互不复用文案。
 */
export const AiFixButton: Component<{
  /** i18n key，提示词模板，支持 {{details}} 与 {{label}} 等占位符。 */
  promptKey: string
  /** 上下文，支持传函数以便读取最新状态。 */
  context: AiFixContext | (() => AiFixContext)
  /** 提示词里的其他占位符。 */
  params?: Record<string, string | number>
  label?: string
  variant?: "primary" | "secondary" | "ghost"
  icon?: IconProps["name"]
  disabled?: boolean
  class?: string
  /** 跳转前执行（例如关闭弹窗）。 */
  onBeforeAsk?: () => void
}> = (props) => {
  const language = useLanguage()
  const params = useParams()
  const navigate = useNavigate()
  const server = useServer()

  /**
   * 设置页可能在没有项目的情况下打开（首页），此时 URL 里没有 :dir。
   * 退而求其次用最近打开的项目；一个都没有就提示先打开项目。
   * URL 里的目录是 base64 编码的，所以这里也要编码。
   */
  const encodedDir = () => {
    if (params.dir) return params.dir
    const first = server.projects.list()[0]
    return first ? base64Encode(first.worktree) : undefined
  }

  const prompt = () => {
    const context = typeof props.context === "function" ? props.context() : props.context
    const details = buildAiFixDetails(context, aiFixLabels(language.t as never))
    return language.t(props.promptKey as never, { details, ...(props.params ?? {}) })
  }

  const ask = () => {
    const text = prompt()
    if (!text.trim()) return
    const dir = encodedDir()
    if (!dir) {
      showToast({ title: language.t("aiFix.noProject") })
      return
    }
    props.onBeforeAsk?.()
    navigate(`/${dir}/session?prompt=${encodeURIComponent(text)}&submit=1`)
  }

  return (
    <Button
      variant={props.variant ?? "ghost"}
      icon={props.icon ?? "brain"}
      disabled={props.disabled}
      class={props.class}
      onClick={ask}
    >
      {props.label ?? language.t("aiFix.action")}
    </Button>
  )
}
