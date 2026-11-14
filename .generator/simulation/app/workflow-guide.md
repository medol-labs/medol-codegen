# Simulation Workflow

Five independently invokable stages:

| Stage | Responsibility | Output |
| --- | --- | --- |
| environment | Create or connect infrastructure | Environment connection manifest |
| deployment | Deploy explicitly selected services, wait for readiness | Deployment instance |
| case-design | Draft, review and approve model/project cases | Approved case plan |
| data-preparation | Prepare prerequisites and await business readiness | Data IDs and readiness evidence |
| test-execution | Execute actions and assert results | Test report and evidence |

Environment precedes deployment. Case design can happen without deployment.
Baseline data preparation depends on a usable deployment, not test cases.
Case-specific data preparation additionally depends on selected reviewed cases.
Execution depends on prepared data and reviewed cases. Case capacity requirements
may inform environment sizing before any infrastructure is created.

Pipeline steps use the five stage names as `phase`, with explicit `dependsOn`
step IDs. The planner rejects missing dependencies and cycles, then orders steps.
Build/publish/validate and the legacy `test` (source checks) phase remain available
as supporting CI tasks. Legacy deploy/ready, seed and verify map to deployment,
data-preparation and test-execution respectively.

```bash
node simulation/src/run.mjs --mode local --pipeline simulation/pipelines/pipeline.json --plan
node simulation/src/run.mjs --mode local --pipeline simulation/pipelines/pipeline.json --stage environment
```

Selecting a stage does not silently execute prerequisites. For already completed
prerequisites, explicitly list their step IDs in `reuseCompletedSteps` after
checking the corresponding artifacts. This is an operator declaration, not an
automatic freshness or authenticity check. Reuse never appears as a newly passed
test. Steps must still verify the actual environment/data they consume.

## Reuse An Existing Deployment

Data preparation and test execution do not require the current pipeline to have
created their environment. Set:

```json
{
  "existingEnvironment": {
    "manifest": "simulation/instances/test-deployment.json",
    "remoteManifestPaths": {"worker": "/srv/project/simulation/instances/test-deployment.json"}
  }
}
```

The controller reads the local manifest and requires status `ready`, environment,
target and (for data/testing) deploymentId. Use a deployment instance, not only
the infrastructure preparation output. Existing deployments created outside
Simulation can be described with the same manifest contract, including endpoints
and credential references, without secrets. This declaration is not a live
health check; data/test entry points must validate connectivity before acting.

Environment/deployment steps are skipped, not recorded as newly successful.
Their dependencies are satisfied by the referenced deployment. Explicit case approval and
data dependencies are still enforced. Use `--stage data-preparation` or
`--stage test-execution` to run independently.

Commands receive `MEDOL_ENVIRONMENT_MANIFEST` pointing to the manifest. SSH steps
require a remoteManifestPaths entry for their host; operators must provision the
same manifest there. No implicit file transfer or credential copying occurs.
Project commands must read this input; legacy commands with fixed endpoints are
not automatically rewritten. Reports record the reused deployment reference.

## Independent Data Preparation

Data plans default to `mode: baseline`. They can prepare development/demo data
without any case plan. Their pipeline step depends on deployment only. Use
`mode: case` for case-specific fixtures: supply caseIds and an approved case plan;
each selected case dataRequirements entry must have an id and a corresponding
`fulfillments[caseId][requirementId]` array of data step IDs. This mapping is explicit
preparation intent, not proof that the resulting data satisfies arbitrary prose.
Model-derived field generation or AI-assisted synthesis is not performed here.

Example baseline plan (replace endpoints and commands with your project's contract):
```json
{
  "mode": "baseline",
  "seed": 1001,
  "count": 2,
  "steps": [
    {"id":"create","kind":"command","endpoint":"api","path":"/entities","body":{"id":{"$uuid":"entity"}}},
    {"id":"ready","kind":"wait","endpoint":"api","path":"/entities/ready","expect":{"path":"ready","equals":true}}
  ],
  "exports": {"entityId":{"$ref":"steps.create.request.id"}}
}
```

```bash
node simulation/src/data-plan.mjs simulation/data/baseline.json simulation/instances/test.json simulation/data/results/baseline.json
node simulation/src/data-plan.mjs simulation/data/case.json simulation/instances/test.json simulation/data/results/case.json simulation/cases/approved.json
```

The environment contains endpoints, environment and deploymentId. Without an
explicit environment argument, the CLI reads MEDOL_ENVIRONMENT_MANIFEST.
BUSINESS_HEADERS supplies authentication at runtime; do not export credentials.
Persisted manifests contain only explicit exports, seed, plan fingerprint,
environment/deployment identity, case IDs and completed readiness check IDs.
Without wait steps their status is prepared, not ready. Ready means only that the
configured checks passed, not that every possible business invariant was checked.
Output paths are create-only; failed preparation writes no success manifest.
Commands are not retried: deterministic IDs do not make arbitrary APIs idempotent.

Tests may consume existing data manifests without rerunning preparation. Project
test entry points must verify environment/deployment identity and current readiness,
then resolve IDs from records. The new case executor enforces deployment identity
and calls the project adapter's live validators. Configure reuseCompletedSteps for an omitted data
step only after that verification. Automatic fixture reuse and a universal test
discovery are not yet implemented. No credentials or entire HTTP responses
are implicitly persisted in the data manifest.

## Case Design Commands

Model generation, AI authoring and manual authoring share schemaVersion 2.
AI integration is provider-independent: export context, give it to your chosen
assistant, then import its JSON. No model provider is called by these commands.

```bash
node simulation/src/cases.mjs draft simulation/simulation-model.json simulation/cases/review.json
node simulation/src/cases.mjs new acceptance-case simulation/cases/manual.json
node simulation/src/cases.mjs ai-context simulation/simulation-model.json simulation/cases/ai-context.json
node simulation/src/cases.mjs import-ai simulation/cases/ai-response.json simulation/cases/ai-review.json
node simulation/src/cases.mjs import-manual simulation/cases/authored.json simulation/cases/manual-review.json
node simulation/src/cases.mjs validate simulation/cases/review.json
node simulation/src/cases.mjs check simulation/cases/review.json simulation/simulation-model.json
node simulation/src/cases.mjs approve simulation/cases/review.json simulation/cases/approved.json reviewer-name
node simulation/src/cases.mjs diff simulation/cases/review.json simulation/simulation-model.json simulation/cases/changes.json
```

All output commands create new files only. Imports reset approval to draft.
`diff` produces added/changed candidates and removed IDs without merging or
overwriting authored cases. Model-linked cases retain sourceScenarioId and a
sourceFingerprint; checking against the current model rejects stale cases.
Review and explicitly merge changed candidates before updating the fingerprint.

Each case has id, title, origin (model/ai/manual), status (draft/review/approved),
prerequisites, dataRequirements, steps, assertions, reviewIssues, timeoutMs and
cleanupPolicy (retain/cleanup). Data requirements are project-owned declarations
consumed by data preparation; they are not automatically executable fixtures.
Keep environment credentials and actual generated IDs in separate manifests.

Steps have unique id and type command/await-event/query; command and query steps
name their command or query. Assertions reference stepId and have one of:
- event: expected event name or model event reference in `event`;
- rejection: expected error text in `reason`;
- query: response `path`, operator equals/exists/contains, and `expected` except for exists.

Spec expectations generate assertions; flow expectations are marked flow-candidate
and require review. Given-state setup remains an explicit prerequisite, never a
silent database insertion. Approval requires no review issues and nonempty steps
and assertions. Draft validation allows incomplete work, but rejects malformed
steps, assertion references and execution policies.

Optionally pass executor capabilities as the third file to `check`:
`{"steps":["command","await-event"],"assertions":["event","rejection"]}`.
Unsupported types fail before execution. This declares a project's executor
contract; it does not add query assertion support to the existing scenario runner.
Use the new execute-cases entry point below for case JSON, not the legacy runner.
Command/query field contracts and project fixture references still require review
or a project-specific validator; structural approval is not proof of executability.

Draft generation is offline, creates a new file only, and never overwrites review
work. Model scenarios provide candidate steps and prerequisites, not a proven
business journey. Review unresolved issues, add assertions and set status to
approved. Structural approval checks do not prove assertions are correct or that
an execution adapter supports them. Project acceptance cases may be authored in
the same maintained plan without a sourceScenarioId. AI is optional.

## Implementation Boundaries

This change provides stage orchestration, explicit dependencies and a separate
case drafting/review gate. It does not implement automatic prerequisite synthesis,
a universal business assertion interpreter, or automatic fixture reuse by every project's
executor. Generic data plans can export manifests; legacy project scripts still need
to adopt them. Existing end-to-end project scripts may still combine data preparation
and testing and must not be represented as independently restartable stages until
their data manifests and consumers are implemented. No placeholder stage is
reported as passed. Business labels, taints and provisioning remain project code.

## Execute Approved Cases

```bash
node simulation/src/execute-cases.mjs simulation/cases/approved.json simulation/instances/test.json simulation/data/results/baseline.json simulation/extensions/executor.mjs simulation/reports/new-report.json simulation/simulation-model.json
```

The adapter is trusted project code, never code imported from AI case JSON. It
exports a default object with capabilities, execute(step, context), and live
validateEnvironment/validateData functions. Optional validatePlan checks domain
commands and field contracts before any action. execute returns
`{status:"ok",body:...}` or an explicit business `{status:"rejected",reason:...}`;
network exceptions are not accepted as expected business rejections.
Event assertions require observe(assertion, context) returning true only on a
correlated observed event. Query assertions compare response body paths.
Inputs and assertion values support `{"$ref":"data.records.0.entityId"}` or
`{"$ref":"steps.create.body.id"}`. Undefined references fail.

Approval fingerprints reject edited cases. They are change detection, not signed
authorization. The reviewer must resolve issues before using approve. Imports
reset approval. Use the current model argument to check model-linked freshness.
Timeouts abort the case and fail the report; adapters must honor the supplied
AbortSignal to stop in-flight I/O. Cleanup policy requires an adapter cleanup.
The executor does not roll back already accepted business commands.
Reports record each assertion result, fail fast and mark remaining cases skipped.
Missing events never pass, including in the legacy scenario runner.
