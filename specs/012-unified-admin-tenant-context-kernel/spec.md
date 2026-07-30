# Specification: Unified Dynamic Context Kernel

## 1. Problem statement

The platform currently exposes multiple context and capability surfaces that can independently resolve tenants, workspaces, brands, resources, connections, and execution authority. Administrators may be authorized across many tenants and workspaces, while tenant users may belong to more than one tenant or workspace. When these surfaces are not coordinated, the runtime can select a textually similar but operationally wrong context, retain stale context across requests, or begin capability resolution before the effective subject and exact target resource are known.

This specification defines one shared kernel for every principal type. Admin is not a separate execution architecture. Admin only has a broader visibility and authority set. All principals use the same resolution stages, invariants, error model, pinning model, approval model, and readback model.

## 2. Goals

- Resolve every request dynamically from authenticated principal evidence and live SQL registries.
- Separate authenticated principal, effective subject, target resource, exact connection, and authority path.
- Support any number of tenants, workspaces, brands, resources, and connections.
- Prevent cross-tenant candidate leakage and implicit Admin impersonation.
- Produce deterministic, explainable context decisions.
- Stop ambiguous or stale high-risk operations before execution.
- Preserve a smooth experience by reusing only verified, revision-bound context pins.
- Recover safely from transport failures and unknown provider outcomes.
- Eliminate production hardcoding of customer identifiers.
- Model personal, company-workspace, and brand connection ownership explicitly.
- Preserve existing operational workspace classifications while adding a separate ownership classification.
- Keep provider identity login separate from provider API consent and credential readiness.

## 3. Non-goals

- No provider-specific business workflow is implemented by this specification.
- No production deployment or migration is performed from this branch.
- No protected branch is modified.
- No new authority is inferred from labels, historical usage, or broad Admin visibility.
- No OAuth callback, provider credential, or runtime resolver is enabled by this specification amendment.
- Existing operational `workspaceType` values are not renamed, replaced, or reinterpreted as personal/company ownership.

## 4. Principal model

Supported principal types include:

- tenant user;
- administrator;
- service principal;
- delegated agent;
- future principal types registered in SQL.

Every request MUST begin with an authenticated principal. A principal MAY have multiple authorized tenant and workspace scopes. An effective subject MUST be resolved before any tenant-scoped mutation. An administrator MUST NOT silently become a tenant user.

## 5. Canonical resolution stages

1. Authenticate principal.
2. Enumerate authorized visibility set.
3. Resolve effective subject.
4. Resolve tenant.
5. Resolve workspace, operational workspace type, and workspace ownership type.
6. Resolve optional brand and required target resource.
7. Resolve exact connection ownership scope and credential scope.
8. Resolve authority path.
9. Resolve semantic capability and runtime binding.
10. Compile execution plan.
11. Obtain approval when required.
12. Revalidate context revision, ownership, capability, authority, plan, approval, and non-secret readiness evidence.
13. Materialize credential through the guarded credential boundary for the selected connection only.
14. Validate credential-dependent provider readiness, including credential validity, provider-account binding, granted scopes, reachability, quota, schema, and readback capability.
15. Dispatch.
16. Read back and reconcile.

A later stage MUST NOT repair or replace a missing earlier stage silently. Credential materialization MUST NOT occur before all pre-credential context, ownership, capability, authority, plan, approval, and non-secret readiness checks pass.

## 6. Functional requirements

### Context discovery

- FR-001: The kernel MUST enumerate authorized tenant candidates from live registry data.
- FR-002: The kernel MUST enumerate workspace candidates within the selected tenant scope.
- FR-003: The kernel MUST expose candidate labels together with stable references, ownership scope, authority source, and readiness summary.
- FR-004: The kernel MUST distinguish visibility candidates from execution candidates.
- FR-005: The kernel MUST exclude resources outside the request tenant from execution ranking even when visible to an administrator.
- FR-006: The kernel MUST support resource-first operations where no brand is required.
- FR-007: The kernel MUST support brand-scoped operations only after Brand Core and brand authority checks pass.

### Deterministic resolution

- FR-008: Explicit identifiers supplied by an authorized caller take precedence over labels.
- FR-009: A verified conversation or workflow context pin MAY be reused when its revision remains current.
- FR-010: Exact resource and connection bindings take precedence over historical usage.
- FR-011: A single authorized candidate MAY be auto-selected.
- FR-012: Multiple valid candidates MUST produce `interpretation_required` unless an explicit deterministic binding resolves them.
- FR-013: Text similarity alone MUST NOT authorize a mutation.
- FR-014: Selection decisions MUST include reason codes and evidence references.

### Effective subject and authority

- FR-015: Tenant-scoped mutations MUST have an effective tenant subject.
- FR-016: User-scoped mutations MUST have an effective user subject where the provider or policy requires one.
- FR-017: Service principals MUST use explicit service bindings.
- FR-018: Admin visibility MUST NOT imply tenant execution authority.
- FR-019: Authority MUST be resource-scoped and capability-scoped.
- FR-020: Authority expiry or revocation MUST invalidate pending execution contexts.

### Context pinning and switching

- FR-021: A context pin MUST include tenant, workspace, optional brand, resource, connection, context revision, source, scope, and expiry.
- FR-022: Changing tenant MUST invalidate workspace, brand, resource, connection, plan, approval, and execution envelopes derived from the previous tenant.
- FR-023: Changing workspace MUST invalidate dependent brand, resource, connection, plan, approval, and execution envelopes.
- FR-024: Context pins MUST be scoped to request, workflow, or conversation.
- FR-025: Low-risk reads MAY reuse a valid last-confirmed pin; high-risk writes MUST revalidate it.

### Capability and readiness

- FR-026: Context readiness and operation readiness MUST be evaluated separately.
- FR-027: Operation readiness MUST be evaluated in two phases: pre-credential readiness covers configuration, context, ownership, capability, authority, plan, approval, and non-secret policy evidence; credential-dependent provider readiness follows guarded credential materialization and covers credential validity, provider-account binding, granted scopes, reachability, quota, schema verification, and readback readiness.
- FR-028: High-risk operations MUST NOT select platform fallback, provider fallback, or the first connection silently.
- FR-029: The runtime MUST bind one exact connection before provider dispatch.
- FR-030: The runtime MUST reject capability and runtime-surface mismatches.

### Planning, approval, and execution

- FR-031: The request compiler MUST bind context hash and plan hash.
- FR-032: Approval MUST reference the exact plan, context revision, target resource, and capability.
- FR-033: Context changes after approval MUST invalidate the approval.
- FR-034: Unsafe retryable operations MUST require an idempotency key.
- FR-035: Dispatch MUST validate optimistic concurrency for mutable repository or provider resources.
- FR-036: Provider writes MUST be followed by same-cycle readback when the provider supports it.

### Unknown outcome and continuity

- FR-037: Transport loss after dispatch MUST produce `outcome_unknown`, not an immediate retry.
- FR-038: Reconciliation MUST use idempotency evidence, provider readback, or resource fingerprints.
- FR-039: The runtime MUST distinguish `not_executed_verified`, `executed_readback_recovered`, and `outcome_unresolved`.
- FR-040: Support escalation MUST preserve the context decision, plan, approvals, dispatch evidence, and reconciliation history without secrets.

### Dynamic and generalized implementation

- FR-041: Production source and shared configuration MUST NOT contain fixed tenant, user, workspace, brand, connection, or provider-account identifiers.
- FR-042: Repository and database adapters MUST discover schema and bindings from governed registries rather than guessed table or column names.
- FR-043: New principal, resource, and capability types MUST be registerable without adding customer-specific branches to the domain layer.
- FR-044: UI and API projections MUST be principal-safe and tenant-safe.
- FR-045: Synthetic examples MUST be clearly marked and isolated from production configuration.

### Hierarchical connection ownership

- FR-046: Every workspace MUST expose a governed `workspaceOwnershipType` of `personal` or `company` before connection ownership is resolved. This field is independent from, and MUST NOT redefine, the existing operational `workspaceType` classification.
- FR-047: Every provider connection MUST have one exact `ownerScopeType` of `personal_workspace`, `company_workspace`, or `brand`, with an exact owner reference. Every resolved decision that selects a connection MUST carry that exact owner scope type and reference in the immutable decision. A decision that has not selected one exact connection MUST omit selected connection and owner-scope fields rather than invent values.
- FR-048: A personal connection MUST be eligible only when its owner user equals the effective user.
- FR-049: Company-workspace membership MUST NOT authorize use of another member's personal connection.
- FR-050: A brand connection MUST be eligible only for the exact brand and workspace that own it.
- FR-051: Connection precedence MUST be explicit authorized pin, exact brand, exact workspace, then effective-user personal connection when policy permits.
- FR-052: Equal-ranked eligible connections MUST produce `CONNECTION_AMBIGUOUS`; first-row or provider-key-only selection is forbidden.
- FR-053: A revoked, expired, disabled, insufficient-scope, stale, or owner-mismatched connection MUST be ineligible.
- FR-054: Consequential writes MUST NOT silently fall back from an explicitly bound or more-specific invalid connection.
- FR-055: Personal connection inheritance inside a company-workspace operation MUST require an explicit operation policy.
- FR-056: Credential material MUST remain unavailable during candidate discovery and all pre-credential checks. After one exact connection, owner scope, capability, authority path, execution plan, approval state, and non-secret readiness decision agree, the runtime MAY materialize the credential through the guarded credential boundary solely to perform credential-dependent provider readiness and dispatch. Credential material MUST NOT enter customer projections, context decisions, plans, logs, or evidence.
- FR-057: Connection ownership, authorization, provider-scope, membership, workspace ownership, or brand revision changes MUST invalidate dependent pins, plans, approvals, and cached decisions.
- FR-058: Google identity login MUST NOT be treated as Google Drive, Docs, Gmail, Analytics, Ads, or other provider API consent.
- FR-059: Provider authorization state MUST be signed, expiring, nonce-bound, single-use, redirect-allowlisted, and bound to the authenticated principal and exact owner scope. Reconnect state MUST additionally bind the intended connection reference, expected connection revision, and expected provider account reference or privacy-preserving account-binding hash.
- FR-060: OAuth callbacks MUST derive authority from authenticated and signed state and MUST NOT accept free caller-supplied user or tenant identifiers as authority. Reconnect callbacks MUST reject a returned provider account that differs from the signed expected binding. Credential replacement MUST itself use a compare-and-set against the signed expected connection revision and live claimed-state revision; the replacement, connection revision increment, and transition from `claimed` to `consumed` MUST complete atomically or all remain unapplied.
- FR-061: Public connection APIs MUST use strict OpenAPI 3.1 contracts, stable structured errors, no-secret projections, bounded pagination, and same-cycle readback for mutations.
- FR-062: Legacy connection records MUST be preserved and classified through an additive compatibility path before destructive cleanup.
- FR-063: Effective Capability Envelope and Effective Authority MUST consume the exact Context Kernel connection and owner-scope decision instead of implementing competing selectors or re-fetching mutable ownership metadata.
- FR-064: Additive ownership and authorization-state migrations MUST be separately authorized, applied, and read back successfully before shadow resolution or any read/write rollout depends on the new persistence fields.
- FR-065: Rollback after hierarchical connection routing is enabled MUST retain the exact-owner isolation guard. If the guarded resolver is unavailable, affected provider operations MUST be disabled or fail closed rather than return to an earlier selector that can choose another user's connection.
- FR-066: Before authorization-code exchange, provider calls, credential lookup, or credential mutation, an OAuth callback MUST atomically claim the signed authorization state with a revision-bound compare-and-set from `issued` to `claimed`. Exactly one concurrent callback may continue. Losing or later callbacks MUST fail closed without exchanging a code or mutating credentials, and completion to `consumed` MUST remain bound to the successful claim.

## 7. Non-functional requirements

- NFR-001: Resolution decisions MUST be deterministic for the same registry revision and request.
- NFR-002: Every decision MUST be traceable with request ID, context hash, registry revision, and reason codes.
- NFR-003: No secret or raw provider error may appear in customer projections.
- NFR-004: Context resolution MUST support bounded pagination and candidate limits.
- NFR-005: Registry changes MUST invalidate affected caches by revision.
- NFR-006: Public contracts MUST remain backward compatible through additive rollout.
- NFR-007: Failure modes MUST be structured and actionable.
- NFR-008: Multi-tenant isolation tests are release blocking.
- NFR-009: Cross-user and cross-brand connection-isolation tests are release blocking.
- NFR-010: OAuth state replay, concurrent claim, context-mismatch, reconnect-account-binding, and reconnect-write revision-race tests are release blocking.
- NFR-011: Compatibility tests proving existing operational workspace-type values remain unchanged are release blocking for persistence work.
- NFR-012: Migration-readback-before-rollout and rollback-owner-isolation tests are release blocking.
- NFR-013: Registered end-to-end flows MUST preserve plan and approval ordering before credential-dependent readiness.

## 8. Success criteria

- Admin and tenant callers use the same resolver contract.
- No production identifier hardcoding is detected by CI.
- Ambiguous high-risk requests never dispatch.
- Context switching invalidates all dependent state.
- Cross-tenant candidates never enter the execution set.
- Unknown outcomes are reconciled without duplicate writes.
- All public endpoints are documented in OpenAPI 3.1.
- Personal connections are never shared across users implicitly.
- Brand connections never cross brand or workspace boundaries.
- Invalid more-specific connections do not silently widen consequential writes.
- Google login and provider consent remain distinct observable readiness states.
- Existing operational workspace classifications remain intact while personal/company ownership is represented separately.
- Credential-dependent readiness can execute without exposing credentials before the exact-owner, plan, authority, and approval gates pass.
- Reconnect cannot attach a different provider account or overwrite a newer connection revision silently.
- Concurrent callbacks cannot consume the same authorization state more than once.
- Reconnect credential replacement and state consumption either commit together or remain unapplied.
- Unresolved decisions never fabricate selected owner-scope evidence.
- Shadow/read/write rollout does not begin before governed migration readback succeeds.
- Rollback never restores an owner-unsafe selector.

## 9. Normative extension

The detailed ownership hierarchy, fallback policy, OAuth state contract, API direction, compatibility strategy, acceptance scenarios, and multi-PR implementation sequence are defined in `hierarchical-connection-ownership.md` and are normative for future connection-related implementation work under this Spec Kit.