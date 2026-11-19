# Reference prompts

These files are a verbatim copy of HumanLayer’s Claude Code commands and sub-agent prompts, kept here as reference material for the digest. They are not installed as commands in this repository. Do not move them into `.claude/`.

- **Source repository:** [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer)
- **Commit:** [`99abe673498cf8bdcd5f989aebe9406a27185b3b`](https://github.com/humanlayer/humanlayer/commit/99abe673498cf8bdcd5f989aebe9406a27185b3b) (`99abe673`)
- **Original paths:** [`.claude/commands/`](https://github.com/humanlayer/humanlayer/tree/99abe673498cf8bdcd5f989aebe9406a27185b3b/.claude/commands) and [`.claude/agents/`](https://github.com/humanlayer/humanlayer/tree/99abe673498cf8bdcd5f989aebe9406a27185b3b/.claude/agents)
- **License:** Apache License 2.0. Copyright (c) 2024, humanlayer Authors. The upstream `LICENSE` file is copied beside this page as [LICENSE](LICENSE). The license text is at <http://www.apache.org/licenses/LICENSE-2.0>. That commit has no `NOTICE` file.

Each file below was checked byte for byte against that commit. Descriptions are the file’s own frontmatter `description`, shortened only where the field is a long instruction.

## Commands

| File | Description |
|---|---|
| [commands/research_codebase.md](commands/research_codebase.md) | Document the codebase as it exists, using the `thoughts/` directory for historical context. |
| [commands/research_codebase_generic.md](commands/research_codebase_generic.md) | Research the codebase with parallel sub-agents. |
| [commands/research_codebase_nt.md](commands/research_codebase_nt.md) | Document the codebase as it exists, without evaluation or recommendations. |
| [commands/create_plan.md](commands/create_plan.md) | Create a detailed implementation plan through interactive research and iteration. |
| [commands/create_plan_generic.md](commands/create_plan_generic.md) | Create a detailed implementation plan with thorough research and iteration. |
| [commands/create_plan_nt.md](commands/create_plan_nt.md) | Create an implementation plan with thorough research, with no thoughts directory. |
| [commands/implement_plan.md](commands/implement_plan.md) | Implement a technical plan from `thoughts/shared/plans`, with verification. |
| [commands/iterate_plan.md](commands/iterate_plan.md) | Update an existing implementation plan from feedback, grounded in the codebase. |
| [commands/iterate_plan_nt.md](commands/iterate_plan_nt.md) | Update an existing implementation plan from feedback, grounded in the codebase. |
| [commands/validate_plan.md](commands/validate_plan.md) | Check an implementation against its plan and success criteria, and identify issues. |
| [commands/oneshot.md](commands/oneshot.md) | Research a ticket, then launch a planning session. |
| [commands/oneshot_plan.md](commands/oneshot_plan.md) | Run the Ralph plan and implementation commands for a ticket. |

## Agents

| File | Description |
|---|---|
| [agents/codebase-locator.md](agents/codebase-locator.md) | Locate files, directories, and components relevant to a feature or task. |
| [agents/codebase-analyzer.md](agents/codebase-analyzer.md) | Analyze how a specific part of the codebase is implemented. |
| [agents/codebase-pattern-finder.md](agents/codebase-pattern-finder.md) | Find similar implementations, usage examples, and existing patterns. |
| [agents/thoughts-locator.md](agents/thoughts-locator.md) | Find relevant documents in the `thoughts/` directory. |
| [agents/thoughts-analyzer.md](agents/thoughts-analyzer.md) | Read `thoughts/` documents and return the relevant points. |
| [agents/web-search-researcher.md](agents/web-search-researcher.md) | Search the web for information the model may not already have. |
