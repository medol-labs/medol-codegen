# Configuration-Driven Workflows

Maintain business workflows as reviewed case JSON, not JavaScript callbacks named
after business commands. The built-in HTTP executor is shared by preparation and
test execution. Infrastructure provisioning and non-HTTP protocols may use trusted
adapters. Do not hide an entire business journey inside an adapter operation.

## Ownership

- `cases/generated/`: model-derived candidates, not automatically approved tests.
- `cases/manual/`: project-maintained steps, payloads, assertions and data needs.
- `cases/approved/`: immutable reviewed snapshots. Changed steps require a new
  approval; old run evidence must retain the original snapshot and fingerprint.
- `pipelines/`: task routing, endpoint aliases and credential variable names.
- `extensions/`: special protocol/infrastructure adapters only for new workflows.

Model/AI drafts still need explicit API mappings and verified expectations.
An HTTP 2xx does not prove that an event, projection or business transition occurred.

## Steps

`command` sends one POST; `query` sends GET and optionally waits for projections.
`command` and `query` names document intent, not dispatch to business JS functions.
Both carry `request`: `endpoint`, relative `path`, optional `target`, `query`, `body`,
`timeoutMs`, `pollIntervalMs`, `expect` (exact property matches), `checks` and
`failWhen` (terminal conditions). Authentication/network errors fail immediately;
POSTs are never automatically retried. For idempotent preparation query first,
conditionally create when absent, then wait for and verify the resulting projection.

`foreach` carries `items`, `as`, optional `indexAs`, nested `steps`, `exports` and
`maxItems` (default 1000). Iterations are sequential and isolated; each inherits
parent results. Empty collections fail unless explicitly `allowEmpty: true`.
`assert` evaluates `value` without network calls. Any step may have `when` with
`value`, `operator`, `expected`. Skipped steps have no result to reference.

Inline `assertions` check the current result body with `path`, `operator` and
`expected`. Operators: equals, notEquals, exists, contains, gte, gt, setEquals,
unique. Foreach results expose `items`, populated from each iteration's exports.
Top-level assertions retain their `stepId` form. Event assertions require a real
observation adapter; the HTTP executor does not invent event evidence.

Expressions (no JavaScript evaluation): `$ref`, `$uuid: true`, `$now` (`iso` or
`localDateTime`, UTC without offset), `$length`, `$get: [object, path]`, `$coalesce`,
`$concat`, `$urlPath`, `$flatten`, `$map: {from, path}`, `$select: {from, where}`,
`$at: [array, index]`, `$subtract: [left, right]`. References address `environment`,
`data`, `steps`, `variables` and named iteration values. Missing `$ref` fails;
`$get` is optional lookup. `$urlPath` accepts one URL or an array of URLs.

```json
{
  "id": "create",
  "type": "command",
  "command": "CreateRecord",
  "when": {"value": {"$ref": "steps.lookup.body.totalElements"}, "operator": "equals", "expected": 0},
  "request": {
    "endpoint": "service",
    "path": "/records/create",
    "body": {"recordId": {"$ref": "variables.recordId"}}
  }
}
```

## HTTP Configuration

Endpoint aliases resolve against `environment.endpoints`. An alias may set
`environmentEndpoint` to share another base. Repeated deployments use `collection`,
`key`, `urlField` and optional `suffix`; requests select a member with `target`.
Cases therefore do not depend on Compose, Kubernetes or a specific cluster.

Credentials use `bearerTokenEnv`, `headersEnv`, or explicit `anonymous: true`.
An optional workspace-local `envFile` is overridden by process environment values.
`request.bodyEnv` maps body fields to environment names for login/setup requests;
`request.bearerToken` can reference a preceding login response in memory.
`acceptStatuses` explicitly permits expected statuses (for example 401 during an
initial login probe); subsequent steps must verify successful authentication.
Never put credentials in JSON, exports or evidence. Responses are not persisted
by default; `evidence` and preparation `exports` are explicit allowlists.

At least one live `probes` entry is required. Artifact queries use
`request.download: {url, digest, maxBytes}`; only the configured endpoint's origin
and path prefix are allowed, redirects are refused, and nonempty bytes must match
SHA-256. Do not treat URI existence as artifact verification.

## Task Entry Points

Use module `simulation/src/workflow-tasks.mjs` in task configuration:

| Export | Inputs | Output |
| --- | --- | --- |
| select | library, selection | Fingerprinted execution plan |
| test | environment, data, cases, config | Step/assertion report |
| prepare | environment, plan, baseline?, cases?, config | Existing flat data-plan manifest |
| prepareWorkflow | environment, workflow, baseline?, cases?, config, inputs?, fulfillments? | Preparation manifest and separate preparation report |

`workflow` is a reviewed case plan, not arbitrary JS. `inputs` becomes
`data.inputs`; existing baseline records remain `data.records`. Each workflow
case exports one record. For case preparation, map every selected requirement in
`fulfillments[caseId][requirementId]` to a preparation workflow case that exports
data. Missing mappings fail before I/O. Manifests bind to the deployment and
selected execution plan; preparation success is not a test verdict.

Preserve the seven phases: infrastructure, build/publish, deploy, design cases,
prepare data (baseline separate from case fixtures), execute tests, report.
Existing environments may enter at preparation/testing after live checks. Keep
model-specific fixture contents and assertions in the project, never the generator.
### Sequencing approved cases

Use `runCaseSequence(sequence, context, execute, adapters)` to execute an ordered list of case references.
Each entry declares `case`, `endpoint`, `inputs` and optionally `when`. Inputs may refer to earlier
exports via `outputs.<case>.<field>`. An optional `onResult` names a trusted adapter supplied by
the host (for example, to update fixture identifiers). Unknown adapters fail before execution;
skipped steps and previews without outputs do not invoke them. Keep service paths, business
states and workflow order in project configuration.
