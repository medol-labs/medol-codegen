# AI-native generated applications

Branch: `feat/ai-native-applications`. This feature belongs to generated business applications. MEDOL's own modeling assistant and its dependencies are unchanged.

## Modeling and generation

Import `agent-assistance` and declare assistant profiles (`chat`, `operator`, `bi`) plus explicit `agentQuery`/`agentCommand` bindings. These declarations are the tool authorization ceiling. Generator/runtime configuration can only narrow it; backend business authorization remains authoritative.

Generation creates a stable `Context.Element` capability manifest, preserves and revalidates `src/ai/assistants.custom.json`, and binds selected frontend resources and forms using actual generator metadata. Technical, generated, derived, numbered and port-output fields are not Agent inputs. Moving slices does not rename capabilities. Invalid, duplicate, revoked or unbound enabled tools fail generation. Ordinary same-named contexts do not opt in.

The application includes an optional lazy-loaded assistant panel. Default configuration is disabled with empty tool selections. Plain JSON Schema describes SDK tools, while actual form validation reuses the existing Zod 3 domain schemas. This avoids the TanStack AI 1.x requirement for a schema-to-JSON-Schema converter without upgrading existing form dependencies. SDK dependencies are pinned: core 1.4.0, React 1.0.2, client 1.1.0; the independent service uses OpenAI adapter 1.1.1. Both dependency lockfiles are supplied.

## Working paths

- Authenticated TanStack SSE service with server-only provider credentials, fixed authentication backend, explicit profile selection, bounded request/history size and active-request limit. Client-supplied provider settings, system instructions, URLs and tool declarations do not become service configuration.
- Shared client/server tool definitions: authorized mounted-form context; bounded read-model queries; modeled navigation; real React Hook Form inspect/fill/validate/undo; prepare/confirm command execution. Query results can be displayed as tables for chatbot/BI profiles.
- Normal forms and Agent operations use the same `prepareCommand` pipeline. Commands await pessimistic submission; a post-submit failure does not become a business rejection. Final confirmation binds transformed values to identity, tenant, policy, instance, revision and expiry. Permissions and policy are checked again before execution.
- SDK tool approval and final-payload confirmation are distinct. Only the trusted UI can confirm. Repeated clicks consume a proposal once. Unmount before approval cancels it; unmount after submission does not misreport a committed operation as cancelled.
- Accepted/completed/rejected/unknown are distinct results. Network uncertainty never triggers an automatic retry. Unknown outcomes block preparation until explicit user acknowledgement, including after conversation restoration. A bounded completion check is supported when an authoritative adapter is supplied.
- Private persisted conversation snapshots, conversation selection and fresh threads. Ownership includes user, tenant and assistant. Writes use atomic replacement with optimistic revisions; concurrent stale snapshots receive 409. Pending tool calls are not restorable executable history.

Setup, configuration and container instructions are generated in `agent-service/README.md`. New Vite skeletons include a development proxy. Existing projects retain their custom Vite configuration and can configure the endpoint directly. Incremental generation updates runtime modules, resource bindings, form hooks and runtime environment support while preserving custom assistant configuration.

## Explicit limits

File upload/download, direct/custom command interactions and reference-selector mutation require specialized adapters; they are not silently replaced by raw POSTs. A form may still accept manually selected references before Agent preparation. Selected commands must be reachable through a generated supported form. Backend authorization, `require` and `eligible` rules remain in force.

BI currently uses explicitly modeled read models and their existing authorized query APIs. It does not invent SQL, metric definitions, joins or reporting semantics. Business completion verification is not guessed from an HTTP response. Model configuration lifecycle administration, distributed history storage, long-conversation compaction and authoritative Agent execution audit are separate follow-up work. Existing backend operation audit observes the normal command/event path.

The default history repository is a single-process file adapter, not an event-sourced aggregate or a multi-replica database. Persistent storage and a retention policy are deployment responsibilities. The execution guard does not provide durable command idempotency across processes/reloads; use business command identifiers and backend rules for that.

## Validation

Focused tests cover policy revocation, real CodegenModel field semantics, cloned resource/form bindings, stale revisions, unknown retry guards, duplicate confirmation, identity changes, business rejection, expiry, unmount during submission, bounded completion checks, private history and concurrent snapshot writes.

A scratch application is exported from MEDOL and generated through the actual Skeleton/all pipeline. Its TypeScript and Vite build are checked. `AGENT_SMOKE_APP_DIR=<scratch-web> node .generator/refine/app/test/run-agent-runtime-smoke.mjs` runs the actual TanStack client and server with its official fake text adapter, the generated browser tools, a real React Hook Form control, and a local HTTP business fixture. It exercises navigation → inspect → fill → SDK approval → final confirmation → one HTTP submission → query readback. Authentication, rejected commands and tenant-private persisted history are also checked. The LLM and business HTTP backend are fixtures; this is not an Axon deployment test or a live paid-model test.
