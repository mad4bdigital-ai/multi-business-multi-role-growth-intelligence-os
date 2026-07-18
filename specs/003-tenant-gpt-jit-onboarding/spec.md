# Feature Specification: Tenant GPT JIT Signup and Activation

**Feature Branch**: `gpt/003-tenant-gpt-jit-onboarding`  
**Created**: 2026-07-17  
**Status**: Approved for implementation

## Goal

Make Tenant GPT the complete user-facing interface for account creation, tenant/workspace provisioning, and Managed activation. A user may complete the embedded ChatGPT OAuth flow, but normal onboarding must never redirect to `https://auth.mad4b.com/connect` or require the application UI.

## Primary user flow

1. User sends `Activate`.
2. Tenant GPT calls `activateSession`.
3. ChatGPT opens the configured OAuth authorization surface when authentication is required.
4. Google sign-in or email registration creates or resolves the platform user.
5. The backend creates or resolves a tenant, owner membership, and default workspace atomically or resumably.
6. Tenant GPT retries `activateSession` in the same conversation.
7. Tenant GPT discovers governed tools and invokes `connect_bootstrap` in Managed mode.
8. The platform performs final readback and reports `verified` activation only when confirmed.

## User stories

### US1 — New user activates in Tenant GPT (P1)

A person with no platform account completes OAuth and receives one user, one tenant, one owner membership, one default workspace, and one verified Managed connection without opening the application UI.

### US2 — Existing user resumes without duplicates (P1)

A returning Google user or a verified matching email account reuses the canonical user and tenant state. Repeated or concurrent first-login attempts do not create duplicates.

### US3 — Incomplete provisioning is repaired safely (P1)

An active user whose original provisioning stopped before membership/workspace creation can resume. Disabled users, revoked memberships, and suspended tenants remain blocked and do not receive replacement tenants.

### US4 — Multi-tenant users select context (P2)

When multiple eligible memberships exist, the platform returns `TENANT_SELECTION_REQUIRED` with safe public workspace keys rather than selecting an arbitrary tenant.

### US5 — Partial failures resume idempotently (P2)

If identity and tenant provisioning succeed but activation fails, retry resumes at activation and creates no duplicate rows.

## Functional requirements

- **FR-001** Tenant GPT MUST be the primary interface for registration, onboarding, and activation.
- **FR-002** Standard Tenant GPT onboarding MUST NOT redirect to `/connect`.
- **FR-003** Tenant GPT MUST attempt protected operations before claiming authentication or access is unavailable.
- **FR-004** After OAuth succeeds, Tenant GPT MUST retry session activation in the same conversation.
- **FR-005** Google OAuth MUST support just-in-time provisioning for a valid new identity.
- **FR-006** User, credential, tenant, and owner membership creation MUST be atomic or safely resumable.
- **FR-007** Google linking by email MUST require `email_verified=true` and normalized exact email matching.
- **FR-008** `(auth_provider, provider_id)` MUST be unique and concurrency-safe.
- **FR-009** User, tenant, and role MUST be derived from authenticated server context, never trusted from request bodies.
- **FR-010** One OAuth-secured Tenant GPT facade MUST expose `activateSession`, `listTools`, `callTool`, `writeSessionTurn`, and `endSession`.
- **FR-011** A registry-governed `connect_bootstrap` tool MUST orchestrate workspace resolution, activation, and readback.
- **FR-012** `connect_bootstrap` MUST be idempotent and default Tenant GPT to Managed mode.
- **FR-013** Success MUST NOT be reported before final readback confirms active and verified state.
- **FR-014** OAuth authorization codes MUST be durable and single-use across instances.
- **FR-015** Multiple memberships MUST produce `TENANT_SELECTION_REQUIRED` unless an authorized context is already selected.
- **FR-016** Disabled, revoked, and suspended principals MUST be blocked without automatic replacement tenant creation.
- **FR-017** Tokens, authorization codes, passwords, provider ID tokens, and secrets MUST never appear in GPT-visible responses or logs.
- **FR-018** Failures MUST use the platform structured error envelope with stable code, stage, retryability, and request ID.
- **FR-019** Tenant GPT regression tests MUST reject hypothetical fallback responses such as “I cannot invoke the tenant endpoint”.
- **FR-020** The OAuth surface MUST remove application onboarding links while retaining privacy, terms, and support references.

## Success criteria

- A new user reaches verified Managed activation from GPT Preview without visiting `/connect`.
- Repeating or concurrently initiating the same Google login creates no duplicate identity or tenant records.
- OAuth code replay is rejected across application instances.
- Every successful activation response is backed by final readback.
- Contract tests confirm all five stable facade operation IDs and OAuth security requirements.
- Instruction regression tests fail on `/connect` onboarding fallback or prohibited hypothetical-response language.
