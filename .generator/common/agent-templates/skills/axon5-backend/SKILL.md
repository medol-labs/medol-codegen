---
name: axon5-backend
description: Implement or repair generated Axon Framework 5 Kotlin backend code.
---

# Axon 5 Backend

Use this skill when changing generated Axon Framework 5 Kotlin backend code.
Pair it with `axon5-backend/build-state-change`,
`axon5-backend/build-read-model`, or `axon5-backend/build-automation` for
concrete slice work.

## Rules

- Keep event-sourced state changes inside the generated context and slice package.
- Use MEDOL command, event, tag, value object, and field names exactly.
- Commands must carry the identifiers required by their tags and business rules.
- Event-sourced state must be rebuilt from events only.
- Do not add hidden repository lookups to event-sourced decisions.
- Projection and read-model updates must subscribe to explicit generated events.
- Preserve Axon 5 annotations, package naming, and generated route naming.
- Prefer one vertical slice package over shared service layers.
- Do not collapse multiple organizations or members into one state field when
  MEDOL models a collection.

## Verification

Run `./mvnw test` or the smallest Maven compile/test command available in the
generated backend module.
