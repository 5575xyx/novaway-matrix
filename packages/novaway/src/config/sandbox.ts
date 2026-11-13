export * as ConfigSandbox from "./sandbox"

import { Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable sandbox command wrapping. Defaults to disabled.",
  }),
  backend: Schema.optional(Schema.Literals(["auto", "bwrap", "landlock", "seatbelt", "docker", "podman"])),
  docker_image: Schema.optional(Schema.String),
  network: Schema.optional(Schema.Boolean),
  allow_paths: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

export type Info = Schema.Schema.Type<typeof Info>

const DEFAULT_BACKEND = "auto" as const

export function resolve(info?: Info) {
  return {
    enabled: info?.enabled ?? false,
    backend: info?.backend ?? DEFAULT_BACKEND,
    docker_image: info?.docker_image,
    network: info?.network === true,
    allow_paths: info?.allow_paths ?? [],
  }
}
