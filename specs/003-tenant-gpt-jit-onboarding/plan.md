# Implementation Plan: Tenant GPT JIT Signup and Activation

**Branch**: `gpt/003-tenant-gpt-jit-onboarding`  
**Spec**: `specs/003-tenant-gpt-jit-onboarding/spec.md`

## Architecture

```text
Tenant GPT
  -> auth.mad4b.com Tenant GPT facade
      -> OAuth authorize/token
      -> activateSession
      -> listTools/callTool
          -> connect_bootstrap
              -> principal and membership resolution
              -> workspace repair/create when eligible
              -> Managed activation
              -> final status readback
```

## Decisions

1. Keep the embedded OAuth flow; remove dependency on application onboarding UI.
2. Expose one stable OpenAPI 3.1 facade with five operation IDs.
3. Register `connect_bootstrap` through SQL registry authority; never invent action keys.
4. Derive identity and tenant context from JWT/session, not caller-provided IDs.
5. Persist hashed OAuth authorization codes and consume them atomically.
6. Make provisioning and bootstrap idempotent and resumable.
7. Preserve `/connect` only as optional support/admin UI.

## Data changes

- Add/verify unique `(auth_provider, provider_id)`.
- Add durable OAuth authorization-code storage with expiry and `consumed_at`.
- Add onboarding-run state sufficient for retry, audit, and partial-failure recovery.
- Use additive migrations and perform duplicate preflight before uniqueness changes.

## Implementation phases

### Phase A — Behavior and contract
- Remove `/connect` fallback from Tenant GPT instructions.
- Require post-OAuth retry and actual tool invocation.
- Generate a single Tenant GPT facade schema.
- Add instruction and schema regression tests.

### Phase B — Auth hardening
- Normalize emails in registration, login, and Google linking.
- Require verified Google email and validate issuer/audience/expiry/subject.
- Handle duplicate-key races by rereading canonical rows.
- Persist and atomically consume OAuth codes.

### Phase C — Bootstrap orchestration
- Resolve the canonical registry action and endpoint keys.
- Implement and register `connect_bootstrap`.
- Handle incomplete provisioning, blocked principals, and multi-tenant selection.
- Require final readback before verified success.

### Phase D — UX and validation
- Remove setup/dashboard links from the OAuth authorization surface.
- Preserve privacy, terms, and support links.
- Run unit, integration, migration, OpenAPI, concurrency, and instruction tests.
- Verify on `dev.mad4b.com` and in GPT Preview.
- Produce release-readiness evidence before merge.

## Rollback

- Keep existing `connect_status`, `connect_workspace_create`, and `connect_activate` paths.
- Feature-flag the new bootstrap path where practical.
- Use additive migrations.
- Roll back GPT instructions/schema independently when safe.
- Never write directly to protected `main`; merge only after CI and readiness approval.
