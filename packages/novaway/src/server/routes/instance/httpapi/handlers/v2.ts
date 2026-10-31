import { SessionV2 } from "@/v2/session"
import { Layer } from "effect"
import { layer as v2LocationLayer } from "../groups/v2/location"
import { catalogHandlers, commandHandlers, integrationHandlers, referenceHandlers, skillHandlers } from "./v2/catalog"
import { fsHandlers } from "./v2/fs"
import { locationHandlers } from "./v2/location"
import { messageHandlers } from "./v2/message"
import { modelHandlers } from "./v2/model"
import { permissionSavedHandlers } from "./v2/permission"
import { providerHandlers, providerListHandlers } from "./v2/provider"
import { sessionResourceHandlers } from "./v2/session-resource"
import { sessionHandlers } from "./v2/session"

export const v2Handlers = Layer.mergeAll(
  sessionHandlers,
  sessionResourceHandlers,
  messageHandlers,
  modelHandlers,
  providerHandlers,
  providerListHandlers,
  fsHandlers,
  locationHandlers,
  catalogHandlers,
  commandHandlers,
  skillHandlers,
  referenceHandlers,
  integrationHandlers,
  permissionSavedHandlers,
).pipe(Layer.provide(v2LocationLayer), Layer.provide(SessionV2.defaultLayer))
