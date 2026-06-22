# Research: Unified Capability Security

## Decision 1 — Canonical capability is the policy identity

**Decision:** Normalize every selector to `canonical_capability_id` before evaluating security.

**Rationale:** Action and tool aliases currently produce different gates for equivalent operations. Alias-specific policy creates privilege-escalation opportunities and inconsistent audit evidence.

**Alternatives rejected:**

- Keep independent action/tool policies and synchronize manually: too drift-prone.
- Prefer action policy when both exist: preserves ambiguity and allows hidden precedence.
- Ban all tool aliases: breaks governed admin and device tool models unnecessarily.

## Decision 2 — Exactly one selector

**Decision:** Require exactly one selector in the request contract.

**Rationale:** Silent selector precedence creates request smuggling and audit ambiguity.

**Alternatives rejected:**

- Define a documented precedence: still permits accidental or malicious mismatch.
- Accept both when they resolve to the same capability: increases complexity before authorization and creates parser-differential risk.

## Decision 3 — Surface restrictions are additive only

**Decision:** Canonical policy defines the minimum security envelope. Surface policy can deny or add gates but cannot remove canonical gates.

**Rationale:** A tenant tool surface must not weaken an admin/action policy by omission.

## Decision 4 — Separate authorization from credentials

**Decision:** Treat credential requirement and resolution as independent from permission.

**Rationale:** A capability may need no secret and still require tenant ownership, skill, device, and approval checks. Conversely, a credential may exist but be unusable for this subject or target.

## Decision 5 — Dedicated tenant-safe intake capability

**Decision:** Expose a constrained tenant intake wrapper rather than raw admin intake tooling.

**Rationale:** Intake creation legitimately may not require an existing credential, but it still requires subject, tenant, target, redirect, expiry, and audit controls.

## Decision 6 — Device health is live state

**Decision:** Distinguish registration, provisioning, authentication, online state, health, and execution verification.

**Rationale:** A database record marked active does not prove current reachability or connector identity.

## Decision 7 — Gate lattice and fail-closed outcome

**Decision:** Required gates use explicit states: `pass`, `deny`, `not_applicable`, `not_evaluated`.

**Rationale:** `not_evaluated` must be observable and cannot support an allowed decision. This prevents early-gate failures from masking absent downstream controls during preview analysis.

## Decision 8 — Preview evaluates policy without side effects

**Decision:** Preview/policy-explain resolves all safely evaluable gates but cannot create intake sessions, approvals, provider calls, local commands, or state changes.

**Rationale:** Security regression testing requires complete evidence without executing high-risk actions.

## Decision 9 — Structured errors and traces

**Decision:** Use stable error codes and a public-safe response, with richer details in governed audit storage.

**Rationale:** Clients need actionable errors while internal topology and cross-tenant details must remain protected.

## Decision 10 — Controlled rollout

**Decision:** Ship containment first, then shadow evaluation, then staged enforcement.

**Rationale:** P0 risk requires immediate restriction, but a full policy-engine cutover can disrupt legitimate workloads without comparison data and rollback controls.

## Open technical confirmations

These are implementation facts, not product ambiguities:

- exact repository modules and language versions
- database migration framework
- current alias registry schema
- current approval-token schema
- heartbeat source and acceptable freshness threshold
- existing feature-flag provider
- performance baseline and latency budget

They MUST be resolved from the live repository and runtime registry before implementation.
