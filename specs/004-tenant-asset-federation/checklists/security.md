# Security Checklist

## Identity and isolation

- [x] Signed principal is the tenant/user authority.
- [x] Client-supplied tenant override is forbidden.
- [x] Every tenant-owned profile, variant, proposal, experiment, and connection binding carries tenant scope.
- [x] Cross-tenant asset-variant, profile, connection, or experiment references are rejected.
- [x] Support/admin actions receive no implicit tenant bypass.

## Policy and authority

- [x] Preferences cannot grant authority.
- [x] Union cannot bypass denies or mandatory requirements.
- [x] Intersection fails closed on missing required layers.
- [x] Mandatory policy fields are non-modifiable.
- [x] Risk takes the strongest value and ceilings take the most restrictive value.
- [x] Equal-ranked non-mergeable conflicts block.
- [x] Delegation cannot exceed delegator authority.
- [x] Wildcard write delegation is forbidden.
- [x] Existing grants and policies remain authoritative until certified cutover.

## Variants

- [x] Variants are explicit and sparse.
- [x] Patch paths are allowlisted and schema validated.
- [x] Authority, credential, audit, approval, and certification fields cannot be patched.
- [x] Stale/revoked base versions can block variants.
- [x] Variant conflicts never silently overwrite.
- [x] Variant publish and upgrade mutations are versioned, idempotent, and read back.

## Credentials and providers

- [x] Raw credentials are forbidden in assets, profiles, variants, proposals, experiments, manifests, logs, and responses.
- [x] Secret-like keys are rejected at boundaries.
- [x] Authorization resolves before credential materialization or provider client creation.
- [x] Catalog, preview, simulation, and shadow perform no provider writes.
- [x] Connection selection is exact, tenant-scoped, and ambiguity-blocking.
- [x] Revocation invalidates future manifests and canaries.

## Adaptive growth

- [x] Signals are evidence, not authority.
- [x] Every proposal has scope, objective, evidence, risk, expiry, rollback, and guardrails.
- [x] Class E changes cannot self-approve.
- [x] Experiments have immutable cohorts and baselines.
- [x] Safety regression triggers rollback.
- [x] Cross-tenant/platform promotion requires privacy review and separate release governance.
- [x] Dark patterns, approval avoidance, and risk under-reporting are forbidden.

## Runtime integrity

- [x] Effective manifests bind authority epoch, profile versions, base/variant checksums, and resolver version.
- [x] Epoch/version drift invalidates stale decisions.
- [x] Graph traversal and candidate counts are bounded.
- [x] Cache invalidation is event-driven with bounded TTL fallback.
- [x] No partial allow is returned after limit exhaustion or dependency failure.
- [x] Same-cycle readback is required for state-changing operations.

## Blueprint and inheritance security

- [x] Business-Type bindings grant Blueprint eligibility only and never execution authority.
- [x] Blueprint publication validates registered layer/relationship types, cardinality, hierarchy, compatibility, and cycles.
- [x] Brand inheritance apply validates tenant/Brand ownership, exact profile/version, approval, idempotency, and readback.
- [x] Inheritance creates only Brand-scoped organizational/profile/binding records and never copies credentials or canonical shared assets.
- [x] Member-profile Blueprints cannot auto-create human users or silently assign privileged roles.
- [x] AI-Agent-profile Blueprints cannot exceed Brand/Tenant authority, model, cost, knowledge, autonomy, or approval bounds.
- [x] Cross-Brand Departments, Groups, memberships, Agent assignments, and instance relationships are forbidden.
- [x] Cross-Department participation is explicit and disabled by default.
- [x] Blueprint/instance closure traversal is depth/path bounded and cycle-safe.
- [x] Equivalent or conflicting Blueprints require registered deterministic resolution; ambiguity blocks.
- [x] Local override patches cannot modify mandatory policy, authority, credential, audit, approval, certification, tenant, or environment fields.
- [x] Blueprint removal requires disposition of memberships, agents, grants, approvals, schedules, variants, artifacts, and dependencies.
- [x] Security revocation can invalidate an inherited unsafe asset/profile despite an ordinary version pin.
- [x] Blueprint provenance and inheritance versions are bound into authority/cache/manifest invalidation.
- [ ] Blueprint publisher trust and certification threat review completed.
- [ ] Multi-Business-Type conflict and equivalence abuse tests completed.
- [ ] Upgrade/rebase/removal disposition security review completed.

## Scoped invitation and identity security

- [x] Google ID token issuer, audience, nonce/state, verified email, and provider subject are validated.
- [x] Invitation email match is mandatory for first acceptance and account switching is offered on mismatch.
- [x] Invitation tokens are random, single-use, expiring, revocable, hash-stored, redacted, and delivered through an approved channel.
- [x] Invitation scope is immutable after delivery or requires a disclosed revision/new invitation.
- [x] Inviter authority and delegation ceiling are revalidated at acceptance time.
- [x] Acceptance is transactional, idempotent, and same-cycle read back.
- [x] Scoped invitations do not create broad default workspace grants.
- [x] Existing stronger authority is not silently downgraded.
- [x] Identity linking cannot merge accounts solely because emails resemble or aliases normalize unexpectedly.
- [x] Personal account/workspace is isolated and cannot expose or copy company resources implicitly.
- [x] Active contexts are short-lived, version/epoch bound, revocable, and cannot combine unrelated Tenant data.
- [x] Revoked membership invalidates active context without affecting unrelated contexts.
- [ ] Account-link collision and recovery threat review completed.
- [ ] Invitation delivery, replay, enumeration, phishing, and redirect threat review completed.
- [ ] Context-switch confusion and stale-context threat review completed.

## Tenant creation and Workspace boundary security

- [x] Tenant creation requires verified identity, plan/entitlement, region, policy, risk/fraud checks, idempotency, and readback.
- [x] Tenant ownership is explicit and versioned rather than inferred from membership order.
- [x] Creating or owning a Tenant grants no authority in any other Tenant.
- [x] Every Workspace has one immutable owning Tenant.
- [x] Workspace bindings are not authority grants and must reference resources inside the same Tenant.
- [x] Workspace access requires active Tenant membership plus exact organizational/resource authority.
- [x] Multi-Brand Workspaces remain same-Tenant and require explicit policy, grants, and conflict resolution.
- [x] Cross-Tenant Workspaces and bindings are forbidden.
- [x] Personal/company resources and credentials remain isolated.
- [x] Sandbox Workspaces cannot authorize production execution or credential use.
- [x] Workspace archive/deletion requires dependency disposition and cannot delete Tenant or Brand implicitly.
- [x] Tenant offboarding includes all Workspaces and active operational dependencies.
- [ ] Tenant-provisioning abuse, quota, fraud, and ownership-collision threat review completed.
- [ ] Workspace binding, context-confusion, and multi-Brand policy-bypass threat review completed.
- [ ] Personal/company resource-copy and deletion-disposition threat review completed.

## Extended plane security

- [x] Group nesting and delegation depth are bounded and cycle-safe.
- [x] Service and agent principals require tenant ownership, assurance, and accountable owners.
- [x] Partner/managed-client/white-label relationships do not grant implicit cross-tenant access.
- [x] Offboarding, export, legal hold, and erasure preserve exact authorization and evidence.
- [x] Data purpose, sensitivity, residency, and jurisdiction are evaluated before model/provider/indexing use.
- [x] Cost reservations are idempotent and concurrency-safe.
- [x] Model fallback cannot weaken privacy, region, safety, quality, or tool constraints.
- [x] External operations declare delivery, retry, cancellation, and compensation behavior.
- [x] Transactional outbox/inbox or equivalent deduplication prevents duplicate effects.
- [x] Artifact provenance cannot expose another tenant's private sources.
- [x] Preview/staging manifests cannot dispatch production operations.
- [x] Package publication/install requires trust, integrity, requested-capability, compatibility, and revocation evidence.
- [x] Tenant export/import excludes secrets and validates ownership and object references.
- [x] Restore validation covers tenant isolation, authority epochs, caches, and reconstructability.
- [x] High-risk human work preserves requester/approver/executor separation.
- [x] Evaluation and recommendation evidence is protected from manipulation and exposure feedback loops.
- [ ] Principal/group/service threat review completed.
- [ ] Data governance and residency threat review completed.
- [ ] Commercial reservation and settlement threat review completed.
- [ ] Model routing and evaluation threat review completed.
- [ ] Async/saga/outbox threat review completed.
- [ ] Supply-chain and portability threat review completed.

## Layered data-governance security

- [x] Access grants and data-use eligibility are evaluated independently and both are required.
- [x] Missing, stale, conflicting, revoked, or ambiguous classification, purpose, lawful-basis/consent, residency, retention, hold, provider/model, audience, or destination evidence fails closed.
- [x] Classification override cannot downgrade credentials, secrets, legal holds, or mandatory regulated categories.
- [x] Purpose is registered and material purpose drift cannot reuse an unrelated authorization.
- [x] Consent cannot authorize a use prohibited by Platform, law, security, contract, or Tenant policy.
- [x] Residency/transfer validation occurs before credential materialization, provider/model selection, indexing, export, or content transfer.
- [x] Legal hold grants no read authority and retention expiry cannot override an active hold.
- [x] Privacy-request and disposition workflows revalidate identity, object authority, holds, exemptions, provider copies, indexes, and backups.
- [x] Derived data is not presumed anonymous because it was transformed.
- [x] External provider/model fallback cannot weaken retention, training, deletion, region, contract, purpose, or zero-retention requirements.
- [x] Raw cross-Tenant learning is forbidden; aggregate learning requires minimum cohort, contribution/dominance, opt-out, residency, re-identification, provenance, quality, and fairness controls.
- [x] Data-governance epoch changes invalidate stale manifests before consequential dispatch.
- [x] Preview routes perform no provider call, content transfer, deletion, model execution, credential read, or external write.
- [ ] Jurisdiction policy packs and consent evidence schemas receive legal/security review before implementation.
- [ ] Provider processing-profile certification and refresh process receives security review.
- [ ] Aggregate-learning privacy and re-identification tests pass before any production use.

## API and implementation

- [x] All external input is validated.
- [x] Object-level authorization is required on every tenant resource.
- [x] Stable structured errors do not expose internals or secrets.
- [x] Cursor pagination and bounded limits protect high-cardinality surfaces.
- [x] Domain policy algebra is independent from transport and provider adapters.
- [ ] Threat model reviewed before implementation.
- [ ] Abuse-case tests and security review completed.
- [ ] Migration and rollback security review completed.
