# Simulation Workflow

The complete workflow covers environment preparation, image build/publish, deployment,
case design, data preparation, test execution and result collection. Build and publish
are independently selectable stages (eight CLI stage names for seven workflow steps):

| Step | CLI stage | Responsibility | Output |
| --- | --- | --- | --- |
| 1. Environment preparation | environment | Create or connect infrastructure; verify architecture, networking and storage | Environment connection manifest |
| 2. Build and publish | build + publish | Compile, test, build target-architecture images and push to a registry | Image manifest with published references and digests |
| 3. Service deployment | deployment | Deploy selected services using the image manifest; verify readiness | Deployment instance and readiness evidence |
| 4. Case design | case-design | Generate, supplement, review and approve test cases | Approved case plan |
| 5. Data preparation | data-preparation | Create baseline business data and case-specific fixtures | Data IDs and readiness evidence |
| 6. Test execution | test-execution | Execute actions and verify assertions | Test results and assertion evidence |
| 7. Result collection | reporting | Collect reports, logs, artifacts and failure evidence | Evidence index and pipeline summary |

These seven steps define the workflow contract, not seven automatically implemented
business actions. Generated orchestration invokes configured commands/adapters.
Image tooling, infrastructure checks, data fixtures, assertion executors and log/artifact
collectors must implement the capabilities required by the project. Do not report
an unimplemented check as passed. See Implementation Boundaries below.

## Responsibilities And Precautions

### 1. Environment Preparation

Create infrastructure or connect to an existing environment. Check CPU architecture,
network reachability, DNS, exposed ports, storage capacity/mounts and access credentials.
Environment preparation is not limited to K3d: existing Kubernetes, Docker Compose
and other infrastructure require their own preparation/connection adapters.
The chosen provisioner determines what can be automated; a configured target alone
does not imply a working adapter. Provisioning must wait for actual API/node readiness.

Keep infrastructure capacity independent of business data and service replica counts.
Use explicit environment identities, connection manifests and Kubernetes contexts.
Never silently recreate a cluster or delete volumes to resolve a deployment failure.

### 2. Build And Publish

Compile and run source-level checks before building and publishing images. Specify
the target architecture independently of the build machine, and retain image references,
digests and verification results. Existing published images may be reused after verification.
This is a CI task, not environment preparation and not business acceptance testing.

Generated modules and external/project-specific services have separate build ownership.
Register external build commands explicitly; do not teach the generator their business
logic. Include required dependency images in offline delivery plans. Do not assume a
mutable tag identifies the same bytes on different machines or architectures.

### 3. Service Deployment

Consume verified image information and environment connections. Select services and
replica counts explicitly, supply configuration/secrets, then check rollout and service
readiness. Preserve deployed image digests and endpoints in the deployment evidence.
Operations provides deployment assets; Simulation orchestrates their execution.

Pod readiness does not prove domain initialization or business correctness. Business
registration, provisioning rules, node labels/taints and other domain-specific actions
belong in project extensions and the appropriate business-data workflow, not generic
deployment logic. Secrets are references in evidence, never exported plaintext.

### 4. Case Design

Use model-derived candidates, AI-assisted drafts or human-authored cases. Supplement
prerequisites, actions and assertions, review unresolved semantics, then explicitly approve.
AI is optional; model structure/specs provide candidates, not a guaranteed complete journey.
Case design can run offline and before any deployment. Capacity requirements can inform
environment sizing without making infrastructure creation a prerequisite for authoring.

Check model freshness and executor capabilities. Structural validation and human approval
do not implement missing actions or prove business assertions correct. Never approve
generated or AI-authored cases automatically merely to unblock execution.

### 5. Data Preparation

Baseline data preparation needs a ready deployment but does not require test cases.
Case-specific fixtures also depend on the selected reviewed cases and their data requirements.
Both can reuse an existing environment; neither must rebuild or redeploy it.
Use supported business APIs/adapters and await observable readiness before exporting IDs.

Deterministic IDs are not sufficient for idempotency. Define reuse/conflict/cleanup policies
explicitly. External datasets, binary artifacts and storage mounts require explicit inputs;
model field generation does not supply them. Do not confuse submitted commands with
completed projections. A partial preparation must not produce a ready-data manifest.

### 6. Test Execution

Consume approved cases and prepared-data evidence, validate their deployment identity
and live readiness, execute actions and check correlated assertions. Existing verified
data can be reused without repeating preparation. Source/unit tests in step 2 do not
replace this system-level validation.

Distinguish expected business rejection from authentication, network or timeout failures.
An accepted HTTP response alone is not evidence of downstream completion. Apply bounded
waits and explicit cleanup policies; do not resubmit non-idempotent commands blindly.

### 7. Result Collection

Collect the pipeline summary, per-case/assertion reports and explicitly configured logs,
artifacts and failure evidence. Include environment/deployment/image identities so results
can be reproduced. Run collection after failure where possible; missing evidence remains
missing, not successful. Collection success must not turn a failed test into a pass.

Only whitelist necessary evidence and redact credentials, personal data and sensitive
payloads. Remote evidence needs explicit transfer. The current runner writes summaries;
project collectors are responsible for additional logs/artifacts. Collection does not
implicitly clean up the environment or guarantee completion after a process/machine crash.

## Dependencies And Execution

Use explicit dependsOn edges: deployment depends on environment and publish;
publish depends on build; test-execution depends on case-design and data-preparation.
Existing images may be used without build/publish steps, but deployment must verify
their identity. The runner orders work sequentially; independent dependencies do
not imply parallel execution. Build tools and external services remain project-owned.

Each stage is selectable with --stage, including build, publish and reporting.
Selecting a stage does not execute its dependencies. Normal command failure skips
remaining non-reporting steps; reporting commands still run, even when dependencies
failed. Reporting must be terminal and cannot be a prerequisite for business work.
A reporting failure fails the pipeline; a successful report never hides earlier failure.
The controller always writes report.json for an executing pipeline, including step
statuses. Planning/configuration failures occur before a run is created. SIGKILL or
machine failure cannot guarantee finalization. No automatic recursive log/secret
collection is performed: reporting commands must explicitly whitelist evidence.
Remote reports stay on their execution host unless a reporting step transfers them.

Environment precedes deployment. Case design can happen without deployment.
Baseline data preparation depends on a usable deployment, not test cases.
Case-specific data preparation additionally depends on selected reviewed cases.
Execution depends on prepared data and reviewed cases. Case capacity requirements
may inform environment sizing before any infrastructure is created.

Pipeline steps use the eight CLI stage names above as `phase`, with explicit `dependsOn`
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

Step 5 has two independent operations, not one mandatory combined initialization:

| Operation | Inputs | Responsibility | Output |
| --- | --- | --- | --- |
| Baseline | Ready deployment | Initialize the minimum shared data required for system usability | baseline.json |
| Case fixtures | Ready deployment, approved cases, optional required baseline | Prepare only the selected cases' additional business data | case-data.json |

The application defines the exact boundary. Authentication/bootstrap data, dictionaries
or shared configuration may be baseline data; sample business records and test-specific
datasets belong to case fixtures. Do not encode application names or these examples as
generator rules. Baseline preparation must not require case authoring or submit tests.
Case preparation must not silently repeat baseline initialization.

Run separately against an existing deployment:

```bash
node simulation/src/prepare-data.mjs baseline --plan simulation/data/baseline-plan.json --environment simulation/instances/test.json --output simulation/data/results/baseline.json
node simulation/src/prepare-data.mjs case --plan simulation/data/case-plan.json --environment simulation/instances/test.json --output simulation/data/results/case-data.json --cases simulation/cases/approved/cases.json --baseline simulation/data/results/baseline.json
```

These paths refer to project-authored plans, not automatically supplied fixtures.
Use mode baseline and mode case respectively. Set `requiresBaseline: true` in a case
plan when initialization is required. Supply the baseline as the fifth positional
argument or `MEDOL_BASELINE_DATA_MANIFEST`. The runner rejects missing/non-ready
baselines and cross-deployment reuse before issuing requests. Case steps can use
`{"$ref":"baseline.records.0.someId"}` and record the baseline fingerprint in their output.
No baseline commands are executed implicitly. Add live wait checks for prerequisites;
matching manifest IDs alone do not prove the environment is still ready.

In pipelines, give the operations different step IDs under data-preparation:
prepare-baseline depends on deployment; prepare-case depends on prepare-baseline
and reviewed cases. Existing verified baseline evidence can satisfy the first
dependency via explicit reuse, without rebuilding, redeploying or initializing again.
Project entry points may expose separate commands; generic runners execute the plans.

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
node simulation/src/prepare-data.mjs baseline --plan simulation/data/baseline.json --environment simulation/instances/test.json --output simulation/data/results/baseline.json
node simulation/src/prepare-data.mjs case --plan simulation/data/case.json --environment simulation/instances/test.json --output simulation/data/results/case.json --cases simulation/cases/approved/cases.json --baseline simulation/data/results/baseline.json
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
node simulation/src/cases.mjs approve simulation/cases/review.json simulation/cases/approved/cases.json reviewer-name
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
node simulation/src/execute-cases.mjs simulation/cases/approved/cases.json simulation/instances/test.json simulation/data/results/baseline.json simulation/extensions/executor.mjs simulation/reports/new-report.json simulation/simulation-model.json
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
