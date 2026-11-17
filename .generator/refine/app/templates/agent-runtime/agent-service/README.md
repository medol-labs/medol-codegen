# Generated application assistant

This service belongs to the generated business application, not the MEDOL modeling assistant. The UI uses TanStack AI 1.x. Server credentials never enter the frontend bundle.

## Enable a modeled assistant

1. Declare assistants and permitted queries/commands through the `agent-assistance` built-in import in MEDOL. Generate the frontend.
2. In `src/ai/assistants.custom.json`, set `enabled` to `true`. For each profile, select IDs from `src/ai/capabilities.generated.json`. Only bindings declared for that assistant are allowed. A command with `unavailableReason` needs a specialized adapter before it can be enabled.
3. Regenerate to validate the configuration and bind the modeled resources/forms. Regeneration preserves the custom JSON. If you have an existing frontend, run `pnpm install` to refresh its lockfile after dependency changes; commit the resulting lockfile.
4. In this directory, run `npm ci`, copy `.env.example` to `.env`, and supply `OPENAI_API_KEY`, `AGENT_MODEL`, and the trusted `AGENT_AUTH_BASE_URL`. Run `npm start`.
5. Start the frontend with `pnpm dev`. Newly generated Vite configurations proxy `/api/agent` to `http://127.0.0.1:3100`. Existing custom Vite configurations should add this proxy or set `VITE_AGENT_API_URL` to the service's `/api/agent/chat` URL. For a separate origin, set `AGENT_ALLOWED_ORIGIN` to the exact frontend origin.

Restart the service and rebuild/reload the frontend after changing assistant configuration or regenerating the model. The service loads the same generated manifest and custom policy as the frontend. Disabled configurations expose no assistant. Chat and BI profiles expose only modeled queries; operator profiles can use enabled commands.

## Interactions

The assistant can inspect current authorized form context, read bounded query pages, navigate modeled routes, inspect/fill/validate/undo supported mounted forms, and prepare commands. Query results also have a table view. This does not create arbitrary SQL or business metric definitions.

Form input uses the generated domain schemas and the normal beforeSubmit/mapCommandPayload/afterSubmit pipeline. Reference selectors, uploads, downloads and custom action flows require specialized adapters. The assistant cannot write hidden fields or synthesize selector snapshots.

SDK approval permits the tool step. A separate confirmation displays the final prepared payload before submission. Account, tenant, permissions, configuration, form revision and proposal expiry are rechecked. Accepted does not mean completed. Unknown results block another automatic attempt until the user reviews the business record and explicitly allows one.

## Authentication and history

Every service request validates the caller's bearer token through the fixed backend `/api/me` endpoint. Only the configured backend receives that token. Business reads/writes continue through the application's existing authenticated providers and backend authorization, lifecycle and eligibility rules.

Conversation snapshots are private to account + tenant + assistant. They are stored under `AGENT_DATA_DIR` with revision checks and atomic replacement. Concurrent saves reject with 409 instead of overwriting a newer version. Pending approvals/executions cannot be restored as completed history. Reopened unknown results remain blocked pending human review. These snapshots are conversation history, not authoritative operation audit records; normal backend command/event auditing still applies.

The file repository supports one service process with persistent storage. For multiple replicas, replace the repository with shared durable storage implementing atomic revision checks. Apply your retention policy to this directory; do not put it or `.env` in Git. History is bounded to 100 messages and 256 KiB per snapshot; start a new conversation at that limit. Model context and request history have the same limits. Model cancellation does not roll back already submitted commands.

## Container

Build from the frontend root:

```sh
docker build -f agent-service/Dockerfile -t application-agent .
```

Supply the server environment at runtime, publish port 3100, and mount persistent storage at `/data` writable by the container's `node` user. Configure `AGENT_AUTH_BASE_URL` using an address reachable inside the container. Either proxy `/api/agent/*` to this service or set the frontend's runtime `VITE_AGENT_API_URL`. Use the same explicit origin in `AGENT_ALLOWED_ORIGIN` when origins differ. The service Docker ignore file excludes environment files, installed dependencies and local history.
