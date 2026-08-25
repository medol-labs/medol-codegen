#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
current_dir="$(pwd)"
target="${1:-all}"
workspace_id="${MEDOL_WORKSPACE_ID:-}"
image="${CODEGEN_IMAGE:-es-codegen}"
container_name="${CODEGEN_CONTAINER_NAME:-codegen}"
host_port="${CODEGEN_HOST_PORT-3001}"
generator_path="/opt/codegen/.generator/app/"
output_root="${CODEGEN_OUTPUT_ROOT:-generated}"
model_path="${CODEGEN_MODEL_PATH:-$script_dir/codegen-model.json}"
translations_path="${CODEGEN_TRANSLATIONS_PATH:-}"
model_locale="${CODEGEN_MODEL_LOCALE:-}"
medol_base_url="${MEDOL_BASE_URL:-http://host.docker.internal:5172}"
axon_workspace="$script_dir/$output_root/axon"
axon5_workspace="$script_dir/$output_root/axon5"
refine_workspace="$script_dir/$output_root/refine"
deploy_workspace="$script_dir/$output_root/deploy"
simulation_workspace="$script_dir/$output_root/simulation"

if [[ "$current_dir" != "$script_dir" ]]; then
  echo "Run this script from its own directory: $script_dir" >&2
  exit 1
fi

case "$target" in
  all|axon|axon5|refine|deploy|simulation|shell|update|model) ;;
  *)
    echo "Usage: ./test-codegen-model.sh [all|axon|axon5|refine|deploy|simulation|shell|update [workspace-id]]" >&2
    exit 1
    ;;
esac

require_image() {
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "Docker image $image was not found." >&2
    echo "Build it from the code-generator root with:" >&2
    echo "  docker build -f Dockerfile.codegen -t $image ." >&2
    exit 1
  fi
}

verify_image() {
  if ! docker run --rm "$image" /bin/sh -lc "command -v update >/dev/null && grep -q 'loadGeneratorModel' /opt/codegen/.generator/axon/app/index.js && grep -q 'allAggregates' /opt/codegen/.generator/axon/aggregates/index.js && grep -q 'loadCodegenModel' /opt/codegen/.generator/axon5/app/index.js && test -f /opt/codegen/.generator/deploy/app/index.js && test -f /opt/codegen/.generator/simulation/app/index.js"; then
    echo "Docker image $image does not include the latest codegen-model generator changes." >&2
    echo "Rebuild it from the code-generator root with:" >&2
    echo "  docker build -f Dockerfile.codegen -t $image ." >&2
    exit 1
  fi
}

if [[ "$target" == "model" || "$target" == "update" ]]; then
  require_image
  verify_image

  model_args=(--base-url "$medol_base_url" --output /workspace/codegen-model.json)
  if [[ $# -gt 1 ]]; then
    if [[ "${2:-}" == --* ]]; then
      model_args+=("${@:2}")
    else
      model_args+=(--workspace-id "$2")
      if [[ $# -gt 2 ]]; then
        model_args+=("${@:3}")
      fi
    fi
  elif [[ -n "$workspace_id" ]]; then
    model_args+=(--workspace-id "$workspace_id")
  fi
  if [[ -n "$model_locale" ]]; then
    model_args+=(--locale "$model_locale")
  fi

  docker run \
    --rm \
    -v "$script_dir:/workspace" \
    "$image" \
    update "${model_args[@]}"
  exit 0
fi

if [[ ! -f "$model_path" ]]; then
  echo "Codegen model was not found: $model_path" >&2
  echo "Export it from Event Modeling Toolkit first." >&2
  echo "Or set CODEGEN_MODEL_PATH=/path/to/codegen-model.json." >&2
  echo "Or run ./test-codegen-model.sh update [workspace-id] while Medol is running." >&2
  exit 1
fi

require_image
verify_image

prepare_workspace() {
  local workspace="$1"
  mkdir -p "$workspace"
  cp "$model_path" "$workspace/codegen-model.json"
  if [[ -n "$translations_path" ]]; then
    if [[ ! -f "$translations_path" ]]; then
      echo "Translations file was not found: $translations_path" >&2
      exit 1
    fi
    cp "$translations_path" "$workspace/translations.json"
  fi
}

run_gen() {
  local workspace="$1"
  shift
  local port_args=()
  if [[ -n "$host_port" ]]; then
    port_args=(-p "$host_port:3000")
  fi
  prepare_workspace "$workspace"
  docker run \
    --rm \
    "${port_args[@]}" \
    -v "$workspace:/workspace" \
    --name "$container_name" \
    "$image" \
    /bin/sh -lc "yes a | gen '$generator_path' \"\$@\"" sh "$@"
}

run_axon() {
  run_gen "$axon_workspace" --generator axon --generator-type Skeleton
  run_gen "$axon_workspace" --generator axon --generator-type slices --all-slices
  run_gen "$axon_workspace" --generator axon --generator-type aggregates --all-aggregates
}

run_axon5() {
  rm -rf "$axon5_workspace"
  run_gen "$axon5_workspace" --generator axon5 --generator-type Skeleton
  run_gen "$axon5_workspace" --generator axon5 --generator-type slices --all-slices
}

run_refine() {
  run_gen "$refine_workspace" --generator refine --generator-type Skeleton --skip-install
  run_gen "$refine_workspace" --generator refine --generator-type all --all-commands --skip-install
}

run_deploy() {
  rm -rf "$deploy_workspace"
  run_gen "$deploy_workspace" --generator deploy --generator-type all --environment dev --skip-install
}

run_simulation() {
  rm -rf "$simulation_workspace"
  run_gen "$simulation_workspace" --generator simulation --generator-type all --skip-install
}

case "$target" in
  all)
    run_axon
    run_axon5
    run_refine
    run_deploy
    run_simulation
    ;;
  axon)
    run_axon
    ;;
  axon5)
    run_axon5
    ;;
  refine)
    run_refine
    ;;
  deploy)
    run_deploy
    ;;
  simulation)
    run_simulation
    ;;
  shell)
    prepare_workspace "$script_dir/$output_root/shell"
    shell_port_args=()
    if [[ -n "$host_port" ]]; then
      shell_port_args=(-p "$host_port:3000")
    fi
    docker run -it "${shell_port_args[@]}" -v "$script_dir/$output_root/shell:/workspace" --name "$container_name" --rm "$image"
    ;;
esac
