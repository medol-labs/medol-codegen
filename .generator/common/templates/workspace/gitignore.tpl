# Environment and secrets
.env
.env.*
**/.env
**/.env.*
!.env-example
!**/.env-example

# OS and editor files
.DS_Store
**/.DS_Store
.idea/
**/.idea/
.vscode/
**/.vscode/
*.iml
*.sw?
*.suo
*.ntvs*
*.njsproj
*.sln

# Logs
logs/
**/logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Node / frontend
node_modules/
**/node_modules/
dist/
**/dist/
dist-ssr/
**/dist-ssr/
*.local

# Java / Maven / Gradle
target/
**/target/
build/
**/build/
.gradle/
**/.gradle/

# Python
__pycache__/
**/__pycache__/
*.py[cod]
*$py.class
.pytest_cache/
**/.pytest_cache/
.mypy_cache/
**/.mypy_cache/
.ruff_cache/
**/.ruff_cache/
.Python
.venv/
**/.venv/
venv/
**/venv/
*.egg-info/
**/*.egg-info/
.installed.cfg

# Runtime data and generated local artifacts
tmp/
**/tmp/
volumes/
**/volumes/
.medol/*.local.yml
.medol/*.local.yaml
operations/**/.work/
deployment-compose-files/
**/deployment-compose-files/

# Local Kubernetes/K3s environment overlays
operations/**/secrets.*.yaml
!operations/**/secrets.example.yaml
operations/**/k3s/cluster/registries.yaml
operations/**/k3s/environments/*-registry/**
operations/**/k3s/overlays/*-registry/**
operations/**/kubernetes/environments/*-registry/**
operations/**/kubernetes/overlays/*-registry/**

# Image and deployment bundles
*.tar
*.tar.gz
*.tgz

# Local databases
*.sqlite
*.sqlite3
*.db
