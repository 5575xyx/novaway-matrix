import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/settings"

export const SettingsMarkdownAsset = Schema.Struct({
  name: Schema.String,
  location: Schema.String,
  editable: Schema.Boolean,
  builtIn: Schema.optional(Schema.Boolean),
  data: Schema.Record(Schema.String, Schema.Unknown),
  content: Schema.String,
})

export const SettingsAgentPayload = Schema.Struct({
  data: Schema.Record(Schema.String, Schema.Unknown),
  content: Schema.String,
})

export const SettingsSkillPayload = Schema.Struct({
  description: Schema.optional(Schema.String),
  content: Schema.String,
})

export const SettingsRulePayload = Schema.Struct({
  description: Schema.optional(Schema.String),
  trigger: Schema.optional(Schema.Literals(["always", "mention", "auto"])),
  content: Schema.String,
})
export const SettingsRuleScope = Schema.Literals(["global", "project"])

export const SettingsProjectInstructionPayload = Schema.Struct({
  content: Schema.String,
})

export const SettingsImportPayload = Schema.Struct({
  source: Schema.String,
  overwrite: Schema.optional(Schema.Boolean),
})

export const SettingsImportItem = Schema.Struct({
  name: Schema.String,
  category: Schema.optional(Schema.String),
  location: Schema.String,
  status: Schema.Literals(["imported", "skipped"]),
  reason: Schema.optional(Schema.String),
})

export const SettingsImportResponse = Schema.Struct({
  imported: Schema.Number,
  skipped: Schema.Number,
  items: Schema.Array(SettingsImportItem),
})

export const SettingsPaths = {
  agents: `${root}/agents`,
  agent: `${root}/agents/:name`,
  agentImport: `${root}/agents/import`,
  skills: `${root}/skills`,
  skill: `${root}/skills/:name`,
  skillImport: `${root}/skills/import`,
  rules: `${root}/rules/:scope`,
  rule: `${root}/rules/:scope/:name`,
  projectInstruction: `${root}/project-instruction`,
} as const

export const SettingsApi = HttpApi.make("settings")
  .add(
    HttpApiGroup.make("settings")
      .add(
        HttpApiEndpoint.get("agentList", SettingsPaths.agents, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(SettingsMarkdownAsset), "Agent markdown files"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "settings.agent.list",
            summary: "List agent files",
            description: "List editable and discovered agent markdown files.",
          }),
        ),
        HttpApiEndpoint.post("agentImport", SettingsPaths.agentImport, {
          query: WorkspaceRoutingQuery,
          payload: SettingsImportPayload,
          success: described(SettingsImportResponse, "Agent markdown files imported"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "settings.agent.import",
            summary: "Import agent files",
            description: "Import standard markdown agent files from a workspace file or directory.",
          }),
        ),
        HttpApiEndpoint.put("agentSave", SettingsPaths.agent, {
          params: { name: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: SettingsAgentPayload,
          success: described(SettingsMarkdownAsset, "Agent markdown file saved"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "settings.agent.save",
            summary: "Save agent file",
            description: "Create or update a project agent markdown file.",
          }),
        ),
        HttpApiEndpoint.delete("agentDelete", SettingsPaths.agent, {
          params: { name: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Agent markdown file deleted"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "settings.agent.delete",
            summary: "Delete agent file",
            description: "Delete a discovered editable agent markdown file.",
          }),
        ),
        HttpApiEndpoint.get("skillList", SettingsPaths.skills, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(SettingsMarkdownAsset), "Skill markdown files"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "settings.skill.list",
            summary: "List skill files",
            description: "List editable and discovered skill markdown files.",
          }),
        ),
        HttpApiEndpoint.post("skillImport", SettingsPaths.skillImport, {
          query: WorkspaceRoutingQuery,
          payload: SettingsImportPayload,
          success: described(SettingsImportResponse, "Skill markdown files imported"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "settings.skill.import",
            summary: "Import skill files",
            description: "Import standard SKILL.md files from a workspace file or directory.",
          }),
        ),
        HttpApiEndpoint.put("skillSave", SettingsPaths.skill, {
          params: { name: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: SettingsSkillPayload,
          success: described(SettingsMarkdownAsset, "Skill markdown file saved"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "settings.skill.save",
            summary: "Save skill file",
            description: "Create or update a project SKILL.md file.",
          }),
        ),
        HttpApiEndpoint.delete("skillDelete", SettingsPaths.skill, {
          params: { name: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Skill markdown file deleted"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "settings.skill.delete",
            summary: "Delete skill file",
            description: "Delete a discovered editable SKILL.md file.",
          }),
        ),
        HttpApiEndpoint.get("ruleList", SettingsPaths.rules, {
          params: { scope: SettingsRuleScope },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(SettingsMarkdownAsset), "Rule markdown files"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "settings.rule.list",
            summary: "List rule files",
            description: "List markdown rule files from the selected global or project rules directory.",
          }),
        ),
        HttpApiEndpoint.put("ruleSave", SettingsPaths.rule, {
          params: { scope: SettingsRuleScope, name: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: SettingsRulePayload,
          success: described(SettingsMarkdownAsset, "Rule markdown file saved"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "settings.rule.save",
            summary: "Save rule file",
            description: "Create or update a markdown rule file in the selected global or project rules directory.",
          }),
        ),
        HttpApiEndpoint.delete("ruleDelete", SettingsPaths.rule, {
          params: { scope: SettingsRuleScope, name: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Rule markdown file deleted"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "settings.rule.delete",
            summary: "Delete rule file",
            description: "Delete a markdown rule file from the selected global or project rules directory.",
          }),
        ),
        HttpApiEndpoint.get("projectInstructionGet", SettingsPaths.projectInstruction, {
          query: WorkspaceRoutingQuery,
          success: described(SettingsMarkdownAsset, "Project AGENTS.md instruction file"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "settings.project_instruction.get",
            summary: "Get project instruction file",
            description: "Read the AGENTS.md file from the current project root.",
          }),
        ),
        HttpApiEndpoint.put("projectInstructionSave", SettingsPaths.projectInstruction, {
          query: WorkspaceRoutingQuery,
          payload: SettingsProjectInstructionPayload,
          success: described(SettingsMarkdownAsset, "Project AGENTS.md instruction file saved"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "settings.project_instruction.save",
            summary: "Save project instruction file",
            description: "Create or update the AGENTS.md file in the current project root.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "settings", description: "Settings asset management routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "NovaWay experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for settings management.",
    }),
  )
