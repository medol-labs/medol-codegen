#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
current_dir="$(pwd)"

if [[ "$current_dir" != "$script_dir" ]]; then
  echo "Run this script from its own directory: $script_dir" >&2
  exit 1
fi

if [[ ! -f config.json ]]; then
  echo "config.json was not found in $current_dir" >&2
  exit 1
fi

find . -mindepth 1 -maxdepth 1 \
  ! -name 'config.json' \
  ! -name 'codegen-model.json' \
  ! -name 'clean-generated.sh' \
  ! -name 'test-codegen-model.sh' \
  -exec rm -rf -- {} +
