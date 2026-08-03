# Spec 012 T009 — Data Governance Review Readiness

## Status

`technical_review_complete_approval_required`

This record completes the repository-side technical review for data classification, retention categories, and redaction controls. It does **not** close T009 because final retention durations require separately registered Security and Legal/Privacy approval.

## Reviewed authority

- `spec.md`: FR-007, FR-032, NFR-001, NFR-004, NFR-008, and the state/data prohibition on raw secrets and unbounded payloads.
- `concerns.md`: C-017 credential safety, C-018 privacy, C-031 log injection, C-044 questionnaire data privacy, and the privacy/retention section.
- `data-model.md`: lifecycle entities, bounded summaries, `sensitive_values_included=false`, and provisional retention categories.
- `checklists/security.md`: existing no-secret, summary-first, bounded-diagnostic controls and the still-open retention approval gate.

## Classification decision

Five data classes are now defined in the machine-readable companion record:

1. `forbidden_secret_material` — raw tokens, raw authorization codes, authorization headers, client/provider secrets, keys, and backend credentials. These are forbidden in lifecycle storage, logs, evidence, fixtures, contracts, and GPT responses.
2. `restricted_identity_and_authority` — tenant, user, membership, workspace, actor, approval, and object-authority identifiers. These remain governed internal evidence and are omitted or made opaque in GPT-visible projections.
3. `confidential_tenant_configuration` — questionnaire answers, policy proposals, connection modes, tool readiness, and tenant strategy/configuration. These require tenant scope, field minimization, schema validation, version provenance, and secret-input rejection.
4. `internal_operational_evidence` — operation, stage, reconciliation, delivery, acknowledgement, deployment, and attention records. GPT exposure is limited to bounded redacted projections.
5. `opaque_public_diagnostic` — stable error codes, request IDs, stage status, retryability, opaque deployment state, and approved next actions.

## Entity coverage

The review classifies the following lifecycle records:

- OAuth authorization code records;
- access-token verification evidence;
- session-context summaries;
- activation operations;
- stage attempts;
- evidence items;
- delivery and acknowledgement records;
- reconciliation attempts;
- deployment observations;
- operational attention items;
- questionnaire answer sessions;
- governed policy proposals and activations.

No entity is permitted to retain a raw access token, raw authorization code, authorization header, provider credential, client secret, unbounded request/response body, or full conversation content.

## Redaction contract

All GPT-visible and ordinary diagnostic evidence must use an allowlisted projection with:

- tenant/user and object-level scope;
- bounded strings and collections;
- structured log-injection encoding;
- raw dumps disabled by default;
- secret scanning;
- `sensitive_values_included=false` for GPT-visible evidence.

Elevated raw diagnostic capture is not enabled by this review. Any future capture requires separate authority, a strict bound, the shortest approved expiry, and deletion readback.

## Retention profiles

The technical review defines lifecycle triggers and destruction/minimization rules for:

- ephemeral authentication/security records;
- tenant session support records;
- operational/security audit evidence;
- delivery and acknowledgement support metadata;
- release/deployment audit observations;
- questionnaire and tenant policy configuration;
- policy activation/audit provenance;
- elevated raw diagnostic capture.

All finalized durations remain `null`, except the default raw-diagnostic profile which is disabled (`0` effective days unless separately approved). This prevents a repository artifact from silently inventing a legal or security retention schedule.

## Remaining approval gate

T009 remains open until one versioned approval record contains:

- Security owner identity;
- Legal/Privacy owner identity;
- approved duration for every retention profile;
- jurisdiction and legal-hold rules;
- deletion/minimization readback contract;
- approval timestamp and version.

Only after those fields are registered and validated may T009 become `[x]` and downstream retention enforcement be implemented.

## Non-effects

This review does not:

- activate a retention duration;
- delete or mutate data;
- apply SQL or migrations;
- wire runtime behavior;
- deploy to Production;
- read credentials;
- expose secrets.
