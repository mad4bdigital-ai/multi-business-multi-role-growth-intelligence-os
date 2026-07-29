# Context Kernel API and Projection Contracts

Phase 5 defines the public interface boundary for the unified Admin and Tenant context kernel. The package is intentionally **not mounted** in `routes/index.js`; runtime composition, authentication middleware, persistence adapters, and shadow traffic remain Phase 6 work.

## Public operations

The route factory exposes the six operations documented by the v0.1.0 contract:

- `POST /context-resolutions`
- `GET /context-resolutions/{resolutionId}`
- `POST /context-pins`
- `DELETE /context-pins/{pinId}`
- `POST /execution-contexts`
- `POST /execution-contexts/{contextId}/validate`

Unknown-outcome reconciliation remains an internal governed application/runtime capability and is not exposed by this contract.

## Boundary behavior

- Request bodies and pagination queries are strict; unsupported fields are rejected.
- Candidate pagination is deterministic, cursor-based, and capped at 100 items.
- View mode is resolved from trusted authorization context. Clients cannot request Admin projections through query or body fields.
- Tenant projections expose only authorized display-safe context fields.
- Admin projections add safe authority/readiness diagnostics but still exclude credentials, tokens, secrets, raw execution payloads, and arbitrary metadata.
- Errors use a stable JSON envelope containing a machine-readable code, human-readable message, optional details, and request ID.
- Controllers pass normalized inputs and principal context to injected operations; raw request objects never enter the Application layer.

## Runtime boundary

`createContextKernelRouter` accepts an injected Router factory and controller. Phase 5 does not import the runtime route registry, instantiate production repositories, call providers, write external state, run migrations, or deploy anything.
