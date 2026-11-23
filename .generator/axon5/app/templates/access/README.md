# Generated readmodel access scopes

Enabled only by the exported `dataAccess: {enabled: true}` capability from MEDOL `import data-access`. Policy metadata or a context named DataAccess does not enable it. Without the capability, no scope beans, scope permissions, background IAM adapter or delta gates are generated; regeneration removes generated scope files/registration. API authorization, tenant isolation and export file ownership remain independent.

The generator consumes scope rules plus per-readmodel accessBindings/accessRules. A default policy applies unless explicitly replaced. Missing target fields and unsupported/cross-deployment relation sources fail generation. Legacy field-only policies fail closed at runtime.

`AuthorizationScopeResolver` resolves ALL / VALUES / NONE for a trusted CurrentUser. Default grants are lowercase `data:<policy>:<rule>:scope` and `:all`, registered in the IAM seed without automatic actor grants. API permissions and tenant boundaries remain independent. `*:*` does not implicitly grant data scope.

`IdentityAccessAttributes` supplies IAM-owned fields. Built in: userId and organizationId. Custom attributes such as departmentIds require an application Bean; unknown attributes deny. Never accept client-supplied scope values.

Business scope providers are generated for modeled local relation projections. They query distinct values separately, match the current actor UUID, apply default eligibility and tenant boundaries, and do not recurse into readmodel ACLs. Only equality/inequality source eligibility is currently supported. Target queries use direct field IN predicates, not EXISTS.

All dimensions are ANDed. ALL relaxes only its own dimension. Empty scope denies; more than 1000 distinct values throws instead of truncating. There is no cross-request cache. Background callers must restore trusted identity. Handwritten SQL/reporting adapters remain responsible for applying scopes.

Runtime database smoke check (Maven dependencies must be cached):

```sh
node .generator/axon5/app/test/run-access-runtime-smoke.mjs
node .generator/axon5/app/test/run-access-runtime-smoke.mjs --disabled
```

Modeling examples and migration instructions: MEDOL `docs/access-policies.md`.

Protected asynchronous exports require a `BackgroundAccessActorResolver` on the executing deployment. Embedded IAM implements it; remote IAM requires an adapter. The job carries only the trusted owner ID in metadata, reloads current API/data grants when executing, and restores thread/security context even on failure. Missing adapters reject before enqueueing. Artifacts use tenant/owner directories and random names; downloads reject cross-owner paths and symlink escapes. Legacy unowned artifacts must be regenerated.

Outbox deltas bypass ordinary repository predicates and can contain deleted/historical rows. Generated sync endpoints therefore require explicit ALL authorization for every scope dimension before reading deltas. Restricted-scope delta semantics are not inferred. Permission identifiers that collide after lowercase normalization fail validation.
