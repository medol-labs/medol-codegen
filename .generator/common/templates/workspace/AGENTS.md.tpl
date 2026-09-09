# AGENTS.md

- Treat `.medol/codegen-model.json`, `.medol/source.medol`, and `.medol/medol.yml` as system-level generation inputs.
- Do not hand-edit generated backend `context/` code unless explicitly requested for an emergency local fix.
- Put hand-written backend adapters under `infrastructure/` and hand-written decision overrides under `domain/`.
- If a framework-level generated behavior is wrong, update `es-code-generator` templates instead of patching generated outputs.
- Do not put concrete business-system behavior into the generator; express business behavior in the Medol model or generated project extension points.
