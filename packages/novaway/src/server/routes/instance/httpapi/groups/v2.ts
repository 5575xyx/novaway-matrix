import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { AgentGroup, CommandGroup, IntegrationGroup, ReferenceGroup, SkillGroup } from "./v2/catalog"
import { FsGroup } from "./v2/fs"
import { LocationGroup } from "./v2/location"
import { MessageGroup } from "./v2/message"
import { ModelGroup } from "./v2/model"
import { PermissionSavedGroup } from "./v2/permission"
import { ProviderGroup, ProviderListGroup } from "./v2/provider"
import { SessionGroup } from "./v2/session"
import { SessionResourceGroup } from "./v2/session-resource"

export const V2Api = HttpApi.make("v2")
  .add(SessionGroup)
  .add(SessionResourceGroup)
  .add(MessageGroup)
  .add(ModelGroup)
  .add(ProviderGroup)
  .add(ProviderListGroup)
  .add(FsGroup)
  .add(LocationGroup)
  .add(AgentGroup)
  .add(CommandGroup)
  .add(SkillGroup)
  .add(ReferenceGroup)
  .add(IntegrationGroup)
  .add(PermissionSavedGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "NovaWay experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
