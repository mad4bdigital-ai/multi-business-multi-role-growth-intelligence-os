# ADR: Repository Authority and Capability Bindings V2

- Status: Accepted
- Date: 2026-07-23
- Scope: Repository identity, repository capabilities, governed provider writes, and repository webhook provisioning

## Context

Repository operations previously accepted provider coordinates such as `owner` and `repo` close to the execution boundary. Those coordinates are mutable, do not carry tenant or workspace authority, and cannot safely express provider installation, connected-system, brand, environment, capability-policy, credential-reference, or readback requirements.

The platform needs one authority model that can support multiple tenants, workspaces, brands, applications, providers, repositories, and environments without duplicating provider-specific identity logic. It must also tolerate repository rename or transfer, preserve backward-compatible selectors, prevent time-of-check/time-of-use drift, and keep credential references and secret values out of public context surfaces.

## Decision

Repository identity is resolved from SQL-primary `repository_authority_bindings` using immutable provider identity where available. Aliases are stored separately in `repository_authority_aliases`. Provider coordinates supplied by callers are selectors only; they are never execution authority.

Repository operations are authorized through `repository_capability_bindings`. Effective configuration is inherited deterministically across these policy scopes:

1. platform
2. tenant
3. workspace
4. brand
5. app
6. repository
7. environment

The resolver produces two review-bound fingerprints:

- `binding_sha256` for repository authority
- `capability_sha256` for the effective capability and inherited configuration

A provider write must match both fingerprints and an exact commit SHA inside a single-use Capability Envelope bound to tenant, user, workspace, brand, resource URI, capability, and operation intent. The envelope must be atomically claimed before any secret resolution or provider call.

The repository-main-moved GitHub webhook capability uses this sequence:

1. Resolve repository authority and capability from SQL.
2. Validate provider, app, effect class, callback, events, SSL, content type, and credential-reference shape.
3. For apply, validate the reviewed fingerprints and context-bound Capability Envelope.
4. Atomically claim the envelope.
5. Resolve the credential reference inside the server.
6. Create or update the provider webhook.
7. Require signed ping delivery status `200`.
8. Read the hook back from GitHub and match the inherited configuration.
9. Persist repository-scoped Evidence and environment-scoped Certification transactionally.
10. Consume the envelope only after Evidence and Certification readback succeeds.
11. Write the no-secret audit event.

Evidence is deterministic per envelope. Certification is deterministic per repository capability binding and environment. Certification proves same-cycle provider readback; it does not grant broader runtime dispatch or apply authority.

## Public Contract

The existing `/admin/system/tools/call` dispatcher remains the public HTTP surface. No dedicated webhook endpoint is added for provisioning.

- `binding_key` is the preferred selector.
- `owner` and `repo` remain optional backward-compatible selectors.
- Dry-run returns `resource_uri`, `binding_sha256`, and `capability_sha256`.
- Apply additionally requires `expected_commit_sha`, `capability_envelope_id`, typed confirmation, and a review reason.
- Public results never return `credential_ref`, `ref:secret:*`, or secret plaintext.

## Data Model

The additive migration creates:

- `repository_authority_bindings`
- `repository_authority_aliases`
- `repository_capability_bindings`
- `repository_capability_policy_layers`
- `v_repository_authority_binding_readiness`
- `v_repository_capability_binding_readiness`

It also adds `repository` to the effective workspace resource grant type and registers the repository authority adapter, webhook adapter, apply policy, and readback contract.

## Security Consequences

- Provider coordinates cannot override SQL authority.
- Credential references remain server-side and secret plaintext is never returned or logged.
- Drift between dry-run and apply is rejected before secret resolution or provider access.
- A lost atomic envelope claim performs no secret resolution and no provider call.
- Signed ping and provider readback are mandatory for success.
- Evidence or Certification failure blocks envelope consumption and success audit.
- Repository capability certification is scoped to one capability binding and one environment.

## Compatibility Consequences

The change is additive. Existing `owner` and `repo` callers continue to work when they resolve to exactly one active binding and match the canonical repository. Ambiguous, missing, or stale selectors fail closed with stable error codes.

## Operational Consequences

Code deployment and schema deployment are separate phases. Runtime readiness remains fail-closed until the V2 tables and views exist. The migration must be authorized through the governed migration registry using the final migration checksum and final merge SHA.

## Alternatives Considered

### Continue using `owner/repo` as authority

Rejected because rename and transfer create drift, and provider coordinates do not express tenant, workspace, brand, connected-system, installation, environment, or capability policy.

### Store webhook configuration directly on the repository binding

Rejected because repository identity and repository capabilities have different lifecycles. Separate capability bindings allow future repository operations to reuse the same authority model.

### Create provider-specific repository context tools

Rejected because repository identity belongs in the existing `platform_resource_context` graph. Parallel context resolvers would duplicate authorization and drift behavior.

### Certify the provider globally

Rejected because one successful webhook readback must not authorize other repositories, capabilities, tenants, or environments.

## Follow-up Constraints

- New repository capabilities must reuse the authority and policy-layer model.
- Public context projections must continue omitting credential references.
- Any change to execution authority, inheritance order, fingerprint inputs, or certification scope requires a new ADR or an explicit amendment to this decision.
