# Offline Simulation Tool Container

This is a short-lived administrative executor, separate from the Simulation HTTP
service and from business services. The image contains Node.js, Docker CLI/Compose,
K3d, kubectl, curl, rsync, SSH and a versioned public project snapshot. No npm or
package installation occurs when it runs. The Linux target only needs Docker and
a POSIX shell; it does not need Node.js, kubectl or K3d installed on the host.

## Build And Deliver

On a connected build machine, from the project root:

```sh
node simulation/toolkit/package.mjs simulation/toolkit/config.json bundles/toolkit-001 --build
```

Create `config.json` from `config.json-example`, with an explicit image version and
`linux/arm64` or `linux/amd64`. `inputs` is a project-relative allowlist. Include
project adapters, bootstrap scripts and non-sensitive synthetic fixtures they
import. Public credential-generation policies must be reviewed and explicitly
listed in `publicPolicies`; actual credentials never belong in that list.

The packager refuses symlinks and existing outputs; excludes runtime reports,
instance registries, .env, secrets, private files, kubeconfigs, archives and local
volumes. This is a filename-based safeguard, not a general secret scanner: review
`manifest.json` and the staged `project/` tree before building. Real datasets and
credentials must be supplied separately. No business names are built into the
generic packager or executor. Additional npm dependencies in custom scripts need
an explicitly extended image; the stock runtime has no npm dependencies.

Without `--build`, only a reviewable build context is prepared. BuildKit caches
tool layers when only the project snapshot changes. A changed snapshot requires
a new tool image, not rebuilding business images. Base versions are pinned in the
Dockerfile; review versions/security advisories and use immutable base digests for
a controlled release. Building needs access to the base images, Alpine packages,
GitHub K3d releases and Kubernetes downloads, or mirrors prepared beforehand.

Deliver `simulation-tool.tar`, `SHA256SUMS`, `image-reference.txt`, `manifest.json`
and `run.sh` through the approved offline channel. On the Linux target:

```sh
sha256sum -c SHA256SUMS
docker load -i simulation-tool.tar
export SIMULATION_TOOL_IMAGE="$(cat image-reference.txt)"
export SIMULATION_WORKSPACE=/home/operator/simulation-test-001
sh ./run.sh init
sh ./run.sh info
```

`init` requires an empty directory and copies the embedded public snapshot only
once. It never overwrites an existing workspace. Use a dedicated path, not a
production checkout. Preserve `.simulation-toolkit.json`, configuration, private
credentials, kubeconfig, registries and evidence together for later maintenance.
The image snapshot must match the initialized workspace. For an upgrade, initialize
a new directory and explicitly migrate configuration; do not erase old state to
bypass the mismatch check. Local config edits are permitted and remain on disk.

## Execute Stages Manually

All paths below are examples; select the actual declarations supplied by the
project. `run.sh` accepts the existing Simulation CLIs rather than inventing a
second deployment workflow. SSH is optional: these commands execute locally on
the target and work without the original development machine.

1. **Environment**: `sh run.sh environment simulation/environments/test.json`.
   Then register observed readiness with
   `sh run.sh registry register-environment <definition.json> <readiness.json>`.
2. **Build/publish**: normally performed before the offline delivery, not on the
   target. Import all business/infrastructure images or publish them to the
   reachable intranet registry. This tool tar is NOT those images.
3. **Deployment**: resolve a deployment, create credentials under the applicable
   policy, deploy and register the resulting instance. Example:

```sh
sh run.sh registry resolve-deployment simulation/deployments/test.json simulation/reports/resolved.json
export MEDOL_PIPELINE_RUN_ID=deploy-001
export MEDOL_DEPLOYMENT_CONFIG=simulation/reports/resolved.json
sh run.sh task simulation/pipelines/tasks.json secrets
sh run.sh task simulation/pipelines/tasks.json deploy
sh run.sh registry register-deployment simulation/deployments/test.json simulation/reports/workflows/deploy-001/deployment.json
```

4. **Case design**: create a separate test run and select approved cases.
5. **Data preparation**: initialize baseline data separately from case data.
6. **Test execution**: run the selected tests, preserving failures.
7. **Reporting**: collect assertions, logs and artifacts into that run's evidence.

```sh
sh run.sh registry create-run test-001 <registered-instance-id>
export MEDOL_SIMULATION_RUN_ID=test-001
export MEDOL_PIPELINE_RUN_ID=test-001
sh run.sh task simulation/pipelines/tasks.json select-cases
sh run.sh task simulation/pipelines/tasks.json prepare-baseline
sh run.sh task simulation/pipelines/tasks.json prepare-case
sh run.sh task simulation/pipelines/tasks.json test
# Reporting is project-defined, for example:
sh run.sh exec node simulation/extensions/scenarios/collect-evidence.mjs test-001
```

Task names are supplied by the project, not predefined by the tool container.
Data/tests may bind to an already registered deployment; do not recreate it for
every test. Outputs survive `--rm` in the host workspace. Use a new run ID for a
new attempt; never overwrite a failed run to claim success. Test credentials may
only be generated in an explicitly disposable test environment. Production uses
approved Secrets and a production configuration, never automatic test accounts.

## Offline Prerequisites And Security

- The tool runs with **host networking** on Linux. Localhost API endpoints and
  `kubectl port-forward` remain usable. The same absolute workspace path is mounted
  inside and outside, so Docker bind mounts and absolute kubeconfig paths agree.
  Hostname is preserved for environment/instance registry identity checks.
- Docker socket access is effectively host-admin access. Only trusted operators
  may run this image. The launcher uses the caller UID/GID plus the socket group;
  it does not use `--privileged`, modify host groups, or silently run sudo. Rootless
  Docker, remote Docker daemons and Docker Desktop are not covered by this launcher.
- The launcher never pulls its own image and rejects architecture mismatches.
  It does not mount `$HOME`, SSH keys or Docker credentials. For authenticated
  registries/SSH, arrange narrowly scoped credentials explicitly, not in the image.
- Do not bundle another machine's kubeconfig or instance/run records. Register the
  environment on the target host with an explicit kubeconfig under the workspace.
- **K3d requires additional images**: the selected K3s image, matching K3d proxy
  and tools images, and K3s system workload images (DNS, storage provisioner,
  metrics, etc.). Inventory the actual versions and preload them or mirror them.
  Host Docker image loading alone does not populate K3d/containerd node stores.
  Use `sh run.sh exec k3d image import <archive> -c <cluster>` when applicable.
- Business images, custom runtime engines, model artifacts, data, registry
  certificates and private configuration are separate delivery inputs. Existing
  deployment adapters that verify registry digests still require an **intranet
  registry**; merely loading Docker tar files does not bypass that requirement.
  Do not claim fully disconnected deployment until tested with that registry or
  a separately validated archive-import deployment path.
- Review host inotify limits, resource capacity, firewall ports and storage before
  creating many K3d workers. The tool never changes host sysctl values automatically.

Tool references: [Docker CLI image](https://hub.docker.com/_/docker),
[K3d release installer](https://github.com/k3d-io/k3d/blob/v5.8.3/install.sh),
[kubectl checksum verification](https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/).
