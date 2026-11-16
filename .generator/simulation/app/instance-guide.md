# Environments, Deployment Instances And Runs

These are independent identities, not names for pipeline stages:

| Resource | Definition | Observed state |
| --- | --- | --- |
| Environment | `environments/*.json`: infrastructure ID, mode, provisioner, connection references | `instances/environments/<id>.json`: readiness and infrastructure identity |
| Deployment | `deployments/*.json`: instance ID, environmentId, namespace or Compose project, workload configFile | `instances/deployments/<id>.json`: immutable ready deployment snapshot, endpoints and image references |
| Run | `registry.mjs create-run`: run ID and selected deployment instance | `reports/workflows/<id>/run.json`: immutable instance, environment and reusable data snapshots |

The existing `environment: local/test` field is an Operations configuration profile,
not an infrastructure identity. Multiple clusters may use the same profile. Each
cluster needs a different environment ID and dedicated kubeconfig; multiple apps
in one cluster need separate instance IDs and namespaces. Compose instances use
explicit Docker contexts and distinct Compose project names. Endpoint ports and
storage paths must also be isolated by the deployment adapter.

## Environment Preparation

`mode: managed, provisioner: k3d, target: kubernetes` may create a missing cluster.
`mode: existing, provisioner: existing` only checks existing infrastructure.
Existing Kubernetes and Docker Compose environments are supported. Environment
preparation does not deploy business services. Docker Compose requires Docker
Engine and Compose to already be installed; it does not install a daemon.

Run commands from the project root on the execution worker. For remote workers,
use the existing SSH pipeline/worker transport; registration itself does not SSH.
Private kubeconfig files and credentials stay on that worker. Definitions contain
paths or credential references, never tokens, passwords or kubeconfig contents.

```bash
node simulation/src/prepare-environment.mjs simulation/environments/test.json
node simulation/src/instance-registry.mjs register-environment simulation/environments/test.json simulation/reports/environment-test.json
```

Preparation captures the Kubernetes `kube-system` namespace UID or Docker daemon
ID. The registry records the worker hostname as well. Test tasks check these live
before business operations; pointing a connection file at a replacement cluster
does not silently reuse old data. Use a dedicated kubeconfig with its intended
current context, not a shared file whose current context changes between tasks.

## Deployment Instances

```json
{
  "id": "test-app-01",
  "environmentId": "test-cluster",
  "namespace": "test-app-01",
  "configFile": "simulation/pipelines/deployment-config.json"
}
```

For Compose, replace `namespace` with `composeProject`. Workload settings stay in
configFile; resolve them against the registered environment instead of copying
connection settings between workload configurations:

```bash
node simulation/src/instance-registry.mjs resolve-deployment simulation/deployments/test-app-01.json simulation/reports/resolved-deployment.json
node simulation/src/deploy.mjs simulation/reports/resolved-deployment.json
node simulation/src/instance-registry.mjs register-deployment simulation/deployments/test-app-01.json simulation/reports/deployments/DEPLOYMENT_ID.json
```

The deployment adapter must return a ready manifest with deploymentId, target,
environment, endpoints and image references. Kubernetes also requires namespace
and kubeconfigFile; Compose requires composeProject and dockerContext. Registering
an existing deployment uses its ready manifest and does not redeploy services.
The registry verifies the infrastructure connection and captures namespace UID.
Registration is not a replacement for the adapter's live service readiness checks.

The generated `src/runtime/compose-deployment.mjs` provides a Compose deployment
adapter for explicit `dockerContext`, `composeProject`, `files`, `envFile`,
`platform` and single-instance `instances` entries. A project extension can pass
it to `executeDeployment`. It verifies local image architecture, deploys with
`--pull never --wait`, checks configured `healthUrls`, and returns daemon identity
and image IDs. Build/publish images separately. It does not create business data,
install Docker, delete volumes or infer application topology.

Records are create-only. After rebuilding a cluster or redeploying a version, use
new environment/instance IDs as appropriate. Registry commands never delete
clusters, namespaces, volumes or workloads. Managed describes provisioning
ownership, not blanket permission to clean data. Existing infrastructure is never
automatically deleted. Cleanup remains a separately approved adapter operation.

## Independent Test Runs

```bash
node simulation/src/instance-registry.mjs create-run smoke-001 test-app-01 --baseline simulation/reports/previous/baseline.json
export MEDOL_SIMULATION_RUN_ID=smoke-001
node simulation/src/task.mjs simulation/pipelines/tasks.json select-cases
node simulation/src/task.mjs simulation/pipelines/tasks.json prepare-case
node simulation/src/task.mjs simulation/pipelines/tasks.json test
```

Omit --baseline and run the baseline task when fresh baseline data is required.
Optional --data and --plan snapshot existing data and a selected execution plan.
Do not run selection again when intentionally reusing a plan. Data must belong to
the selected deploymentId; execution still verifies the exact case-plan fingerprint.
No environment creation or deployment step is needed for an existing instance.

Tasks used in bound runs declare `scope: execution` and bind their inputs:

```json
{
  "scope": "execution",
  "inputs": {
    "environment": {"artifact": "deployment.json", "binding": "deployment"},
    "baseline": {"artifact": "baseline.json", "binding": "baseline"},
    "cases": {"artifact": "execution-plan.json", "binding": "plan"}
  }
}
```

Bindings use run snapshots first, otherwise artifacts produced in the same run.
An environment-variable override cannot change a snapshotted binding. Execution
tasks emit `<task>.binding.json` containing environment/instance/deployment/run IDs
and input fingerprints. Existing fail-fast and immutable output policies remain.
Previously supported unbound pipelines continue working with MEDOL_PIPELINE_RUN_ID;
MEDOL_SIMULATION_RUN_ID always requires a registered run and fails if it is absent.

An execution-only pipeline may be invoked with `run.mjs --mode local|remote
--pipeline <file> --run smoke-001`. The run must already exist on the execution
worker. This mode rejects environment/build/publish/deployment steps and the old
existingEnvironment override. Remote steps receive the same run ID explicitly.
Infrastructure-specific business adapters may still require Kubernetes; the
registry does not make such adapters portable to Compose automatically.

```bash
node simulation/src/instance-registry.mjs list environments
node simulation/src/instance-registry.mjs list deployments
node simulation/src/instance-registry.mjs list runs
node simulation/src/instance-registry.mjs show deployments test-app-01
node simulation/src/instance-registry.mjs check-run smoke-001
```

List/show are stored snapshots, not live health claims. check-run checks worker and
infrastructure identity; application health and data validity remain executor
checks. Generated registry state and run reports are local artifacts, ignored by
Git and excluded from source synchronization. Collect run.json and task binding
reports explicitly for remote evidence; never sync another worker's registry over
the destination registry.
