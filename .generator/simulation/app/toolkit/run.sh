#!/bin/sh
set -eu
# Linux host networking preserves localhost kubeconfig and port-forward semantics.
[ "$(uname -s)" = Linux ] || { echo 'Run this launcher on the Linux deployment host.' >&2; exit 1; }
: "${SIMULATION_TOOL_IMAGE:?Set SIMULATION_TOOL_IMAGE to the imported tool image tag}"
: "${SIMULATION_WORKSPACE:?Set SIMULATION_WORKSPACE to a dedicated absolute host directory}"
case "$SIMULATION_WORKSPACE" in /*) ;; *) echo 'Workspace must be absolute' >&2; exit 1;; esac
[ "$SIMULATION_WORKSPACE" != / ] || exit 1
mkdir -p "$SIMULATION_WORKSPACE"
workspace=$(cd "$SIMULATION_WORKSPACE" && pwd -P)
case "$workspace" in *,*) echo 'Workspace cannot contain a comma' >&2; exit 1;; esac
docker info >/dev/null
[ -S /var/run/docker.sock ] || { echo 'Local Docker socket required' >&2; exit 1; }
# Never pull implicitly on the offline worker or emulate another architecture.
actual=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$SIMULATION_TOOL_IMAGE")
case "$(uname -m)" in aarch64|arm64) expected=linux/arm64;; x86_64) expected=linux/amd64;; *) exit 1;; esac
[ "$actual" = "$expected" ] || { echo "Image platform $actual does not match host $expected" >&2; exit 1; }
exec docker run --rm --pull=never --network=host --hostname "$(hostname)" \
    --user "$(id -u):$(id -g)" --group-add "$(stat -c %g /var/run/docker.sock)" \
    --mount "type=bind,src=$workspace,dst=$workspace" --workdir "$workspace" \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --env MEDOL_PIPELINE_RUN_ID --env MEDOL_SIMULATION_RUN_ID \
    --env MEDOL_DEPLOYMENT_CONFIG --env MEDOL_CASE_SELECTION \
    --env MEDOL_ENVIRONMENT_MANIFEST --env MEDOL_BASELINE_DATA_MANIFEST \
    --env MEDOL_DATA_MANIFEST --env MEDOL_EXECUTION_PLAN \
    "$SIMULATION_TOOL_IMAGE" "$@"
