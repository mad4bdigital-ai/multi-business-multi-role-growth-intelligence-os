# Feature 022 — Governed Dynamic Recovery Orchestrator

**Status:** source implementation / native acceptance pending
**Parent:** WordPress-independent MAD4B platform PR #8471
**Scope:** generic adapter orchestration (Hostinger, SQL, Windows, GitHub, WordPress, Browser), with no provider-specific credentials or operations in this package.

## Goal
Unify Discover → Diagnose → Plan → Authorize → Execute → Independent Verify → Recover / Unknown / Partial / Rollback, without allowing the orchestration engine to grant itself permissions. An adapter cannot claim RECOVERED; it may only emit an execution receipt subject to separate, trusted readback.

## Actors and trust boundaries
1. **Caller:** may request known capability/operation identifiers; cannot choose provider URL, credential, SQL, shell, approver, device or effective environment.
2. **Server-owned capability registry:** injects trusted adapters from explicit composition; default empty and read-only. No first-run auto-activation.
3. **Identity resolver:** binds tenant, resource, source commit SHA, fingerprint, environment and issuer before plan creation.
4. **Approval authority:** separate from adapter and request; must verify exact plan, resource, environment, SHA and single-use.
5. **Durable store:** outside the resources under repair; read/write plan, atomic claim, pre-dispatch intent, uncertainty and final evidence.
6. **Fenced lease:** prevents late/stale workers from claiming a live operation.
7. **Executor adapter:** Staging-only v1, no HTTP write routes, no Production capabilities, no implicit plugin installs.
8. **Independent evidence verifier:** separate server-owned issuer, must bind plan hash, source, environment, tenant, resource and fingerprint.

## Functional requirements
- FR-01. Server-registered adapters express provider/resource, supported environments, operations and risk classes. Reject duplicate/unknown/unbounded capabilities and unrecognized arguments.
- FR-02. Diagnostics are read-only and return bounded fingerprints; no raw secrets or mutable request-defined adapter endpoints.
- FR-03. Persist immutable, content-addressed, source-bound plans with finite expiry. Every operation references persisted plan ID/hash.
- FR-04. Reject scope drift, expired plans, missing approval, missing/expired lease, absent durable intent, and incomplete readback.
- FR-05. Do not dispatch when intent persistence, atomic claim or fence proof fails. Replays require durable idempotency, not just duplicate HTTP protection.
- FR-06. After ambiguous provider outcome, return UNKNOWN; do not execute again to "see if it worked." Reconcile using the independent authority.
- FR-07. Final RECOVERED requires durable finalization and readback evidence. Refuse forged success booleans.
- FR-08. Default response is NO AUTHORITY even if adapter objects are registered. Production mutation remains unavailable until a later, separately approved activation feature.
- FR-09. Expose only GET /admin/recovery/orchestrator/capabilities with existing backend+admin authentication; no write endpoint.
- FR-10. Do not reuse old in-memory Recovery Kernel maps as durable provider identity, execution journal, approval ticket, or race-safe lock.

## Non-goals
- No live Hostinger CREATE/Node ENV PUT, SQL DDL/grant, Windows task mutation, WordPress deployment, browser mutation, GitHub ruleset write, or Production promotion.
- No provider-specific secrets, backend vault bootstrapping, automatic approval, TPM attestation, externally signed certification, or rollback without an explicit independent implementation.
- No equivalence between synthetic CI and native Staging/Production acceptance.

## Safety invariants
- Production execution disabled regardless of caller overrides.
- Mutation route count = 0 for v1.
- Signed provider receipt alone is not independent readback.
- Eventual retry with unknown outcome is blocked unless independently reconciled.
- Never silently mark a failed/incomplete durable journal as RECOVERED.

## Acceptance
Source: individual tests for discovery, plan integrity, scope drift, lease/fence loss, unknown receipt, duplicate attempt and reconciliation.
Native: independently prove atomic claim, persisted intent, fencing, readback and no double-effect across process/network failures on Staging. Until native evidence exists, label only source_verified, not runtime_recovered.
