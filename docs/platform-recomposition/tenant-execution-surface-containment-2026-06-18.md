# Tenant Execution Surface Containment — 2026-06-18

## Scope

This change narrows Tenant GPT discovery and dispatch without changing Admin execution authority.

It covers:

- hiding `runtime_endpoint_call` from tenant discovery and requiring Admin access before dispatch;
- blocking direct GitHub content-write and delete exports by tool name even when a registry path appears tenant-visible;
- rejecting tenant dispatch before runtime/provider execution;
- validating `runtime_endpoint_preview` before principal-context derivation or facade dispatch;
- rejecting query-based provider target overrides and known metadata-service targets;
- requiring `body.content` for GitHub content-write previews and `body.sha` for delete previews;
- keeping one canonical tenant-scoped descriptor for Repository Intelligence V3 report and V4 dry-run planner.

## Security invariants

- Tenant identity continues to come from the authenticated principal.
- Blocked requests make no provider call and resolve no provider credential payload.
- Preview validation is dry-run validation only; it never authorizes a mutation.
- Direct GitHub write/delete exports remain Admin-only.
- Repository Intelligence V3/V4 remain read-only and non-mutating.
- Responses contain no secrets.

## Validation

Targeted coverage:

- `test-tenant-tool-surface-guard.mjs`
- `test-runtime-endpoint-preview-strictness.mjs`
- `test-system-layer-repository-intelligence-v3-v4-dispatch.mjs`

Release validation also requires syntax checks, architecture validation, the full test manifest, and `git diff --check`.

## Rollback

Revert the PR. No schema migration, provider write, credential mutation, or external send is included in this scope.
