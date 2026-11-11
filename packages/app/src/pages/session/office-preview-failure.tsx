import { officePreviewFailureTitle, type OfficePreviewFailure } from "./office-preview-load"

/**
 * 预览读不到时的落地面：标题说清类别，下面两行给原因和路径。
 *
 * 面板原来只有「有内容」和「转圈」两态，失败被折进转圈里（聊天区点裸文件名
 * 打不开 pptx 就是这条）。读不到就要停下来说话，不能一直加载。
 */
export function OfficePreviewFailureState(props: { failure: OfficePreviewFailure }) {
  return (
    <div
      data-component="office-preview-failure"
      data-code={props.failure.code}
      class="flex h-full flex-col items-center justify-center gap-2 px-6 py-4 text-center"
    >
      <div data-e2e="title" class="text-12-regular text-foreground">
        {officePreviewFailureTitle(props.failure.code)}
      </div>
      <div data-e2e="message" class="max-w-[520px] text-11-regular text-foreground-subtle break-all">
        {props.failure.message}
      </div>
      <div data-e2e="path" class="max-w-[520px] text-11-regular text-foreground-subtlest break-all">
        {props.failure.path}
      </div>
    </div>
  )
}
