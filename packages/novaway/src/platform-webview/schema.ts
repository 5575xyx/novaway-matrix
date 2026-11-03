import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { Newtype } from "@novaway/core/schema"

export class WebviewRequestID extends Newtype<WebviewRequestID>()(
  "WebviewRequestID",
  Schema.String.check(Schema.isStartsWith("wv")),
) {
  static ascending(id?: string): WebviewRequestID {
    return this.make(Identifier.ascending("webview", id))
  }
}
