# Requirements Checklist

## Specification completeness

- [x] Problem and verified repository baseline are separated from proposed behavior.
- [x] Current OpenAI plugin, MCP, authentication, packaging, security, and review requirements are recorded.
- [x] Scope, non-goals, actors, authority, user journeys, operation paths, functional requirements, non-functional requirements, errors, rollout, rollback, and success criteria are defined.
- [x] Specification status does not claim implementation, deployment, submission, or publication.
- [x] Required Spec Kit files are listed in `manifest.json` and `completion.json`.
- [ ] Canonical Work Map scaffold has been run for Spec 016.
- [ ] Architecture, identity, security, privacy, product, and operations reviews are complete.

## Product and tool design

- [x] Initial delivery is read-only and works without custom UI.
- [x] Generic internal dispatch is excluded from the default public user experience.
- [x] Public tools must map to recognizable user goals.
- [x] Tool names, titles, descriptions, schemas, structured results, stable IDs, and annotations are required.
- [x] Unsupported requests and write attempts during phase 1 have explicit no-call or denial behavior.
- [ ] Final phase-1 user-goal inventory is approved.
- [ ] Final tool names and schemas are approved.
- [ ] Tool-selection evaluation prompts and expected calls are approved.

## Transport and endpoint

- [x] One stable MCP Streamable HTTP endpoint is required.
- [x] Legacy split routes have a separate compatibility and deprecation path.
- [x] Request size, timeout, content type, protocol version, and structured error requirements are present.
- [x] Endpoint health and metadata fingerprint readback are required.
- [ ] `mcp.mad4b.com` DNS, TLS, routing, deployment, and ownership are verified.
- [ ] Existing split-route consumers are inventoried.

## Authentication and authorization

- [x] OAuth 2.1-compatible resource-server behavior is required for private data and writes.
- [x] Protected-resource metadata, authorization-server discovery, resource propagation, PKCE `S256`, and bearer challenge behavior are defined.
- [x] Token issuer, signature, resource/audience, subject, expiry, scope, and revocation validation are required.
- [x] Tenant, workspace, Brand, resource, and connection authority come from the authenticated platform context.
- [x] Model-provided identifiers are selectors, not authority.
- [ ] Existing authorization server conformance is verified.
- [ ] Client identification/registration mode is selected for each environment.
- [ ] OAuth scope taxonomy and consent copy are approved.

## Results and data

- [x] Stable IDs and bounded structured results are required.
- [x] Pagination, field allowlists, maximum rows, maximum bytes, and maximum depth are required.
- [x] Access tokens, refresh tokens, credentials, backend keys, provider secrets, and raw grants are forbidden in all result channels.
- [x] Broad conversation history is not a default tool input.
- [x] Logical data entities and reuse-first migration posture are documented.
- [ ] Field-level existing-schema reuse matrix is complete.
- [ ] Any proposed new schema object is classified and approved.

## Writes and operations

- [x] Write tools remain blocked until read-only acceptance.
- [x] Capability, policy, confirmation, idempotency, durable operation, readback, and rollback are required.
- [x] Unknown outcomes require reconciliation before retry.
- [x] ChatGPT confirmation does not replace server-side authorization.
- [x] Write annotations must reflect actual external and destructive behavior.
- [ ] Future write-tool list and operation-specific requirements are approved.

## Packaging and distribution

- [x] `.codex-plugin/plugin.json` is the package entry point.
- [x] `.app.json` is treated as an environment-specific registered connection mapping.
- [x] Live `plugin_asdk_app...` IDs and credentials are forbidden from reusable source templates.
- [x] Skills and UI are optional.
- [x] Public submission is separate from approval and publication.
- [ ] Package display metadata, legal URLs, assets, localization, and starter prompts are approved.
- [ ] Publisher verification and submission permissions are proven.

## Verification and closeout

- [x] MCP Inspector, ChatGPT developer mode, OAuth, isolation, annotation parity, boundedness, prompt selection, and no-secret tests are defined.
- [x] Source, runtime, Inspector, ChatGPT, package, submission, approval, and publication fingerprints must match.
- [x] Revocation and disable drills are required.
- [x] Production, rollback, and post-merge evidence are required.
- [ ] CI validates every contract and manifest.
- [ ] Developer-mode acceptance is complete.
- [ ] Production acceptance is complete.
- [ ] Public review and publication evidence are complete or formally not applicable.
