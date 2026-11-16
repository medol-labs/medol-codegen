# Generic Execution And Project Extensions

Run commands from the project root. Generic scripts under simulation/src are
generator-owned; project modules under simulation/extensions and executable JSON
plans are maintained by the project and survive regeneration.

Prefer built-in prepare-environment, deploy, prepare-data, cases and execute-cases
for supported contracts. A task is an escape hatch for trusted project operations,
not a replacement for their case approval, readiness or assertion validators.

## Project Tasks

```json
{
  "tasks": {
    "initialize": {
      "module": "simulation/extensions/setup.mjs",
      "export": "initialize",
      "inputs": {
        "environment": {"artifact": "deployment.json", "env": "MEDOL_ENVIRONMENT_MANIFEST", "status": "ready"},
        "config": {"path": "simulation/data/setup.json"}
      },
      "output": "baseline.json"
    }
  }
}
```

The module exports async initialize(inputs, {root, runId, directory}) and returns
a JSON result. It owns domain actions, authentication, semantic validation and
resource cleanup. Never return secrets. The common entry resolves inputs, confines
modules (including symlinks) to extensions, locks the output before invoking code,
writes a private create-only result and sanitized failure evidence. It rejects
existing outputs before side effects. Only ready/passed/completed results succeed
by default; tasks can declare successStatuses for another explicit terminal status.
Missing, unknown, running, skipped or cancelled statuses never silently pass.

```sh
MEDOL_PIPELINE_RUN_ID=run-001 node simulation/src/task.mjs simulation/pipelines/tasks.json initialize
```

Artifacts reside under simulation/reports/workflows/run-001. Input env overrides
allow reuse of existing deployments/data. Output names are filenames, not paths.
After abrupt process termination, inspect the operation before manually removing
a stale .lock; retries are not a substitute for domain idempotency. Use the pipeline
runner's timeoutMs to bound task processes. No automatic rollback is performed.

## Worker Transfer

```json
{
  "hostRef": {"pipeline": "simulation/pipelines/remote.json", "host": "worker"},
  "inputs": ["operations/", "simulation/"],
  "excludes": ["datasets/"],
  "artifacts": ["deployment.json", "baseline.json"],
  "required": ["deployment.json"]
}
```

```sh
node simulation/src/worker.mjs sync simulation/pipelines/worker.json
MEDOL_PIPELINE_RUN_ID=run-001 node simulation/src/worker.mjs collect simulation/pipelines/worker.json
```

Sync uses an explicit input allowlist, does not delete remote files and excludes
private state by default. Exclusions are not secret discovery: audit project inputs
and add project-specific patterns. Credentials/registry configuration are provisioned
separately. Collection fetches only listed JSON artifacts, preserves existing files,
accepts identical copies and flags conflicts. Required missing/conflicting artifacts
fail collection; each attempt gets its own evidence index. Local execution needs no
transfer step: call the same task or built-in entry directly.

hostRef reads target/workDir from the selected pipeline hosts entry, avoiding two
copies of deployment destinations. A standalone transfer config can instead declare
host: {transport: "ssh", target: "test-worker", workDir: "/srv/test-project"}.
Exactly one of host and hostRef is allowed. Referenced paths are project-relative.

## Shared Runtime Utilities

`src/runtime/readiness.mjs` exports waitUntil(label, probe, options). It returns the
probe's truthy result, bounds asynchronous probes by timeoutMs, supports cancellation
and propagates errors. Probes should honor their AbortSignal; timeout cannot undo
side effects or preempt blocking synchronous code. Polling policy remains explicit.

`src/runtime/kubernetes-access.mjs` exports createKubernetesAccess({kubeconfig}).
Use forward({namespace, service, localPort, remotePort, ready}) and always await
close() in finally. Readiness receives the loopback URL and AbortSignal. It does not
assume a framework health endpoint or attach authentication. Failed startup cleans
up the child process; access binds only 127.0.0.1. Kubernetes configuration must be
explicit, never implicitly taken from a user's default context.

Keep business names, node labels/taints, credential policies, data contents and
expected training results in project modules/configuration, never generic scripts.

## Fixture Transfer

`src/runtime/fixtures.mjs` exports provisionFixtures(fixtures, environment, {root}).
Each fixture declares id, source, sha256, optional localPath, and destinations.
IDs do not select behavior. Each destination declares transport, nodeSelector and
absolute path. The built-in k3d-node-file transport requires explicit kubeconfig
and clusterName and verifies that selected nodes are K3d worker containers.
Unknown transports fail explicitly. Validate case approval and data requirements
before invoking transfers. All sources are preflighted; source and optional local
copy paths must stay inside root. Destination hashes are verified after transfer.
Transfer failure can leave already-copied files; no ready manifest is produced.

Model-generated input mappings must be explicit. Missing mappings remain
Unresolved, not inferred from field names. Drafts report these as review issues;
execution refuses unresolved manual inputs before sending commands. Only fields
explicitly marked generated can receive generated values without a supplied source.

## Kubernetes Instance Packages

`src/runtime/kubernetes-instances.mjs` provides instanceSlot, instanceOverlay and
createKubernetesInstances. A trusted project package describes resources, patches,
image mappings, namespace/endpoint templates, explicit Secret names, readiness
deployments and optional enrollment. Services and application settings are package
data, not generator rules. Bindings use {{name}} without executable expressions.
Missing bindings and namespace collisions fail; resource paths must remain inside
the supplied workspace. Deployment renders all instances before mutation.
Enrollment checks declared immutable identity keys before changing its ConfigMap.
It never creates business identities or invents registration values.

This adapter targets Kubernetes. It does not provision clusters and does not imply
Docker Compose support. Projects select their package in a hand-written extension;
generated Operations resources remain separate from project-maintained overlays.

## Test Credentials

`src/runtime/test-credentials.mjs` exports prepareTestCredentials(config, {root}).
Configuration declares schemaVersion=1, environment, stateFile, generate (names),
and outputs (format env/json, path, template). Structured {"$secret":"name"}
references resolve generated values. State is reused, never silently rotated.
Outputs are preflighted, private, workspace-bound and reject symlink traversal.
A lock prevents concurrent initialization. Existing conflicting or unmanaged
outputs are not overwritten. Errors and returned manifests contain no credentials.
Partial filesystem failures may leave private state for a subsequent retry.
This is explicitly test infrastructure, not a production secret-management system.

Data commands use their configured timeoutMs; wait probes retain a ten-second
per-request cap within their overall deadline. Adapters must honor AbortSignal.

## Deployment Service Dependencies

Use `mergeServiceCatalog(base, extension)` from runtime/deployment.mjs to combine
generated service metadata with a hand-maintained catalog extension. Extensions
can add services or supply metadata for existing names. Inputs are not mutated;
duplicate names within either catalog are rejected.

A service may declare `requires: ["another-service"]`. When it has positive
replicas, all dependencies must also be explicitly selected with positive
replicas. Missing, unknown, duplicate and self dependencies are errors before
adapter creation. This is co-deployment validation, not rollout ordering,
automatic dependency deployment or a health check. Application-specific names
and rules belong in project configuration, never the generator.

## Kubernetes Deployment Packages

`createKubernetesDeployment(bundle, config, dependencies)` consumes an existing
kubeconfig. It never creates clusters or invokes provisioning shell scripts.
The bundle declares namespace, resources, secrets, workspace, images, optional
component files/patches, endpoints and HTTP probes. Bindings use explicit
`{{name}}` substitution, not executable expressions.

Execution validates API/node readiness, pulls selected images for config.platform,
verifies architecture and registry digest, renders Kustomize before cluster
mutation, applies existing Secrets and manifests, then checks deployment rollouts
and HTTP probes. Images marked always also support later on-demand deployments.
`config.images` overrides references by service name for private registries;
no mirror or alternate architecture is inferred. This adapter requires registry
images; importing local images belongs to infrastructure-specific preparation.

Optional imageTargets map verified service images to ConfigMap keys. Concrete
resource names, policies, endpoints and template files belong to the project.
Readiness does not seed business data, create users or launch tests. Secrets are
not included in snapshots or logged command output.
