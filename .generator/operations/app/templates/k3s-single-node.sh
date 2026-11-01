#!/usr/bin/env bash
set -euo pipefail
K3S_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENVIRONMENT="${1:?Usage: k3s-single-node.sh <environment> render|import|check|apply [image.tar ...]}"
COMMAND="${2:-check}"
[[ "$ENVIRONMENT" =~ ^[a-z][a-z0-9-]*$ ]] || { echo 'Invalid environment' >&2; exit 1; }
OVERLAY="${K3S_DIR}/environments/${ENVIRONMENT}/single-node"
[[ -f "$OVERLAY/kustomization.yaml" ]] || { echo "Generate environment $ENVIRONMENT first" >&2; exit 1; }
K3S_BIN="${K3S_BIN:-k3s}"
TEMPORARY=''
trap '[[ -z "$TEMPORARY" ]] || rm -rf "$TEMPORARY"' EXIT
if [[ -n "${EXTRA_COMPONENT:-}" ]]; then
    mkdir -p "$K3S_DIR/.work"
    TEMPORARY="$(mktemp -d "$K3S_DIR/.work/single-node.XXXXXX")"
    cp -R "$EXTRA_COMPONENT" "$TEMPORARY/component"
    printf 'namespace: __NAMESPACE__\nresources:\n  - "../../environments/%s/single-node"\ncomponents:\n  - component\n' "$ENVIRONMENT" > "$TEMPORARY/kustomization.yaml"
    OVERLAY="$TEMPORARY"
fi
if [[ "$COMMAND" == render ]]; then
    kubectl kustomize "$OVERLAY"
    exit
fi
[[ "$(uname -s)" == Linux ]] || { echo 'Run inside the Linux K3s node, not on the macOS host.' >&2; exit 1; }
command -v "$K3S_BIN" >/dev/null
if [[ "$COMMAND" == import ]]; then
    shift 2
    (( $# > 0 )) || { echo 'Supply application, dependency and engine tar archives.' >&2; exit 1; }
    for archive in "$@"; do [[ -f "$archive" ]] || { echo "Missing archive: $archive" >&2; exit 1; }; done
    case "$(uname -m)" in
        aarch64|arm64) image_platform=linux/arm64 ;;
        x86_64|amd64) image_platform=linux/amd64 ;;
        *) echo 'Unsupported node architecture' >&2; exit 1 ;;
    esac
    for archive in "$@"; do "$K3S_BIN" ctr -n k8s.io images import --platform "$image_platform" "$archive"; done
    exit
fi
[[ "$COMMAND" == check || "$COMMAND" == apply ]] || { echo "Unknown command: $COMMAND" >&2; exit 1; }
nodes="$("$K3S_BIN" kubectl get nodes -o name)"
[[ "$(printf '%s\n' "$nodes" | wc -l | tr -d ' ')" == 1 ]] || { echo 'This profile requires exactly one node.' >&2; exit 1; }
"$K3S_BIN" kubectl wait --for=condition=Ready "$nodes" --timeout=120s
taints="$("$K3S_BIN" kubectl get "$nodes" -o 'jsonpath={range .spec.taints[*]}{.effect}{"\n"}{end}')"
if [[ "$taints" == *NoSchedule* || "$taints" == *NoExecute* ]]; then
    echo 'The shared single node must accept ordinary application Pods; review its taints.' >&2
    exit 1
fi
"$K3S_BIN" kubectl get storageclass
[[ "$("$K3S_BIN" kubectl get storageclass -o 'jsonpath={range .items[*]}{.metadata.annotations.storageclass\.kubernetes\.io/is-default-class}{"\n"}{end}')" == *true* ]] || { echo 'Configure a default StorageClass before deployment.' >&2; exit 1; }
"$K3S_BIN" kubectl get nodes -o wide
if [[ "$COMMAND" == apply ]]; then
    [[ -f "${SECRETS_FILE:-}" ]] || { echo 'Set SECRETS_FILE to the reviewed environment Secret manifest.' >&2; exit 1; }
    if grep -Eq 'change-me|local-dev-internal-token' "$SECRETS_FILE"; then
        echo 'Replace example credentials in SECRETS_FILE before deployment.' >&2
        exit 1
    fi
    "$K3S_BIN" kubectl create namespace '__NAMESPACE__' --dry-run=client -o yaml | "$K3S_BIN" kubectl apply -f -
    "$K3S_BIN" kubectl -n '__NAMESPACE__' apply -f "$SECRETS_FILE"
    "$K3S_BIN" kubectl apply -k "$OVERLAY"
    deployments="$("$K3S_BIN" kubectl -n '__NAMESPACE__' get deployments -o name)"
    while IFS= read -r deployment; do
        [[ -z "$deployment" ]] || "$K3S_BIN" kubectl -n '__NAMESPACE__' rollout status "$deployment" --timeout="${ROLLOUT_TIMEOUT:-600s}"
    done <<< "$deployments"
    "$K3S_BIN" kubectl -n '__NAMESPACE__' get pods,svc,pvc -o wide
fi
