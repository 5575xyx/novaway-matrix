import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "../session/session"
import DESCRIPTION from "./question.txt"

export const Parameters = Schema.Struct({
  questions: Schema.mutable(Schema.Array(Question.Prompt)).annotate({ description: "Questions to ask" }),
})

type Metadata = {
  answers: ReadonlyArray<Question.Answer>
}

export const QuestionTool = Tool.define<typeof Parameters, Metadata, Question.Service>(
  "question",
  Effect.gen(function* () {
    const question = yield* Question.Service
    // 会话服务是可选的：最小 layer（单测、嵌入式用法）里没有它，
    // 那就当"不知道档位"，照常等人回答。
    const sessions = Option.getOrUndefined(yield* Effect.serviceOption(Session.Service))

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          // 无人值守档位：没有人会回答，问了就是整轮挂住。
          // 直接把"自己去决定"交还给模型 —— 这不是替用户选第一个选项，
          // 而是让模型按它自己的判断继续，并把假设写进结果里。
          const mode = sessions ? yield* sessions.permissionModeOf(ctx.sessionID) : undefined
          if (mode === "unattended") {
            return {
              title: `Skipped ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
              output: [
                "Unattended mode: no human is available to answer these questions.",
                "Decide them yourself with your best judgement, state the assumption you made in one short line, and continue the task.",
                "Do not call the question tool again in this turn.",
              ].join("\n"),
              metadata: { answers: params.questions.map(() => [] as Question.Answer) },
            }
          }

          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: params.questions,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          const formatted = params.questions
            .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].join(", ") : "Unanswered"}"`)
            .join(", ")

          return {
            title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
            output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
            metadata: {
              answers,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
