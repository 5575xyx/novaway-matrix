import { Bus } from "@/bus"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Queue } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { EventApi } from "../groups/event"

const log = Log.create({ service: "server" })

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function eventResponse(bus: Bus.Interface) {
  return Effect.gen(function* () {
    const context = yield* Effect.context()
    const directory = yield* InstanceState.directory

    const events = bus.subscribeAll().pipe(
      Stream.provideContext(context),
      Stream.takeUntil((event) => event.type === Bus.InstanceDisposed.type),
    )
    const globalEvents = Stream.callback<any>((queue) => {
      const handler = (event: GlobalEvent) => {
        if (event.directory !== directory) return
        Queue.offerUnsafe(queue, event.payload)
      }
      return Effect.acquireRelease(
        Effect.sync(() => GlobalBus.on("event", handler)),
        () => Effect.sync(() => GlobalBus.off("event", handler)),
      )
    })
    const heartbeat = Stream.tick("10 seconds").pipe(
      Stream.drop(1),
      Stream.map(() => ({ id: Bus.createID(), type: "server.heartbeat", properties: {} })),
    )

    log.info("event connected")
    return HttpServerResponse.stream(
      Stream.make({ id: Bus.createID(), type: "server.connected", properties: {} }).pipe(
        Stream.concat(
          globalEvents.pipe(
            Stream.merge(events, { haltStrategy: "right" }),
            Stream.merge(heartbeat, { haltStrategy: "left" }),
          ),
        ),
        Stream.map(eventData),
        Stream.pipeThroughChannel(Sse.encode()),
        Stream.encodeText,
        Stream.ensuring(Effect.sync(() => log.info("event disconnected"))),
      ),
      {
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        },
      },
    )
  })
}

export const eventHandlers = HttpApiBuilder.group(EventApi, "event", (handlers) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return handlers.handleRaw(
      "subscribe",
      Effect.fn("EventHttpApi.subscribe")(function* () {
        return yield* eventResponse(bus)
      }),
    )
  }),
)
