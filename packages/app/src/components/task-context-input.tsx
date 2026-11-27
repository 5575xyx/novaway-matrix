import { type Component } from "solid-js"
import { useLanguage } from "@/context/language"

/** Context picker used by the advanced task form; prompt attachments remain available in chat. */
export const TaskContextInput: Component<{ value: string; onInput: (value: string) => void }> = (props) => {
  const language = useLanguage()
  return (
    <label class="flex flex-col gap-1">
      <span class="text-ui-xs text-foreground-subtle">{language.t("run.new.files" as never)}</span>
      <textarea
        class="min-h-16 resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-ui-base text-foreground outline-none placeholder:text-foreground-subtle focus:border-border-focus"
        rows={2}
        value={props.value}
        placeholder={language.t("run.new.filesPlaceholder" as never)}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
      <span class="text-ui-xs text-foreground-subtlest">{language.t("taskContextInput.hint" as never)}</span>
    </label>
  )
}
