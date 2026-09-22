# CLAUDE.md — wsn-codegen

Repo-local agent configuration for the generator tool. The project record — phases,
case studies, decisions and the running work log — lives in the parent `../CLAUDE.md`,
which Claude Code loads alongside this file. Don't duplicate it here.

## Agent skills

### Issue tracker

Issues and specs are markdown files under `.scratch/<feature>/`, committed with the
repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unchanged, recorded as a `Status:` line in each issue file.
See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root, both created lazily.
See `docs/agents/domain.md`.
