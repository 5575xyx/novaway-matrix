import { Navigate } from "@solidjs/router"
export default function Home() {
  // The default landing experience is the workspace-free composer, not Task Center.
  return <Navigate href="/global-chat/session" />
}
