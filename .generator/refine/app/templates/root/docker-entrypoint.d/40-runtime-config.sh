#!/bin/sh
set -eu

js_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

cat >/usr/share/nginx/html/runtime-config.js <<EOF
window.__APP_CONFIG__ = {
  VITE_API_URL: "$(js_escape "${VITE_API_URL:-}")",
  VITE_SUPABASE_API_KEY: "$(js_escape "${VITE_SUPABASE_API_KEY:-}")",
  VITE_AUTH_PROVIDER: "$(js_escape "${VITE_AUTH_PROVIDER:-}")",
  VITE_ACCESS_CONTROL_MODE: "$(js_escape "${VITE_ACCESS_CONTROL_MODE:-}")",
  VITE_AUTH_API_URL: "$(js_escape "${VITE_AUTH_API_URL:-}")",
  VITE_AXON_API_URL: "$(js_escape "${VITE_AXON_API_URL:-}")"<% backendModules.forEach((module) => { -%>,
  <%= module.envName %>: "$(js_escape "${<%= module.envName %>:-}")"<% }) -%>
};
EOF
