# {{title}}

This repository is a Medol generated system workspace.

## Layout

- `.medol/codegen-model.json` is exported from Medol and consumed by generators.
- `.medol/source.medol` is the downloaded MEDOL source snapshot for review and traceability.
- `.medol/medol.yml` configures generator output directories and operations settings.
- `.medol/medol.local.yml` may override local machine settings such as `operations.registry`; it is intentionally ignored by git.
- `operations/` contains generated deployment and operations assets.

## Generation

Run generators from this repository root.

## Local Registry

Keep machine-specific registry settings in `.medol/medol.local.yml` and regenerate operations files when needed:

```yaml
operations:
  registry:
    host: 192.168.50.2:5000
    namespace: fl
    insecure: true
```

Generated registry overlays and `k3s/cluster/registries.yaml` are local artifacts and should not be committed.
