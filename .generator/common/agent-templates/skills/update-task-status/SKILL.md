---
name: update-task-status
description: Update .agent/tasks.json after a Ralph task is completed, blocked, or needs user input.
---

# Update Task Status

Use this skill when a Ralph task needs an explicit status note.

## Status Values

- `queued`: ready for Ralph to pick up.
- `running`: currently being handled.
- `done`: completed and verified.
- `failed`: attempted but verification failed.
- `blocked`: cannot continue without model, dependency, or user input.
- `needs-runtime`: prompt was prepared but no local agent command was available.

## Rules

- Preserve unknown task fields.
- Add `finishedAt` when leaving `running`.
- Add a short `note` for `failed`, `blocked`, or `needs-runtime`.
- Keep `.agent/out/*.prompt.md` as the prompt audit trail.

## Example

```json
{
  "id": "implement-register-organization",
  "status": "done",
  "note": "Backend compiles after generator template fix.",
  "finishedAt": "2026-06-28T10:00:00.000Z"
}
```
