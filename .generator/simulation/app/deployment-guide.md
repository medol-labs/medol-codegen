# Deployment Stage

Simulation separates deployment, business data preparation, and business tests.
Deployment never invokes business commands or infers business workflows.
Environment preparation is a separate, optional prerequisite:

```bash
node simulation/src/prepare-environment.mjs simulation/pipelines/environment.json --plan
node simulation/src/prepare-environment.mjs simulation/pipelines/environment.json
```

Use `provisioner: existing` with `target: kubernetes` and a kubeconfigFile for
an existing environment. It only checks API and node readiness. For automatic
K3d provisioning use `provisioner: k3d`, clusterName, an Operations clusterConfig
file and optional workerNodes / registryConfig. Existing clusters are reused,
never recreated or resized automatically. Connection information is written to
the configured output file (default simulation/reports/environment.json).
Pass its kubeconfigFile to the deployment adapter. Ports, storage mounts and
network configuration belong in the Operations cluster asset, not business data.
Docker/Compose environment preparation is not implemented by this entry yet.
Operations supplies deployment assets; Simulation executes them locally or via
the existing SSH pipeline runner.

## K3d Restart Safety

Managed K3d environments default to `subnet: "auto"`, passed to K3d's
experimental IPAM feature as `--subnet auto`. An explicit non-overlapping IPv4
CIDR can be supplied instead. This overrides the cluster asset's subnet.
Environment preparation verifies explicit Docker endpoint IP assignments,
starts an existing cluster, waits for `/readyz` and all nodes Ready, and records
the actual subnet and node IPs in the environment report. Application readiness
remains the deployment stage's responsibility. A running container is not a
healthy Kubernetes node.

Legacy clusters using dynamic addresses are rejected without modification.
During a maintenance window, after recovering the cluster to a healthy state:

```bash
node simulation/src/k3d-network.mjs check <cluster-name>
node simulation/src/k3d-network.mjs pin <cluster-name> simulation/reports/network-backup.json
node simulation/src/prepare-environment.mjs simulation/environments/<environment>.json
```

`pin` saves a new, private endpoint snapshot before stopping the cluster, then
reconnects the same containers to the same network with their current IPs and
aliases. It never removes containers, volumes or Kubernetes records. Custom
IPv6/link/driver options require manual migration. If interrupted, keep the
cluster stopped and use the snapshot to complete the endpoint connections;
do not delete or recreate the cluster. Back up business data before maintenance.
Keep the network dedicated to the cluster: unrelated dynamic containers must
not consume stopped nodes' addresses. Check new nodes after any explicit resize.

For offline execution prefix the commands with `sh run-simulation.sh exec` and
run from the host toolkit directory. Existing toolkit workspaces must receive
both updated `simulation/src/prepare-environment.mjs` and `k3d-network.mjs`.
This is not applied by rebuilding application images.

Verify restart safety with a controlled stop/start and, in an approved window,
a host reboot: unchanged node IPs, API readiness, all nodes Ready, authenticated
application requests and retained business records. Do not automatically patch
Kubernetes node status or disable network policies during normal startup.

From the project root:

```bash
node simulation/src/deploy.mjs simulation/pipelines/deployment.json --plan
node simulation/src/deploy.mjs simulation/pipelines/deployment.json
```

Copy `deployment-config.json-example` to a maintained configuration, then provide a
trusted adapter under `simulation/extensions`. The example is not executable
until that adapter exists. The generator does not assume a project's cluster,
registry, credentials, health URLs, or special services.

`instances` refers to service names in `operations/model/services.json`.
Add non-generated services in `externalServices`; duplicate names are rejected.
`replicas` and `computeNodes` are independent: twenty service instances do not
imply twenty nodes. Placement and capacity policy belong in the target adapter.
The supplied plan must be honored by the adapter or rejected, never silently ignored.
Business ownership labels, taints and node assignment policies are not generated.
Projects may implement these in their handwritten preparation workflows after
business records exist; they must not be inferred from service names or counts.

## Adapter Contract

Export `createDeploymentAdapter(config, plan)` returning:

- `validateConnection()`: check the existing target only; never create a cluster.
- `prepareImages()`: resolve published images, preferably immutable digests.
- `deploy()`: apply Operations assets and the explicit instance configuration.
- `waitDeploymentReady()`: await resources and configured health checks; throw on timeout.
- `deploymentSnapshot()`: return nodes (`name`, `architecture`, `ready`), images
  (`source`, `reference`, `id`), clusterName, namespace, kubeconfigFile, endpoints,
  and credentialRefs (file/secret references only, never secret values).
- `cleanup()`: optional cleanup of temporary handles, not deletion of deployed resources.

K3d, Kubernetes and Compose implementations use the same contract, but this
generic runtime does not provide turnkey target adapters. Architecture is
checked after connection validation, before image preparation and deployment.
For Compose, report the Docker host as a node.

`simulation/reports/deployments` contains atomic step reports for failed and
successful attempts and a separate ready instance only after checks complete.
Raw error text is not persisted because it may contain credentials. Adapters
must also avoid logging credentials or embedding them in endpoint URLs.

## Remote Execution

Use a pipeline step with `phase: deploy` (or `ready`), `host` referencing an SSH
host, and command `['node', 'simulation/src/deploy.mjs', '<config path>']`.
The pipeline handles transport; the same deployment entry runs on that host.
Sync Operations assets, extension modules and configuration first. Reports and
localhost URLs belong to the execution host. Remote report collection is separate.

Build/publish remain independent pipeline phases. This deployment stage consumes
their published images rather than rebuilding as a side effect of deployment.
