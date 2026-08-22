interface ImportMetaEnv {
  readonly NovaWay_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:NovaWay-server" {
  export namespace Server {
    export const listen: typeof import("../../../NovaWay/dist/types/src/node").Server.listen
    export type Listener = import("../../../NovaWay/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../NovaWay/dist/types/src/node").Config.get
    export type Info = import("../../../NovaWay/dist/types/src/node").Config.Info
  }
  export namespace Log {
    export const init: typeof import("../../../NovaWay/dist/types/src/node").Log.init
  }
  export namespace Database {
    export const getPath: typeof import("../../../NovaWay/dist/types/src/node").Database.getPath
    export const Client: typeof import("../../../NovaWay/dist/types/src/node").Database.Client
  }
  export namespace JsonMigration {
    export type Progress = import("../../../NovaWay/dist/types/src/node").JsonMigration.Progress
    export const run: typeof import("../../../NovaWay/dist/types/src/node").JsonMigration.run
  }
  export const bootstrap: typeof import("../../../NovaWay/dist/types/src/node").bootstrap
}
