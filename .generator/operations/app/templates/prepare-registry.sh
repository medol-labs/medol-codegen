#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENVIRONMENT="${1:?Usage: prepare-registry.sh <environment>}"
if [[ ! "$ENVIRONMENT" =~ ^[a-z][a-z0-9-]*$ ]]; then
    echo "Invalid environment: $ENVIRONMENT" >&2
    exit 1
fi

BASE_PREFIX=__BASE_PREFIX__
IMAGE_TAG=__IMAGE_TAG__
APPLICATIONS=(__APPLICATIONS__)
SITE_NAMES=(__SITE_NAMES__)

site_applications() {
    case "$1" in
__SITE_APPLICATION_CASES__
    esac
}

CONFIG="$ROOT/operations/config/$ENVIRONMENT.private.yml"
[[ -f "$CONFIG" ]] || { echo "Missing $CONFIG" >&2; exit 1; }

# Only the flat registry mapping is needed at deployment time. Reject YAML
# constructs that would need a full parser instead of guessing their meaning.
registry_fields="$(awk '
    /^[[:space:]]*(#|$)/ { next }
    {
        line = $0
        sub(/[[:space:]]+#.*$/, "", line)
        indent = match(line, /[^ ]/) - 1
        if (indent == 0) {
            inside = (line ~ /^registry:[[:space:]]*$/)
            next
        }
        if (!inside) next
        if (indent != 2 || line !~ /^  [A-Za-z][A-Za-z]*:[[:space:]]*/) {
            print "Unsupported registry YAML line: " $0 > "/dev/stderr"
            exit 1
        }
        entry = substr(line, 3)
        colon = index(entry, ":")
        key = substr(entry, 1, colon - 1)
        value = substr(entry, colon + 1)
        sub(/^[[:space:]]*/, "", value)
        sub(/[[:space:]]*$/, "", value)
        quote = substr(value, 1, 1)
        if (quote == "\"" || quote == sprintf("%c", 39)) {
            if (substr(value, length(value), 1) != quote) {
                print "Unclosed registry YAML quote: " key > "/dev/stderr"
                exit 1
            }
            value = substr(value, 2, length(value) - 2)
        }
        print key "=" value
    }
' "$CONFIG")"

host=''
namespace=''
scheme='http'
insecure='false'
prefix=''
while IFS='=' read -r key value; do
    case "$key" in
        host) host="$value" ;;
        namespace) namespace="$value" ;;
        scheme) scheme="$value" ;;
        insecure) insecure="$value" ;;
        imagePrefix) prefix="$value" ;;
    esac
done <<< "$registry_fields"

[[ "$host" =~ ^[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || { echo 'Invalid registry.host' >&2; exit 1; }
[[ -z "$namespace" || "$namespace" =~ ^[a-zA-Z0-9._/-]+$ ]] || { echo 'Invalid registry.namespace' >&2; exit 1; }
[[ "$scheme" == http || "$scheme" == https ]] || { echo 'registry.scheme must be http or https' >&2; exit 1; }
[[ "$insecure" == true || "$insecure" == false ]] || { echo 'registry.insecure must be true or false' >&2; exit 1; }
[[ -n "$prefix" ]] || prefix="$host${namespace:+/$namespace}"
[[ "$prefix" =~ ^[a-zA-Z0-9._:/-]+$ ]] || { echo 'Invalid registry.imagePrefix' >&2; exit 1; }
[[ "$BASE_PREFIX" =~ ^[a-zA-Z0-9._/-]+$ && "$IMAGE_TAG" =~ ^[a-zA-Z0-9._-]+$ ]] || { echo 'Invalid generated image settings' >&2; exit 1; }
(( ${#APPLICATIONS[@]} > 0 )) || { echo 'No generated applications' >&2; exit 1; }

for target in k3s kubernetes; do
    [[ -d "$ROOT/operations/$target/environments/$ENVIRONMENT" ]] || continue
    overlay="$ROOT/operations/$target/environments/$ENVIRONMENT-registry"
    mkdir -p "$overlay"
    {
        printf 'resources:\n  - ../%s\nimages:\n' "$ENVIRONMENT"
        for application in "${APPLICATIONS[@]}"; do
            [[ "$application" =~ ^[a-zA-Z0-9._-]+$ ]] || { echo "Invalid application artifact: $application" >&2; exit 1; }
            printf '  - name: "%s/%s"\n    newName: "%s/%s"\n    newTag: "%s"\n' \
                "$BASE_PREFIX" "$application" "$prefix" "$application" "$IMAGE_TAG"
        done
        printf 'patches:\n  - target:\n      kind: Deployment\n    path: image-pull-policy.yaml\n'
    } > "$overlay/kustomization.yaml"
    printf '%s\n' '- op: add' '  path: /spec/template/spec/containers/0/imagePullPolicy' '  value: Always' > "$overlay/image-pull-policy.yaml"

    for site in "${SITE_NAMES[@]}"; do
        site_source="$ROOT/operations/$target/environments/$ENVIRONMENT/sites/$site"
        [[ -d "$site_source" ]] || { echo "Missing generated deployment site: $site_source" >&2; exit 1; }
        site_overlay="$overlay/sites/$site"
        mkdir -p "$site_overlay"
        {
            printf 'resources:\n  - ../../../%s/sites/%s\nimages:\n' "$ENVIRONMENT" "$site"
            while IFS= read -r application; do
                [[ -n "$application" ]] || continue
                printf '  - name: "%s/%s"\n    newName: "%s/%s"\n    newTag: "%s"\n' \
                    "$BASE_PREFIX" "$application" "$prefix" "$application" "$IMAGE_TAG"
            done < <(site_applications "$site")
            printf 'patches:\n  - target:\n      kind: Deployment\n    path: image-pull-policy.yaml\n'
        } > "$site_overlay/kustomization.yaml"
        cp "$overlay/image-pull-policy.yaml" "$site_overlay/image-pull-policy.yaml"
    done
done

mkdir -p "$ROOT/operations/k3s/cluster"
{
    printf 'mirrors:\n  "%s":\n    endpoint:\n      - "%s://%s"\n' "$host" "$scheme" "$host"
    printf '  "docker.io":\n    endpoint:\n      - "%s://%s"\n' "$scheme" "$host"
    if [[ "$insecure" == true && "$scheme" == https ]]; then
        printf 'configs:\n  "%s":\n    tls:\n      insecure_skip_verify: true\n' "$host"
    fi
} > "$ROOT/operations/k3s/cluster/registries.yaml"

printf '{"registry":{"host":"%s","namespace":"%s","scheme":"%s","insecure":%s,"imagePrefix":"%s"}}\n' \
    "$host" "$namespace" "$scheme" "$insecure" "$prefix" > "$ROOT/operations/model/$ENVIRONMENT/operations-model.private.json"

echo "Prepared $ENVIRONMENT registry overlays and cluster/registries.yaml for $prefix"
echo 'Copy registries.yaml to each K3s node and restart its K3s service before applying the registry overlay.'
