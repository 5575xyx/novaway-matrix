# Arena: multi-model comparison

Arena runs the same task with several contenders, each in its own git worktree,
then compares the results. It is **disabled by default**.

## Config

```jsonc
{
  "arena": {
    "enabled": true,
    "concurrency": 2,
    "max_contenders": 4,
    "models": ["anthropic/claude-sonnet-4-5", "openai/gpt-5-codex"],
    "keep_worktrees": false,
  },
}
```

There is no separate scoring knob: a contender only gets a verdict and score when
a verifier judged it. Without `verify_command` (tool) or `--verify` (CLI) the run
reports no winner instead of ranking by diff size.

## Entry points

- `arena_run` tool: `task` plus optional `contenders`, `concurrency`,
  `verify_command`, `keep_worktrees`.
- `novaway arena <task> --model provider/model [--verify "bun test"] [--keep] [--json]`.
- `GET /arena/runs` and `GET /arena/runs/:runID` read the recorded history.
- The web UI has an **Arena** page: run list on the left, contenders side by side
  with output, verdict, usage and changed files.

Every run is recorded in `arena_run` / `arena_contender` (migration
`20261113000000_arena`). Recording is best-effort: a failed insert does not turn
a completed run into an error.

## Boundaries

- A contender never falls back to the live checkout. If its worktree cannot be
  created it is reported as `skipped`.
- Worktrees are removed after the run unless `keep_worktrees` / `--keep` is set.
- A tie is not a win; the winner is only named when verification leaves exactly
  one best passing contender.

## Verification status

Orchestration, cleanup, verdict selection and history storage have unit tests
(`test/arena/`). **Real multi-model runs are not verified in this repository's
Windows development environment** (they need provider credentials and git
worktrees), and the UI page is typechecked but was not exercised in a browser
here because the running Host must not be restarted.
