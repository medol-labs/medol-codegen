---
name: sync-planned-slices
description: Sync MEDOL planned slice statuses into local Ralph tasks.
---

# Sync Planned Slices

Use this skill before running Ralph when MEDOL stores slice implementation
status in its database instead of in `.medol` syntax.

## Source

The MEDOL app exposes planned slices through:

```text
GET /api/agent/slice-statuses?workspaceId=<workspaceId>&status=planned
```

The generated project can pull those slices with:

```bash
MEDOL_WORKSPACE_ID=<workspace-id> node .agent/sync-planned-slices.js
```

Optional environment variables:

- `MEDOL_AGENT_API_URL`: defaults to `http://127.0.0.1:5172/api/agent`.
- `MEDOL_SLICE_STATUS`: defaults to `planned`.

## Rules

- Do not write implementation workflow state into MEDOL source files.
- Treat `planned` slices as queue candidates and create `.agent/tasks.json`
  entries only when the task id does not already exist.
- Use `codegen-model.json` to classify whether a slice needs backend state
  change, backend read model, backend automation, or Refine resource work.
- If a planned slice cannot be found in `codegen-model.json`, create a task that
  asks the agent to report the mismatch before editing code.
- Preserve existing task statuses; do not reset `running`, `done`, `failed`, or
  `blocked` tasks during sync.

## Verification

- Run the sync command and inspect `.agent/tasks.json`.
- Run one Ralph iteration with `node .agent/ralph-codex.js` or the selected
  runtime after tasks are queued.
