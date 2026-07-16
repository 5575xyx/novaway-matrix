import { Show, type Component } from "solid-js"

type ModelCapabilityInfo = {
  capabilities: {
    attachment: boolean
    reasoning: boolean
    input: {
      text: boolean
      image: boolean
      audio: boolean
      video: boolean
      pdf: boolean
    }
    output: {
      text: boolean
      image: boolean
      audio: boolean
      video: boolean
      pdf: boolean
    }
  }
  limit: {
    context: number
  }
}

export const ModelCapabilitySummary: Component<{ model: ModelCapabilityInfo; compact?: boolean }> = (props) => {
  const inputLabels = () =>
    [
      props.model.capabilities.input.text ? "文本" : undefined,
      props.model.capabilities.input.image ? "图像" : undefined,
      props.model.capabilities.input.audio ? "音频" : undefined,
      props.model.capabilities.input.video ? "视频" : undefined,
      props.model.capabilities.input.pdf || props.model.capabilities.attachment ? "PDF" : undefined,
    ].filter((item): item is string => !!item)
  const outputLabels = () =>
    [
      props.model.capabilities.output.text ? "文本" : undefined,
      props.model.capabilities.output.image ? "图片" : undefined,
      props.model.capabilities.output.audio ? "音频" : undefined,
      props.model.capabilities.output.video ? "视频" : undefined,
      props.model.capabilities.output.pdf ? "PDF" : undefined,
    ].filter((item): item is string => !!item)
  const hasPrevious = () => inputLabels().length > 0 || outputLabels().length > 0 || props.model.capabilities.reasoning

  return (
    <div
      class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-text-weak"
      classList={{
        "text-11-regular": props.compact,
        "text-12-regular": !props.compact,
      }}
    >
      <Show when={inputLabels().length > 0}>
        <span class="truncate text-sky-600 dark:text-cyan-200">支持：{inputLabels().join("、")}</span>
      </Show>
      <Show when={outputLabels().length > 0}>
        <span class="inline-flex min-w-0 items-center gap-1">
          <Show when={inputLabels().length > 0}>
            <span class="text-text-muted">·</span>
          </Show>
          <span class="truncate text-violet-600 dark:text-violet-200">可生成：{outputLabels().join("、")}</span>
        </span>
      </Show>
      <Show when={props.model.capabilities.reasoning}>
        <span class="inline-flex items-center gap-1">
          <Show when={inputLabels().length > 0 || outputLabels().length > 0}>
            <span class="text-text-muted">·</span>
          </Show>
          <span class="text-emerald-600 dark:text-emerald-200">支持推理</span>
        </span>
      </Show>
      <Show when={Number.isFinite(props.model.limit.context)}>
        <span class="inline-flex items-center gap-1">
          <Show when={hasPrevious()}>
            <span class="text-text-muted">·</span>
          </Show>
          <span class="text-amber-700 dark:text-amber-200">
            上下文上限 {props.model.limit.context.toLocaleString()}
          </span>
        </span>
      </Show>
    </div>
  )
}
