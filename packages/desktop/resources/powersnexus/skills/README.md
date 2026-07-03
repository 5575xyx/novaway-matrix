# PowersNexus Skills

A collection of agentic skills for software development workflows. Each skill guides the agent through a specific phase of the development process.

## Planning & Design

| Skill | Description |
|-------|-------------|
| [brainstorming](brainstorming/) | You MUST use this before any creative work - explores user intent, requirements and design before implementation |
| [writing-plans](writing-plans/) | Use when you have a spec or requirements for a multi-step task, before touching code |
| [openspec](openspec/) | Manages artifact generation, delta specs, and change lifecycle for PowersNexus |

## Development

| Skill | Description |
|-------|-------------|
| [subagent-driven-development](subagent-driven-development/) | Use when executing implementation plans with independent tasks in the current session |
| [executing-plans](executing-plans/) | Use when you have a written implementation plan to execute in a separate session with review checkpoints |
| [test-driven-development](test-driven-development/) | Use when implementing any feature or bugfix, before writing implementation code |
| [dispatching-parallel-agents](dispatching-parallel-agents/) | Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies |

## Quality & Review

| Skill | Description |
|-------|-------------|
| [requesting-code-review](requesting-code-review/) | Use when completing tasks, implementing major features, or before merging to verify work meets requirements |
| [receiving-code-review](receiving-code-review/) | Use when receiving code review feedback, before implementing suggestions |
| [verification-before-completion](verification-before-completion/) | Use when about to claim work is complete, fixed, or passing, before committing or creating PRs |

## Support & Utilities

| Skill | Description |
|-------|-------------|
| [using-powersnexus](using-powersnexus/) | Use when starting any conversation - establishes how to find and use skills |
| [using-git-worktrees](using-git-worktrees/) | Use when starting feature work that needs isolation from current workspace |
| [finishing-a-development-branch](finishing-a-development-branch/) | Use when implementation is complete, all tests pass, and you need to decide how to integrate the work |
| [systematic-debugging](systematic-debugging/) | Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes |
| [writing-skills](writing-skills/) | Use when creating new skills, editing existing skills, or verifying skills work before deployment |

## Typical Workflow

1. **using-powersnexus** - Initialize skills context at session start
2. **brainstorming** - Explore requirements and design
3. **openspec** - Generate proposal, specs, design, and tasks
4. **writing-plans** - Create detailed implementation plan
5. **test-driven-development** - Implement with tests
6. **subagent-driven-development** - Execute tasks with subagents
7. **requesting-code-review** - Verify work quality
8. **finishing-a-development-branch** - Complete and merge

## Documentation

Each skill has its own `SKILL.md` file with detailed instructions and workflow guidance. Some skills also include:
- Scripts for automation
- Prompt templates for subagents
- Examples and reference materials