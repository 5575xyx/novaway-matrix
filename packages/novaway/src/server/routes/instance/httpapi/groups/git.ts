import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

// 文件变更的状态分类。code 是 git porcelain 的原始两位码,前端想看细节时用它。
export const GitStatus = Schema.Literals(["added", "deleted", "modified", "renamed", "untracked", "unmerged"])

export const GitFileChange = Schema.Struct({
  file: Schema.String,
  code: Schema.String,
  status: GitStatus,
  /** code 的 X 位有内容:这个文件有已暂存的改动 */
  staged: Schema.Boolean,
  /** code 的 Y 位有内容(含未跟踪):这个文件有未暂存的改动 */
  unstaged: Schema.Boolean,
  additions: Schema.Number,
  deletions: Schema.Number,
  /** 二进制文件 git 给的是 "-" 占位,没有行数概念 */
  binary: Schema.Boolean,
})

export const GitBranchInfo = Schema.Struct({
  branch: Schema.optional(Schema.String),
  upstream: Schema.optional(Schema.String),
  ahead: Schema.Number,
  behind: Schema.Number,
})

export const GitBranch = Schema.Struct({
  name: Schema.String,
  current: Schema.Boolean,
})

export const GitRemote = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
  /** 当前分支的上游属于这个远程 */
  current: Schema.Boolean,
})

export const GitStash = Schema.Struct({
  ref: Schema.String,
  message: Schema.String,
})

export const GitCommit = Schema.Struct({
  hash: Schema.String,
  subject: Schema.String,
  author: Schema.String,
  date: Schema.String,
})

// 一次拿全:侧栏面板刷新时不想跑六次 HTTP 往返。
export const GitSnapshot = Schema.Struct({
  branch: GitBranchInfo,
  changes: Schema.Array(GitFileChange),
  branches: Schema.Array(GitBranch),
  remotes: Schema.Array(GitRemote),
  stash: Schema.Array(GitStash),
  log: Schema.Array(GitCommit),
})

export const GitFilesPayload = Schema.Struct({
  files: Schema.Array(Schema.String),
})

export const GitCommitPayload = Schema.Struct({
  message: Schema.String,
})

// 给了 ref 就是弹出那条贮藏,没给就是贮藏当前改动。
export const GitStashPayload = Schema.Struct({
  ref: Schema.optional(Schema.String),
  includeUntracked: Schema.optional(Schema.Boolean),
})

// create 新建并切换,remove 删除,都不给就是切换。
export const GitBranchPayload = Schema.Struct({
  name: Schema.String,
  create: Schema.optional(Schema.Boolean),
  remove: Schema.optional(Schema.Boolean),
})

// 给了 url 就是添加,remove 为 true 就是删除。
export const GitRemotePayload = Schema.Struct({
  name: Schema.String,
  url: Schema.optional(Schema.String),
  remove: Schema.optional(Schema.Boolean),
})

export class ApiGitError extends Schema.ErrorClass<ApiGitError>("GitError")(
  {
    name: Schema.Literal("GitError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export const GitPaths = {
  snapshot: "/git",
  add: "/git/add",
  unstage: "/git/unstage",
  discard: "/git/discard",
  commit: "/git/commit",
  push: "/git/push",
  pull: "/git/pull",
  stash: "/git/stash",
  branch: "/git/branch",
  remote: "/git/remote",
} as const

const snapshotSuccess = described(GitSnapshot, "Git snapshot")

export const GitApi = HttpApi.make("git")
  .add(
    HttpApiGroup.make("git")
      .add(
        HttpApiEndpoint.get("snapshot", GitPaths.snapshot, {
          query: WorkspaceRoutingQuery,
          success: snapshotSuccess,
          error: ApiGitError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "git.snapshot",
            summary: "Get git snapshot",
            description: "Branch, changes, branches, remotes, stash and recent commits of the project in one call.",
          }),
        ),
        HttpApiEndpoint.post("add", GitPaths.add, {
          query: WorkspaceRoutingQuery,
          payload: GitFilesPayload,
          success: snapshotSuccess,
          error: ApiGitError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "git.add",
            summary: "Stage files",
            description: "Stage the given files in the git index.",
          }),
        ),
        HttpApiEndpoint.post("unstage", GitPaths.unstage, {
          query: WorkspaceRoutingQuery,
          payload: GitFilesPayload,
          success: snapshotSuccess,
          error: ApiGitError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "git.unstage",
            summary: "Unstage files",
            description: "Remove the given files from the git index, keeping the working tree changes.",
          }),
        ),
        HttpApiEndpoint.post("discard", GitPaths.discard, {
          query: WorkspaceRoutingQuery,
          payload: GitFilesPayload,
          success: snapshotSuccess,
          error: ApiGitError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "git.discard",
            summary: "Discard changes",
            description:
              "Revert the given files. Untracked files are deleted, tracked files are restored from the index.",
          }),
        ),
        HttpApiEndpoint.post("commit", GitPaths.commit, {
          query: WorkspaceRoutingQuery,
          payload: GitCommitPayload,
          success: snapshotSuccess,
          error: ApiGitError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "git.commit",
            summary: "Commit",
            description: "Commit the staged changes. Stages everything first when the index is empty.",
          }),
        ),
        HttpApiEndpoint.post("push", GitPaths.push, {
          query: WorkspaceRoutingQuery,
          success: snapshotSuccess,
          error: ApiGitError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "git.push",
            summary: "Push",
            description: "Push the current branch. Establishes tracking on the first push when no upstream exists.",
          }),
        ),
        HttpApiEndpoint.post("pull", GitPaths.pull, {
          query: WorkspaceRoutingQuery,
          success: snapshotSuccess,
          error: ApiGitError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "git.pull",
            summary: "Pull",
            description: "Pull and merge the upstream of the current branch.",
          }),
        ),
        HttpApiEndpoint.post("stash", GitPaths.stash, {
          query: WorkspaceRoutingQuery,
          payload: GitStashPayload,
          success: snapshotSuccess,
          error: ApiGitError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "git.stash",
            summary: "Stash or pop",
            description: "Stash the current changes, or pop the stash entry identified by ref.",
          }),
        ),
        HttpApiEndpoint.post("branch", GitPaths.branch, {
          query: WorkspaceRoutingQuery,
          payload: GitBranchPayload,
          success: snapshotSuccess,
          error: ApiGitError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "git.branch",
            summary: "Manage branch",
            description: "Create, switch to, or delete a local branch.",
          }),
        ),
        HttpApiEndpoint.post("remote", GitPaths.remote, {
          query: WorkspaceRoutingQuery,
          payload: GitRemotePayload,
          success: snapshotSuccess,
          error: ApiGitError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "git.remote",
            summary: "Manage remote",
            description: "Add or remove a git remote.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "git",
          description: "Git source control routes for the source control panel.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "NovaWay experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
