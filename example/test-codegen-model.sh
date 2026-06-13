#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
current_dir="$(pwd)"
target="${1:-all}"
image="${CODEGEN_IMAGE:-es-codegen}"
container_name="${CODEGEN_CONTAINER_NAME:-codegen}"
generator_path="/opt/codegen/.generator/app/"
output_root="${CODEGEN_OUTPUT_ROOT:-generated}"
model_path="${CODEGEN_MODEL_PATH:-$script_dir/codegen-model.json}"
axon_workspace="$script_dir/$output_root/axon"
refine_workspace="$script_dir/$output_root/refine"

if [[ "$current_dir" != "$script_dir" ]]; then
  echo "Run this script from its own directory: $script_dir" >&2
  exit 1
fi

if [[ ! -f "$model_path" ]]; then
  echo "Codegen model was not found: $model_path" >&2
  echo "Export it from Event Modeling Toolkit first." >&2
  echo "Or set CODEGEN_MODEL_PATH=/path/to/codegen-model.json." >&2
  exit 1
fi

if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "Docker image $image was not found." >&2
  echo "Build it from the code-generator root with:" >&2
  echo "  docker build -f Dockerfile.codegen -t $image ." >&2
  exit 1
fi

if ! docker run --rm "$image" /bin/sh -lc "grep -q 'loadGeneratorModel' /opt/codegen/.generator/axon/app/index.js && grep -q 'allAggregates' /opt/codegen/.generator/axon/aggregates/index.js"; then
  echo "Docker image $image does not include the latest codegen-model generator changes." >&2
  echo "Rebuild it from the code-generator root with:" >&2
  echo "  docker build -f Dockerfile.codegen -t $image ." >&2
  exit 1
fi

case "$target" in
  all|axon|refine|shell) ;;
  *)
    echo "Usage: ./test-codegen-model.sh [all|axon|refine|shell]" >&2
    exit 1
    ;;
esac

prepare_workspace() {
  local workspace="$1"
  mkdir -p "$workspace"
  cp "$model_path" "$workspace/codegen-model.json"
}

run_gen() {
  local workspace="$1"
  shift
  prepare_workspace "$workspace"
  docker run \
    --rm \
    -p 3001:3000 \
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

run_refine() {
  run_gen "$refine_workspace" --generator refine --generator-type Skeleton --skip-install
  run_gen "$refine_workspace" --generator refine --generator-type all --all-commands --skip-install
}

case "$target" in
  all)
    run_axon
    run_refine
    ;;
  axon)
    run_axon
    ;;
  refine)
    run_refine
    ;;
  shell)
    prepare_workspace "$script_dir/$output_root/shell"
    docker run -it -p 3001:3000 -v "$script_dir/$output_root/shell:/workspace" --name "$container_name" --rm "$image"
    ;;
esac
