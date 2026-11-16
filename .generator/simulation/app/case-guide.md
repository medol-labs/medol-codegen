# Case Ownership

## Selecting Cases For A Run

Case libraries are not execution plans. Add optional `tags` and `suites` arrays
to cases before approval; editing these fields invalidates approval.

Create a selection JSON, for example `{"tags":["smoke"],"excludeIds":["slow-case"]}`.
Supported keys: `ids`, `tags`, `suites`, `excludeIds`, `failedReport`.
Values within tags/suites are OR; different selectors are AND. Exclusions win,
and library order is retained. Empty arrays, unknown IDs, unknown selector keys
and zero matches fail. An empty object explicitly selects the whole library.

```bash
node simulation/src/cases.mjs select simulation/cases/approved/cases.json simulation/cases/runs/run-001.json simulation/pipelines/case-selection.json
```

The output is create-only: choose a new path for each plan. It contains approved
case snapshots, selection criteria and SHA-256 fingerprints. Data preparation
uses this same file via `--cases`; execution uses it as the first argument to
`execute-cases.mjs`. Selected plans automatically determine data-plan caseIds;
project data operations and requirement fulfillments still need explicit configuration.
Selecting fewer cases does not automatically split a shared project fixture operation.

For retry, use `{"failedReport":"../reports/previous.json"}`. The CLI resolves this
path relative to the selection JSON. Only failed cases are selected, not skipped
cases; changed or missing case versions are rejected. Reports from older executors
without case fingerprints cannot be used. Create a fresh plan and prepare its data
before retrying; existing environments and baseline data may be reused.
Tests stop at the first failure; remaining selected cases are skipped.
Prerequisites remain explicit data/business preconditions, not automatic execution
dependencies between cases.

| Directory | Contents | Owner |
| --- | --- | --- |
| generated/ | Model-derived candidates, origin=model, status=draft | Model export and draft command |
| manual/ | Hand-authored or edited source plans | Project maintainers |
| ai/ | AI-produced proposals, origin=ai, status=draft | Project review workflow |
| approved/ | Reviewed execution snapshots retaining their origin | Explicit reviewer |

The project generator creates this guide and directory placeholders only. It never
emits or overwrites project-owned plans in manual/, ai/ or approved/. Scenario JSON
under ../scenarios is generated flow metadata, not reviewed acceptance cases.

From the simulation directory, generate a fresh version of candidates:

```sh
npm run cases:draft -- cases/generated/model-drafts-v1.json
node src/cases.mjs validate cases/generated/model-drafts-v1.json
```

Use a new output filename on subsequent exports. All case-writing CLI commands
refuse to overwrite an existing file, including generated drafts. Review the diff
against the new simulation-model.json before replacing any execution snapshot.

```sh
node src/cases.mjs new example-case cases/manual/example.json
node src/cases.mjs import-ai proposal.json cases/ai/proposal-v1.json
node src/cases.mjs diff cases/generated/model-drafts-v1.json simulation-model.json cases/generated/model-diff-v2.json
```

Complete prerequisites, dataRequirements, steps and assertions; resolve reviewIssues
before approval. Copy model-derived plans to manual/ for editing while retaining
origin=model, sourceScenarioId and sourceFingerprint. Directory ownership does not
change provenance. A genuinely new hand-authored case uses origin=manual.

```sh
node src/cases.mjs approve cases/manual/example.json cases/approved/example-v1.json reviewer-name
node src/cases.mjs check cases/approved/example-v1.json
```

Approval preserves origin and fingerprints the reviewed content. Editing a reviewed
case invalidates that approval. A reviewer label records who performed the review;
it is not a cryptographic identity or proof of user approval. Pipeline inputs must
explicitly select approved snapshots, not discover and execute every JSON file.

FLOW candidates describe reachable paths, not guaranteed business expectations.
SPECIFICATION candidates derive expectations from model specifications. Neither
automatically supplies correct fixtures or executor implementations, and neither is
automatically approved. Generation and approval are not successful test execution.
