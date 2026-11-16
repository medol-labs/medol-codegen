# Generic Data Preparation

Simulation generates one application-independent entry point: `src/prepare-data.mjs`.
It executes two separate operations in workflow step 5. It does not call project
scripts by name or infer initialization rules from entity/field names.

## Run Independently

From the project root, against an existing ready deployment:

```sh
node simulation/src/prepare-data.mjs baseline --plan simulation/data/baseline.plan.json --environment simulation/instances/deployment.json --output simulation/data/results/baseline.json
node simulation/src/prepare-data.mjs case --plan simulation/data/case.plan.json --environment simulation/instances/deployment.json --baseline simulation/data/results/baseline.json --cases simulation/cases/approved/cases.json --output simulation/data/results/case.json
```

The package scripts `data:baseline` and `data:case` provide the same entry point
from the generated Simulation directory. Environment and baseline inputs can also
come from MEDOL_ENVIRONMENT_MANIFEST and MEDOL_BASELINE_DATA_MANIFEST.
The pipeline example keeps baseline and case preparation as separate step IDs.

Baseline needs no cases. Case preparation requires an approved case plan and, by
default, a ready baseline belonging to the same deployment. An explicitly independent
case plan may set requiresBaseline=false. Passing a baseline still validates it.
Case preparation never executes baseline initialization implicitly.

## Plans And Operations

Generated `.json-example` plans are intentionally empty and not executable until
authored. They are scaffolds, not guessed business requirements. Maintain executable
plans separately so regeneration does not replace project-owned content.

Both plans use the existing data-plan schema:

- mode: baseline or case, matching the explicit command.
- steps: ordered command/wait operations; IDs must be unique.
- count and seed: repeat records with deterministic $uuid values.
- variables and $ref: reuse prior responses or baseline.records values.
- exports: explicitly select non-secret IDs/values to persist.
- caseIds and fulfillments: case plans map each selected requirement to preparation steps.

HTTP command steps POST body to an environment endpoint plus relative path. Wait
steps GET and poll expect.path until it equals expect.equals. Configure bounded
timeoutMs and pollIntervalMs. Commands are never implicitly retried. Cross-origin
redirects are rejected. Credentials belong in runtime BUSINESS_HEADERS or a trusted
adapter, never in exported records or plans committed to source control.

At least one explicit wait is required by prepare-data to produce ready evidence.
Author waits that actually prove relevant initialization/data readiness; an unrelated
health check cannot prove arbitrary domain invariants. Additional project validators
can verify an existing baseline before creating case data.

## Optional Trusted Adapter

Pass `--adapter simulation/extensions/data-adapter.mjs` when HTTP plans are insufficient.
The module exports a default object. Only named, declared operations may be invoked;
plans cannot supply arbitrary JavaScript or shell commands.

```js
export default {
  async validateEnvironment(environment) { /* check live connection */ },
  async validateBaseline(baseline, environment) { /* verify existing prerequisites */ },
  async headersFor({endpoint, url, environment}) { /* return scoped auth headers */
    return {};
  },
  operations: {
    initialize: {
      kind: 'command',
      async execute(step, {environment, baseline, index, signal}) {
        throw new Error('Implement this application operation');
      }
    },
    readiness: {
      kind: 'wait',
      async execute(step, {environment, baseline, index, signal}) {
        throw new Error('Implement a read-only readiness query');
      }
    }
  },
  async cleanup() { /* release clients/tunnels, not baseline business data */ }
};
```

Plan steps select `operation` instead of endpoint/path. Command handlers run once;
wait handlers may run repeatedly and must be read-only. Their return value becomes
the response used by $ref and expect. Respect AbortSignal and implement domain
idempotency explicitly. Validators must validate, not initialize hidden business data.
Adapter modules are trusted project code, not imported AI output. Authentication
and special storage/provisioning operations remain adapter responsibilities.

## Evidence And Limits

Outputs record mode, environment/deployment identity, plan fingerprint, readiness
checks and exported records. Case output also records baseline and case-plan
fingerprints. Changed plans need revalidation; these fingerprints are provenance,
not digital signatures. Existing manifests are not overwritten. Failures produce
no new ready manifest, but do not roll back successful commands.

Legacy `data-plan.mjs` remains the lower-level API. Use prepare-data for the strict
two-operation workflow and approval-fingerprint validation. No automatic synthesis
of correct business data is promised: model/AI/manual authors supply plans, and
the common runtime validates and executes them. Infrastructure-specific files,
dataset contents and project authorization policies are not built into the generator.
