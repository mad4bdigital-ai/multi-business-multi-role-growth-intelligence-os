# Implementation Plan: Unified Capability Authorization & Execution Security Hardening

**Branch:** `001-capability-security-hardening`  
**Date:** 2026-06-19  
**Spec:** `spec.md`

## Summary

Introduce a canonical capability normalization and fail-closed security decision pipeline shared by action, tool, device, credential-intake, and provider execution surfaces. Separate authorization from credentials and device readiness, enforce tenant/admin boundaries, reject selector ambiguity, add explicit mutation approvals, and produce structured decision traces.

## Technical context

- **Language/version:** Resolve from live repository before implementation.
- **Primary dependencies:** Existing auth context, registry, policy/authorization services, credential registry, connector/device registry, approval service, audit/execution log.
- **Storage:** Existing MySQL-primary registry plus additive tables/columns as required.
- **Testing:** Existing repository unit/integration framework plus governed staging acceptance probes.
- **Target platform:** `auth.mad4b.com` production; `dev.mad4b.com` staging only.
- **Project type:** Layered HTTP service with governed tool dispatch and local connector integration.
- **Performance target:** Establish current p50/p95 resolver baseline; approve added latency budget before enforcement.
- **Constraints:** No secrets in logs/responses; no production mutations during initial validation; OpenAPI 3.1; backward-compatible contracts where possible.

## Constitution check

| Gate | Status | Evidence/Action |
|---|---|---|
| Canonical capability identity | Required | New normalization layer and registry mapping |
| Explicit subject/tenant authority | Required | Auth context only; reject caller identity override |
| Security concern separation | Required | Independent gate result model |
| Fail-closed execution | Required | Default deny and completeness invariant |
| Device trust/local consent | Required | New device-trust evaluator |
| Credential safety/intake isolation | Required | Dedicated intake capability |
| Mutation approval | Required | Explicit mutation policy |
| Decision observability | Required | Structured immutable trace |
| OpenAPI 3.1 | Required | Contract supplied in `contracts/` |
| Layered architecture | Required | Domain policy engine; infrastructure adapters |
| Tests/release gates | Required | Full acceptance matrix |
| Small/reversible changes | Required | Phased flags and containment |

**Gate outcome:** PASS for planning. Implementation cannot begin until live repository module mapping and P0 containment approval are recorded.

## Proposed architecture

```text
API / Tool Dispatcher
        |
        v
Selector Contract Validator
        |
        v
Canonical Capability Resolver
        |
        v
Security Decision Orchestrator
  ├─ Principal/Tenant Authorizer
  ├─ Surface Exposure Policy
  ├─ Resource Ownership Authorizer
  ├─ Skill Evaluator
  ├─ Credential Requirement/Resolver
  ├─ Device Trust Evaluator
  ├─ Smoke/Preflight Evaluator
  ├─ Approval Evaluator
  └─ Local Consent Evaluator
        |
        v
Dispatch Readiness Invariant
        |
        +--> Preview response + decision trace
        |
        +--> Governed execution adapter
                  |
                  v
             Same-cycle readback
```

## Project structure mapping

Target locations must be adapted to the live repository while preserving these responsibilities:

```text
src/
├─ api/
│  ├─ capability-resolution.controller
│  ├─ capability-resolution.schemas
│  └─ error-mapping
├─ application/
│  ├─ resolve-capability-decision.use-case
│  ├─ create-secure-intake.use-case
│  └─ execute-governed-capability.use-case
├─ domain/
│  ├─ capability/
│  ├─ authorization/
│  ├─ device-trust/
│  ├─ credential-policy/
│  ├─ approval/
│  └─ security-decision/
├─ infrastructure/
│  ├─ registry/
│  ├─ credentials/
│  ├─ device-connector/
│  ├─ approvals/
│  └─ audit/
└─ config/
   └─ security-feature-flags
```

## Phase 0 — Containment and discovery

1. Add deny-by-default tenant block for admin surfaces.
2. Disable unsafe dual-surface tool aliases or force them through canonical action policy.
3. Reject multi-selector requests.
4. Block unvalidated credentials from execution.
5. Add kill switches for local shell, file write, Cloudflare mutation, n8n mutation, and raw intake creation.
6. Inspect live repository and registry schemas.
7. Inventory all aliases, dual-surface capabilities, mutation classifications, and tenant-exposed admin tools.
8. Capture baseline resolver latency and legitimate traffic patterns.

## Phase 1 — Domain and contract design

1. Add canonical capability and alias model.
2. Define gate state and decision invariants.
3. Define principal/surface/resource policy.
4. Define credential requirement vs usability.
5. Define device trust and heartbeat policy.
6. Define approval and local-consent policies.
7. Publish OpenAPI contract and error catalog.
8. Define audit retention and redaction.

## Phase 2 — Core implementation

1. Implement strict selector validator.
2. Implement canonical resolver.
3. Implement centralized decision orchestrator.
4. Implement fail-closed completeness check.
5. Implement structured decision trace.
6. Integrate existing action and tool routes through the same use case.
7. Add tenant/admin surface enforcement.

## Phase 3 — Credentials and secure intake

1. Move credential resolution after authorization.
2. Enforce credential usability state.
3. Build tenant-safe secure intake wrapper.
4. Add single-use/expiry/replay controls.
5. Remove tenant dispatch path to raw admin intake tools.

## Phase 4 — Device and local execution

1. Require and validate `device_id`.
2. Verify ownership and caller authorization.
3. Verify connector identity and heartbeat freshness.
4. Enforce capability support.
5. Add local consent/approval policy.
6. Restrict shell commands and file roots.
7. Bind n8n instance and Cloudflare zone ownership.

## Phase 5 — Status and observability

1. Replace coarse activation status with component readiness.
2. Add decision-trace API/admin detail.
3. Add metrics for denials, mismatches, unevaluated gates, and shadow-policy differences.
4. Add alerting for any `dispatch_ready` invariant violation.

## Phase 6 — Verification and rollout

1. Run unit and integration suites.
2. Run acceptance matrix in preview mode.
3. Run shadow comparison against legacy decisions.
4. Resolve legitimate mismatches.
5. Enable staging enforcement.
6. Run bounded approved mutation tests.
7. Complete security review and release readiness.
8. Promote incrementally with rollback flags.
9. Monitor and finalize deprecation of legacy paths.

## Migration strategy

- Add canonical records and aliases without deleting legacy keys.
- Read legacy aliases through the canonical resolver.
- Shadow-evaluate new policy while legacy execution remains authoritative only during the approved comparison window.
- Stop execution when the new policy denies a high-risk request, even during shadow mode, for explicitly listed P0 containment cases.
- Migrate callers to the one-selector contract.
- Remove silent precedence.
- Deprecate raw tenant access to admin tool keys.
- Remove legacy policy branches after parity and traffic confirmation.

## Security controls

- no secret material in traces
- object-level authorization before credential lookup
- constant/public-safe error behavior for cross-tenant objects
- request digest binding for approval
- replay protection for intake and approval
- command/path allowlists for local operations
- before/after/readback for high-risk mutations
- immutable or tamper-evident audit records

## Rollback

Each enforcement group must have an independent server-side flag:

- selector strictness
- canonical policy enforcement
- tenant/admin surface block
- credential usability enforcement
- secure intake wrapper
- device trust enforcement
- local consent enforcement
- mutation approval enforcement
- readiness response projection

Rollback MUST NOT re-enable known P0 tenant-to-admin exposure. Emergency rollback must preserve containment deny rules.

## Complexity tracking

| Complexity | Why needed | Simpler alternative rejected |
|---|---|---|
| Canonical alias registry | Multiple surfaces represent identical capabilities | Manual policy synchronization already drifted |
| Explicit gate result model | Need distinguish deny/not-evaluated/not-applicable | Single boolean hid missing controls |
| Shadow policy evaluation | Reduce cutover risk | Big-bang enforcement risks legitimate outages |
| Dedicated intake capability | Tenant flow needs no existing credential but needs strict authority | Raw admin tool exposure is unsafe |
