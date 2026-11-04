import { createEffect } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"

export default function () {
  const params = useParams()
  const navigate = useNavigate()

  // 工作区首页已经没有独立内容（Zen 的余额/用量面板已移除），
  // 直接落到 API Keys 页。
  createEffect(() => {
    void navigate(`/workspace/${params.id}/keys`, { replace: true })
  })

  return null
}
