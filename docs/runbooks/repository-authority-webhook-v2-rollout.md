# Repository Authority and GitHub Webhook V2 Rollout Runbook

## Purpose

Safely deploy, authorize, validate, and operate repository authority and the repository-main-moved GitHub webhook capability without exposing secrets or allowing unreviewed provider writes.

## Scope

This runbook covers:

- migration `20260721_repository_authority_capability_bindings_v2.sql`
- Repository Authority and Capability readiness
- `platform_resource_context` repository projections
- webhook status, dry-run, apply, Evidence, and Certification
- rollback and failure handling

It does not authorize unrelated repository capabilities or generic GitHub provider writes.

## Preconditions

Before merge:

- PR CI passes Syntax Check, Architecture Drift Detection, Execution Resolver Gate, and Unit & Integration Tests.
- The branch is current with `main`.
- OpenAPI examples, ADR, and this runbook are present.
- Migration contract, resolver, platform-context, envelope, webhook, and certification tests are registered in the governed test manifest.
- No secret plaintext or credential reference appears in public responses, tests, audit payloads, or Evidence payloads.

After merge and deployment:

- Capture the final merge SHA.
- Calculate the final migration checksum and statement count from the deployed migration file.
- Confirm the deployed commit contains the merge.
- Do not create or update a webhook before migration authorization, migration readback, readiness, and dry-run all succeed.

## Phase 1: Authorize the Migration

Use `governed_migration_authorization_bootstrap` with:

- migration filename
- final SHA-256 checksum
- final statement count
- PR number
- final merge SHA
- explicit review evidence
- a fresh, migration-specific Capability Envelope and approval

Do not reuse repository patch, PR, or webhook envelopes.

Expected result:

- one active authorization row
- checksum and statement count match the deployed file
- authorization is bound to the final merge SHA
- no migration statement has executed yet

## Phase 2: Run the Migration

Invoke the governed migration runner with the exact filename and checksum. The runner must use the authorization registry when available; the bootstrap fallback allowlist is not sufficient evidence for production execution.

Required readback:

- migration ledger reports success
- all four tables exist
- both readiness views exist
- `workspace_resource_grants.resource_type` supports `repository`
- seeded adapter, policy, and readback rows are active
- the expected primary repository authority binding exists
- the expected primary webhook capability binding exists
- no duplicate active primary binding exists

Stop on schema, checksum, statement-count, authorization, or readback mismatch.

## Phase 3: Readiness

Run:

- `platform_resource_context_readiness_smoke`
- `github_repository_main_moved_webhook_provisioning_readiness_smoke`

Required conditions:

- Repository V2 schema objects are present.
- Exactly one primary ready webhook capability binding resolves for the intended environment.
- The inherited callback equals the governed production endpoint.
- The inherited event set is exactly `push`.
- GitHub App ID, installation, and private key are configured.
- The credential reference resolves with `includeSecret=false`.
- No provider call or mutation is executed by readiness.
- No credential reference or secret value appears in the result.

## Phase 4: Context and Dry-Run Validation

Resolve the repository through `platform_resource_context_resolve` using `binding_key`, immutable node ID, and legacy `owner/repo` selector in separate read-only checks.

Confirm:

- all selectors resolve to one canonical binding
- tenant, workspace, brand, app, connected system, and environment are correct
- public context includes `binding_sha256` and safe capability metadata
- public context omits `credential_ref`

Run webhook dry-run with `binding_key`.

Record from the response:

- `binding_key`
- `resource_uri`
- `binding_sha256`
- `capability_sha256`
- planned action
- callback and inherited events

Dry-run must report `provider_write=false` and `external_write=false`.

## Phase 5: Create the Apply Envelope

Create a fresh, single-use Capability Envelope for:

- app key `github`
- capability and operation intent `github_repository_main_moved_webhook_provision`
- tenant, user, workspace, and brand from the resolved binding
- `resource_uri` from dry-run
- exact deployed commit SHA
- `binding_sha256` from dry-run
- `capability_sha256` from dry-run

Approve the envelope with a plan-specific decision note. Do not reuse any prior hold or envelope.

## Phase 6: Apply

Call `github_repository_main_moved_webhook_provision` through `/admin/system/tools/call` with:

- `binding_key`
- `mode=apply`
- typed confirmation `PROVISION_GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK`
- approved Capability Envelope ID
- exact deployed commit SHA
- reviewed binding and capability fingerprints
- a review reason of at least 20 characters

The implementation must perform this order:

1. Re-resolve SQL authority and capability.
2. Reject binding or capability drift.
3. Validate the full envelope context.
4. Atomically claim the envelope.
5. Resolve the secret server-side.
6. Create or patch the hook.
7. Trigger signed ping.
8. Require delivery status `200`.
9. Read the hook back and match callback, event set, active state, content type, and SSL mode.
10. Mark the secret reference validated.
11. Persist Evidence and Certification transactionally and read them back.
12. Consume the envelope.
13. Write the success audit.

## Phase 7: Same-Cycle Verification

Verify the apply response contains:

- canonical repository binding evidence
- hook readback
- signed ping evidence
- consumed envelope status
- `evidence_id`
- `certification_id`
- certification type `provider_external_write_readback`
- certification status `same_cycle_readback_certified`
- environment
- `secrets_included=false`

Read back the Evidence and Certification rows directly through governed read-only tools. Confirm:

- Evidence is scoped to the repository capability binding and envelope.
- Certification is scoped to the capability binding and environment.
- hashes and commit SHA match the reviewed plan.
- `secrets_included=0`.
- no runtime dispatch or apply authority was widened.

Then run webhook status and confirm exactly one hook uses the governed callback.

## Monitoring

Monitor:

- webhook delivery failures
- duplicate callback hooks
- authority or capability drift errors
- envelope claim failures
- signed ping failures
- provider readback mismatch
- Evidence or Certification rollback
- expired or revoked certification

A successful provider write without successful Evidence and Certification is not a successful platform operation.

## Failure Handling

### Authority or fingerprint drift

Stop. Run a new dry-run and create a new envelope. Do not reuse the old envelope.

### Atomic claim failure

Confirm no secret resolution and no provider call occurred. Investigate envelope replay or concurrent execution.

### Provider outcome unknown

Read back hook state before retrying. Do not replay a create blindly.

### Signed ping or readback failure

Keep the envelope unconsumed. Inspect the hook and delivery records. Repair the cause and use a new reviewed envelope for another apply attempt.

### Evidence or Certification failure

The hook may exist at the provider, but the platform operation is not certified. Read back provider state, repair persistence or readback, and execute a new reviewed apply plan. Do not manually mark the prior envelope executed.

## Rollback

Rollback is staged and evidence-driven.

### Runtime rollback

Revert the application commit through the normal PR and deployment process. Do not force-push protected branches.

### Capability rollback

Set the affected repository capability binding to a non-active lifecycle state through a governed migration or approved admin mutation. This blocks new applies while preserving authority and audit history.

### Provider rollback

Delete or deactivate the specific hook only after exact hook ID and callback readback, with a separate provider-mutation plan, approval, and same-cycle readback. Never delete hooks by callback alone when duplicates exist.

### Schema rollback

Do not drop V2 tables during an incident. Prefer disabling capability rows and reverting runtime use. Destructive schema rollback requires a separately reviewed migration because Evidence, Certification, aliases, and authority history may depend on the tables.

### Secret rollback

Rotate or revoke the secret through credential governance. Do not place a replacement secret in source, logs, Evidence, or tool arguments.

## Completion Criteria

The rollout is complete only when:

- deployed commit parity is verified
- migration authorization and execution readback pass
- both readiness smokes pass
- dry-run and apply use matching fingerprints
- the hook readback and signed ping pass
- Evidence and Certification readback pass
- the envelope is consumed exactly once
- audit contains no secret material
- monitoring shows no unresolved duplicate, drift, or delivery issue
