export interface PublishForm {
  type: "video" | "image_text" | "article"
  title: string
  description: string
  filePaths: string[]
  tags: string[]
  scheduleTime?: number
  selectedAccounts: string[]
}
