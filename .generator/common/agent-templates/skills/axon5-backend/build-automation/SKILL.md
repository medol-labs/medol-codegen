---
name: axon5-backend/build-automation
description: Implement event-driven automation or policy behavior from a MEDOL slice.
---

# Build Automation

Use this skill when a MEDOL slice says an event should trigger another command,
notification, integration action, or policy.

## Read First

- Source event definition.
- Target command definition.
- Business rule or specification that explains when the automation fires.
- Existing automation or event-handler patterns in the generated backend.

## Rules

- Automation listens to events and dispatches commands; it does not mutate
  event-sourced state directly.
- The target command must include every identifier required by its tags.
- Guard against duplicate command dispatch if the source event can be replayed or
  delivered more than once.
- Keep external integration details outside pure state decision functions.
- Add feature flags or configuration only if the project already uses that
  pattern.

## Verification

- Unit test the trigger condition when test scaffolding exists.
- Compile backend after adding handlers or command dispatch code.
