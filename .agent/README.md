# .agent — Agent context

Read this file first each session. These docs are the source of truth for Game Agent Harness context.

## Must read (every session)

1. [`project.md`](project.md) — what the harness is, stack, domain
2. [`architecture.md`](architecture.md) — host, adapter, profile, trace model

Root pointer: [`AGENTS.md`](../AGENTS.md) in the harness root.

## Task routing

| If you are... | Read |
|---|---|
| Adding an engine adapter | `architecture.md` §Engine Adapter Contract |
| Working on trace/context/validation | `architecture.md` §Core Responsibilities |
| Working on CatSweeper integration | `CatSweeper` usage in `project.md` and CatSweeper's `systems/game-agent-harness.md` |
| Open questions or blockers | [`pending.md`](pending.md) |
| Changing CLI or dashboard | `architecture.md` and source code |

## Rules

- Keep docs in sync with code changes.
- Append one line to [`CHANGELOG.md`](CHANGELOG.md) per significant change.
- Unknowns go in [`pending.md`](pending.md) if created; otherwise note them in the commit/PR.
