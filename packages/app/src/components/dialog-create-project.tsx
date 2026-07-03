import { createSignal, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

interface DialogCreateProjectProps {
  onCreate: (path: string) => void
}

export function DialogCreateProject(props: DialogCreateProjectProps) {
  const dialog = useDialog()
  const platform = usePlatform()
  const language = useLanguage()

  const [folderName, setFolderName] = createSignal("")
  const [parentPath, setParentPath] = createSignal("")
  const [nameError, setNameError] = createSignal("")
  const [pathError, setPathError] = createSignal("")

  async function handleBrowse() {
    if (!platform.openDirectoryPickerDialog) return
    const result = await platform.openDirectoryPickerDialog({
      title: language.t("command.project.create.dialog.location"),
      multiple: false,
    })
    if (result && typeof result === "string") {
      setParentPath(result)
      setPathError("")
    }
  }

  async function handleCreate() {
    let valid = true

    if (!folderName().trim()) {
      setNameError(language.t("command.project.create.dialog.error.nameRequired"))
      valid = false
    } else {
      setNameError("")
    }

    if (!parentPath()) {
      setPathError(language.t("command.project.create.dialog.error.pathRequired"))
      valid = false
    } else {
      setPathError("")
    }

    if (!valid) return

    if (!platform.createDirectory) {
      showToast({ title: language.t("command.project.create.dialog.error.createFailed"), variant: "error" })
      return
    }

    try {
      const fullPath = await platform.createDirectory(parentPath(), folderName().trim())
      dialog.close()
      props.onCreate(fullPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("Failed to create directory:", error)
      showToast({
        title: language.t("command.project.create.dialog.error.createFailed"),
        description: message,
        variant: "error",
      })
    }
  }

  return (
    <Dialog title={language.t("command.project.create.dialog.title")}>
      <div class="flex flex-col gap-5 p-5">
        <div class="flex flex-col gap-2">
          <label class="text-14-medium text-text-strong">
            {language.t("command.project.create.dialog.name")}
          </label>
          <input
            class="flex h-10 w-full rounded-[8px] border border-border-weak-base bg-surface-raised-base px-3 text-14-regular text-text-strong placeholder:text-text-weak outline-none focus:border-border-interactive-base"
            type="text"
            value={folderName()}
            onInput={(e) => {
              setFolderName(e.currentTarget.value)
              if (nameError()) setNameError("")
            }}
            placeholder={language.t("command.project.create.dialog.namePlaceholder")}
            autofocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate()
            }}
          />
          <Show when={nameError()}>
            <span class="text-12-regular text-text-danger">{nameError()}</span>
          </Show>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-14-medium text-text-strong">
            {language.t("command.project.create.dialog.location")}
          </label>
          <div class="flex items-center gap-2">
            <input
              class="flex h-10 flex-1 rounded-[8px] border border-border-weak-base bg-surface-raised-base px-3 text-14-regular text-text-weak outline-none"
              type="text"
              value={parentPath()}
              placeholder={language.t("command.project.create.dialog.browse")}
              disabled
            />
            <Button variant="secondary" size="small" onClick={() => void handleBrowse()}>
              <Icon name="folder" size="small" />
              {language.t("command.project.create.dialog.browse")}
            </Button>
          </div>
          <Show when={pathError()}>
            <span class="text-12-regular text-text-danger">{pathError()}</span>
          </Show>
        </div>

        <div class="flex items-center justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => dialog.close()}>
            {language.t("command.project.create.dialog.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void handleCreate()}>
            {language.t("command.project.create.dialog.confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
