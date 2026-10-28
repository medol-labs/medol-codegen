# {{title}}

{{summary}}

The generated project is intended to be open and reviewable: keep the model,
generated artifacts, and hand-written business extensions in clear boundaries so
the system can be regenerated without losing domain-specific code.

## Layout

- `.medol/source.medol` is the MEDOL source snapshot that captures the business
  domain model.
- `.medol/codegen-model.json` is the generated CodegenModel consumed by
  `medol-codegen`.
- `.medol/medol.yml` configures generator output directories and other workspace settings.
- `operations/config/common.yml` holds shared deployment settings;
  `operations/config/<environment>.yml` overrides them for one environment.
- `operations/config/<environment>.private.yml` holds ignored machine-specific settings.
- `{{backendOutput}}/` contains generated command, event, query, aggregate,
  projection, and API code derived from the business model.
- `{{frontendOutput}}/` contains generated application shells and resource-oriented
  screens derived from the same model.
- `{{operationsOutput}}/` contains generated deployment and operations assets.
- Hand-written business integrations should live in stable extension points such
  as `domain/...`, `infrastructure/...`, runtime modules, or other directories
  explicitly owned by the project.

## Business Domain

The business domain should be read from `.medol/source.medol` first. This
workspace is generated from these modeled domains:

{{modelDomainList}}

When changing behavior, update the MEDOL model before regenerating framework
artifacts. Use hand-written extension points for implementation details that are
not part of the model itself.

## Generated Applications

Backend deployments:

{{deploymentList}}

Frontend applications:

{{frontendList}}

## Generation

Run generators from this repository root. A typical flow is:

```bash
# 1. Export or refresh .medol/codegen-model.json from the MEDOL source model.
# 2. Run the required medol-codegen targets from this workspace root.
{{generatorCommandList}}
```

Generated code may be overwritten during regeneration. Keep custom behavior in
the extension locations documented by each generated module.

## Local Development

Use the generated module README files and scripts for concrete commands. Common
workflows include:

```bash
# Backend
./mvnw test

# Frontend
npm install
npm run dev
```

Not every generated workspace contains every stack. Follow the directories
present in this repository.

## Local Registry

Keep machine-specific registry settings in the ignored
`operations/config/dev.private.yml`:

```yaml
registry:
  host: registry.example.com
  namespace: team
  insecure: true
```

After the environment has been generated once, refresh its local registry
overlays and node configuration without rerunning the generator:

```bash
bash operations/scripts/prepare-registry.sh dev
```

The shell script uses Bash and awk and accepts simple scalar registry values.

Generated registry overlays and `{{registryPath}}` are machine-local artifacts
and should not be committed.
