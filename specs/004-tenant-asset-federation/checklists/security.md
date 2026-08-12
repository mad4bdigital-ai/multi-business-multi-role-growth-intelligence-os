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

## Dynamic Commercial and FinOps security

- [x] Billing models, collection modes, units, meters, rating models, profile templates, customization fields, and state transitions resolve from versioned registries.
- [x] Runtime rejects unregistered keys, arbitrary SQL/JavaScript/shell formulas, unsupported combinations, stale versions, and ambiguous profile resolution.
- [x] User customization is field-allowlisted and cannot change prices, tax, FX, ledger accounts, billable owner, credit limit, posted entries, or protected contract fields.
- [x] Credits, money, and usage units are separate assets and cannot be cross-settled without an approved conversion contract and current quote.
- [x] Billing owner resolution is direct and non-transitive; ownership, management, support, white-label, and attribution do not imply billing liability.
- [x] Meter events require authorized source, exact Tenant/account/operation/manifest scope, registered meter/version/unit, scaled quantity, dedupe key, and evidence checksum.
- [x] Composite meters use registered typed operators and preserve raw component events.
- [x] Outcome-based meters require verification, attribution window, deduplication, dispute, and anti-fraud evidence before billability.
- [x] Atomic reservation prevents concurrent double-spend of balance, included units, quota, budget, or postpaid liability capacity.
- [x] Reservation idempotency conflicts block when one key is reused with different input.
- [x] Streaming reservation extensions are bounded and denied extension triggers safe-stop behavior.
- [x] Customer charge is capped by authorization; provider/internal cost drift cannot silently increase customer liability.
- [x] Settlement requires verified usage/outcome, reservation, price/rating, manifest, owner, and commercial-epoch evidence.
- [x] Posted ledger entries are immutable, balanced, no-secret, and corrected only with compensating entries.
- [x] Refund, adjustment, dispute, and chargeback cannot exceed net settled liability and require exact source transaction and reason authority.
- [x] Past-due/grace/paused/cancelled policy cannot erase evidence, expose payment credentials, or bypass legally required export.
- [x] Billing-profile, entitlement, estimate, and reservation previews perform no charge, reservation, invoice, payment, provider call, credential read, or external write.
- [ ] Initial registry seed, price-book, tax, FX, overage, and standing policies receive accounting/security review.
- [ ] Ledger chart, posting engine, period close, refund/dispute, and reconciliation receive accounting/security review.
- [ ] Meter source trust, outcome fraud, replay, late-event, and double-spend tests pass before implementation.

## Contextual Model Governance security

- [x] Task classes, capabilities, provider endpoints, model versions, inference profiles, context policies, optimization profiles, evaluation suites, scorecards, readiness, fallback, incidents, and lifecycle resolve from versioned authorities.
- [x] Runtime rejects unregistered task classes, raw model IDs/endpoints, arbitrary formulas, unsupported combinations, stale versions, and ambiguous selection.
- [x] Database rows can select only allowlisted provider adapter keys and cannot introduce arbitrary URLs, headers, SQL, JavaScript, shell, executable model code, or secrets.
- [x] Hard eligibility gates execute before ranking and cannot be bypassed by score, preference, provider order, cost, latency, or availability.
- [x] Model preference is field-allowlisted and cannot lower data, region, safety, quality, tool, output, evaluation, readiness, lifecycle, or commercial floors.
- [x] Exact candidate identity pins endpoint/deployment, model version or alias snapshot, inference profile, region, data-processing profile, and commercial profile.
- [x] Evaluation datasets/results are provenance-linked, access-controlled, residency/retention constrained, and do not expose another Tenant's private content.
- [x] Model-judge evidence is separated from deterministic and human evidence and cannot solely certify high-risk tasks.
- [x] Scorecard freshness, confidence, sample coverage, zero-tolerance failures, and drift are enforced by task/risk policy.
- [x] Readiness snapshots expose no credential values and distinguish ready, degraded, not-ready, unknown, and stale.
- [x] Fallback candidates independently pass all hard gates and cannot be inferred from a global provider list.
- [x] Authority-sensitive fallback requires certified equivalence and is disabled by default.
- [x] Candidate-specific estimate/reservation prevents cross-candidate cost authorization reuse.
- [x] Pre-dispatch revalidation blocks revoked, restricted, deprecated, stale-evaluation, unready, region-ineligible, or epoch-stale candidates.
- [x] Restriction/revocation and material alias movement invalidate affected decisions/manifests without deleting historical evidence.
- [x] Selection decisions and manifests are immutable, expiring, explainable, checksummed, and no-secret.
- [x] Selection preview performs no provider/model call, credential read, evaluation execution, reservation, lifecycle mutation, or external write.
- [ ] Initial registry seeds, evaluation suites, readiness sources, optimization metrics, and fallback equivalence receive security/data/accounting review.
- [ ] Prompt injection, evaluation poisoning, benchmark leakage, readiness spoofing, preference escalation, fallback downgrade, and adapter injection tests pass before implementation.
- [ ] Emergency revocation, cache invalidation, stale manifest, and historical reconstruction exercises pass before enforcement.

## Deterministic Durable Workflow security

- [x] Workflow/Activity/Effect definitions, handlers, states, transitions, events, timers, signals, retries, cancellation, compensation, reconciliation, replay, recovery, concurrency, fairness, and dead-letter reasons resolve from versioned typed authorities.
- [x] Registry publication rejects arbitrary SQL, JavaScript, shell, URLs, headers, executable payloads, model code, provider code, and secret-like values.
- [x] Handler keys resolve only to allowlisted certified code/build digests with compatible semantic versions.
- [x] Workflow history is append-only, ordered, checksummed, causally linked, and replayed under the exact compatible definition version.
- [x] Determinism mismatches block and create recovery evidence rather than silently mutating state.
- [x] Activity commits require a live lease and current monotonic fencing token.
- [x] Scoped idempotency includes Tenant/account, type, target, key, and request checksum; changed-payload reuse blocks.
- [x] Provider idempotency and logical Effect IDs remain stable across retries and recovery.
- [x] Effect commit boundary, verification, reconciliation, and compensation evidence are explicit and immutable.
- [x] Timeout or transport failure after dispatch cannot trigger blind retry for an uncertain external Effect.
- [x] Retry policies respect deadlines, reservation/quota budgets, circuit breakers, `Retry-After`, and maximum attempts/elapsed time.
- [x] Timers/signals/callbacks are typed, idempotent, scoped, expiring, and durable across restarts.
- [x] Cancellation cannot erase or hide committed/human-visible/irreversible Effects.
- [x] Transactional Outbox/Inbox prevents lost local events and duplicate consumer Effects.
- [x] Transport dead letters contain no secrets and are not confused with business recovery.
- [x] Recovery actions, replay, resume, redrive, reconciliation, and manual intervention require exact object authority, bounded action types, approvals where required, audit, and readback.
- [x] Child Workflows cannot broaden parent authority, data/model/commercial scope, deadline, risk, or credential access.
- [x] Model fallback cannot repeat committed visible output, Tool calls, or external Effects.
- [x] Preview endpoints perform zero Activity execution, provider/model/tool call, credential read, queue publish, reservation, compensation, replay, or external write.
- [ ] Initial handler allowlist, Effect Contracts, retry/reconciliation/compensation policies, and recovery actions receive security/data/commercial review.
- [ ] Stale lease, replay poisoning, history tampering, signal spoofing, callback replay, outbox duplication, reconciliation forgery, compensation abuse, queue starvation, and registry injection tests pass before implementation.
- [ ] Disaster restart, timer recovery, exact replay, recovery ownership, and emergency disable/rollback exercises pass before enforcement.

## Verifiable Artifact and Knowledge security

- [x] Artifact identity, version, content object, representation, source, attestation, provenance, claim, citation, trust, policy, reproducibility, knowledge build, retrieval, and lifecycle authorities are typed and versioned.
- [x] Content integrity, signer authenticity, factual support, policy eligibility, license, freshness, and publication approval cannot be conflated.
- [x] Canonical and stored checksums are validated independently and unknown canonicalization profiles fail closed.
- [x] Source/signing identities bind registered trust domains, scoped authority, algorithm/key references, expiry/revocation, and no raw signing secrets.
- [x] Critical transparency entries are append-only, hash-linked, root-verified, and witnessable; fork/missing-proof conditions are explicit.
- [x] Provenance edge types constrain source/target versions and prevent prohibited derivation cycles.
- [x] Claim support, contradiction, qualification, context, reviewer, and evidence remain visible and cannot be hidden by a trust score.
- [x] Citation locators validate exact immutable source versions and audience/license/disclosure constraints.
- [x] Trust policies enforce mandatory dimensions, thresholds, confidence, freshness, corroboration, and zero-tolerance failures before ranking.
- [x] Policy inheritance applies the most restrictive source/destination controls and declassification requires registered transformation, authority, verification, and approval.
- [x] Selective disclosure cannot expose private source content/identity or fabricate a complete lineage when evidence is omitted.
- [x] Reproducibility manifests bind exact sources, handlers/builds, models, prompts/templates, parameters, environment, and nondeterministic inputs.
- [x] Knowledge chunks/embeddings/indexes/retrievals bind exact source/build/model versions and reject mutable alias substitution.
- [x] Correction, retraction, and disposition preserve immutable history and invalidate affected descendants, caches, indexes, manifests, and promotion candidates.
- [x] Retraction cannot masquerade as erasure; Legal Hold grants no read authority; minimal tombstones contain no erased content.
- [x] Registry publication rejects arbitrary code, SQL, JavaScript, shell, URLs, headers, signing keys, provider payloads, and secret-like values.
- [x] Artifact/knowledge preview endpoints are no-effect and cannot sign, transform, publish, correct, retract, delete, index, call models/providers, read credentials, invalidate, notify, or write externally.
- [ ] Signature/key compromise, revoked attestation, transparency fork, checksum substitution, provenance cycle, citation drift, trust-score bypass, policy laundering, selective-disclosure leak, poisoned index, stale alias, and retraction-race tests pass.
- [ ] Cross-Tenant artifact/version/claim/citation/provenance/index/retrieval/disposition access and inference tests pass.
- [ ] Disaster rebuild, transparency-root recovery, index rebuild, correction/retraction propagation, erasure/legal-hold, and rollback exercises pass before enforcement.

## API and implementation

- [x] All external input is validated.
- [x] Object-level authorization is required on every tenant resource.
- [x] Stable structured errors do not expose internals or secrets.
- [x] Cursor pagination and bounded limits protect high-cardinality surfaces.
- [x] Domain policy algebra is independent from transport and provider adapters.
- [ ] Threat model reviewed before implementation.
- [ ] Abuse-case tests and security review completed.
- [ ] Migration and rollback security review completed.
