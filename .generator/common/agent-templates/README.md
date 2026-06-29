# Generated Agent Kit

This project includes runtime-neutral agent guidance generated from MEDOL.

## Skills

Agents should read `.agent/skills/**/SKILL.md` before making code changes. The
skills describe the MEDOL source model, deterministic code generation boundary,
and concrete stack work such as Axon 5 state changes, read models, automations,
and Refine resources.

These files are not tied to Claude Code. Claude, Codex, OpenCode, or another
programming agent can consume them as project guidance.

## Ralph Loop

The generated `.agent/ralph.sh` script is a small local task loop inspired by
the Eventmodelers build kits. It reads `.agent/tasks.json`, turns queued tasks
into an agent prompt using the requested skills, and sends that prompt to a
runtime.

Run once:

```bash
node .agent/ralph-codex.js
```

Run as a loop:

```bash
bash .agent/ralph.sh
```

Select a runtime:

```bash
RALPH_RUNTIME=claude bash .agent/ralph.sh
RALPH_RUNTIME=opencode bash .agent/ralph.sh
```

Use any local agent command by setting `AGENT_COMMAND`. The prompt is passed on
stdin:

```bash
AGENT_COMMAND="codex exec" node .agent/ralph-codex.js
AGENT_COMMAND="claude -p" node .agent/ralph-claude.js
AGENT_COMMAND="opencode run" node .agent/ralph-opencode.js
```

OpenCode command-line flags vary by installation, so `ralph-opencode.js` expects
`AGENT_COMMAND` when you want it to execute instead of only preparing a prompt.

If no runtime is available, Ralph writes the prompt to `.agent/out/` and marks
the task as `needs-runtime`.

## Sync MEDOL Planned Slices

When MEDOL stores slice implementation status in its database, sync planned
slices into local Ralph tasks:

```bash
MEDOL_WORKSPACE_ID=<workspace-id> node .agent/sync-planned-slices.js
```

By default this calls:

```text
http://127.0.0.1:5172/api/agent/slice-statuses?status=planned
```

Override the MEDOL endpoint when needed:

```bash
MEDOL_AGENT_API_URL=http://127.0.0.1:5197/api/agent MEDOL_WORKSPACE_ID=<workspace-id> node .agent/sync-planned-slices.js
```

To sync before each Ralph iteration:

```bash
RALPH_SYNC_PLANNED=1 MEDOL_WORKSPACE_ID=<workspace-id> bash .agent/ralph.sh
```

## Task Format

Add tasks to `.agent/tasks.json`:

```json
[
  {
    "id": "implement-register-organization",
    "status": "queued",
    "title": "Implement Register Organization",
    "prompt": "Implement the RegisterOrganization slice and verify the generated backend compiles.",
    "skills": [
      "load-medol-context",
      "axon5-backend/build-state-change",
      "fix-generation-error"
    ]
  }
]
```
