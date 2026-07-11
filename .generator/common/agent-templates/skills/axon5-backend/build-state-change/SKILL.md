---
name: axon5-backend/build-state-change
description: Implement a MEDOL command/event state change in the generated Axon 5 backend.
---

# Build State Change

Use this skill for a write slice: command -> business decision -> event(s) ->
event-sourced state.

## Read First

- `codegen-model.json` for command fields, event fields, tags, concept state,
  specifications, and value objects.
- Existing command, event, state, and handler files in the same context.
- Tests for nearby generated state changes.

## Axon 5 Modeling Rules

- A single aggregate-style concept may keep child membership state as a map on
  the aggregate state when MEDOL models it that way.
- Independent membership concepts should use tags that include the consistency
  boundary, for example `parentId` plus `memberId`, when each
  membership must have its own lifecycle.
- Do not model multiple children with a state object that stores only one child
  id unless the business really allows only one child.
- Command tags identify the event stream or DCB criteria. Display fields do not.
- Event handlers must be deterministic and side-effect free when evolving state.

## Implementation Steps

1. Confirm the command has every identifier required by the tag expression.
2. Confirm the event carries enough data to evolve state and project read models.
3. Implement or repair the state object:
   - aggregate-root style: state can contain maps/lists of child status.
   - independent concept style: state represents one membership/lifecycle.
4. Implement command handling and business rejection behavior from specs.
5. Update event application/evolve logic for every relevant event.
6. Add tests for success, duplicate/idempotent behavior, and rejection paths when
   test scaffolding exists.

## Verification

- Run backend compile or tests.
- If compilation fails, use `fix-generation-error` before adding manual
  workarounds.
