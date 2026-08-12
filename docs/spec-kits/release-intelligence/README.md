# Release Intelligence SPEC KIT

Status: draft
Audience: Platform Admin, Tenant Owner, Runtime Maintainers
Scope: release readiness, runtime parity, deploy gates, capability envelopes, self-healing advisory
Safety: no provider execution by default; apply requires capability envelope, approval, readback, and audit evidence

## Purpose

This SPEC KIT turns release recovery from an ad-hoc sequence of manual tool calls into a reusable, governed, dynamically extensible release intelligence system.

The kit generalizes the latest release-readiness and production parity work into a model that can support both ADMIN and TENANT surfaces without hardcoding one runtime, one provider, one target, or one approval path.

## Core idea

Every release, deploy, restart, gate change, parity check, or cleanup is represented as a `release_operation` with a typed lifecycle, bounded evidence, scope-aware capability envelopes, and explicit readback.

The platform should not treat deploy as a single synchronous shell-like action. It should treat deploy as an operation with preflight, approval, execution, readback, classification, cleanup, and post-run evidence.

## Non-goals

- Do not auto-execute production deploys without capability approval.
- Do not expose provider credentials, SSH payloads, tokens, or secrets.
- Do not bypass target ownership, tenant scope, workspace authority, or runtime certification.
- Do not rely on fixed migration notes, stale parity IDs, or hand-built envelopes.
- Do not make Hostinger the only supported runtime model.

## Kit contents

- `manifest.json` declares surfaces, roles, entities, and required contracts.
- `admin-spec.md` defines platform-admin workflows and controls.
- `tenant-spec.md` defines tenant-safe workflows and boundaries.
- `contracts.md` defines canonical entities, states, API shapes, and error classes.
- `rollout-plan.md` defines incremental PR phases, validation, and acceptance criteria.

## Operating model

The release intelligence system has five pillars:

1. Release Operation Ledger
2. Async Deploy and Readback Contract
3. Dynamic Gate Manager
4. Capability Envelope Template Resolver
5. Self-Healing Release Advisor

Each pillar is intentionally small and composable. Runtime-specific adapters such as Hostinger, Cloud Run, VPS, GitHub Actions, n8n, or WordPress plug into the same lifecycle.

## Required invariants

- All state-changing actions require capability envelope resolution.
- Critical or production actions require approval evidence.
- Runtime parity is a trigger and a readback source, not the only control.
- Gates must have TTL, owner, operation binding, and cleanup readback.
- 503 during restart is not automatically final failure; it can classify as `restart_in_progress` when readback later verifies success.
- Every final classification must cite evidence references.
- ADMIN can operate cross-tenant only through platform authority.
- TENANT can only see and operate tenant-owned targets and sanitized evidence.

## First implementation target

The first target is production release orchestration for `auth.mad4b.com`, using Hostinger as one runtime adapter. The same model must remain portable to TENANT-managed runtimes and future providers.
