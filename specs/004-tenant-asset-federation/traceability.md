# Traceability

| Requirement | Specification | Planned implementation evidence |
|---|---|---|
| Assets are shared by default | `spec.md` 2.1, FR-001–FR-002 | catalog projection and no-copy tests |
| User may create a customized version | `spec.md` 2.2, FR-003–FR-005 | explicit variant create/publish/reset tests |
| No copy for ordinary use or grant | `data-model.md` principles and migration philosophy | row-count and mutation regression tests |
| Tenant/workspace/brand/activity/role/user layers | `spec.md` context layers | container projection and path tests |
| User selects union/intersection behavior | `policy-composition-model.md` | profile selection and impact preview tests |
| Modes apply per dimension, not globally | `spec.md` FR-007–FR-009 | operator-allowlist tests |
| Denies and mandatory safety cannot be weakened | policy algebra and permissions matrix | mandatory-floor and escalation tests |
| User preferences customize their experience | `personalization-adaptation-model.md` | own-profile CRUD/history/reset tests |
| Preferences never grant authority | `permissions-matrix.md` | unauthorized candidate ranking tests |
| Variants can be user/role/workspace/brand/activity/tenant scoped | variant model | scope isolation and precedence tests |
| Shared base remains immutable | variant and permissions models | platform-base mutation denial tests |
| Tenant/user supplies credentials | `credential-installation-model.md` | opaque connection binding and no-secret tests |
| Catalog is separate from operational readiness | current state and credential model | readiness state tests |
| Pending connectors are classified rather than blindly activated | credential model and plan | connector cleanup report/readback |
| Approval-sensitive grant differs from pending request | permissions matrix | awareness field and open-hold tests |
| Runtime result is deterministic and explainable | `resolution-algorithm.md` | repeated checksum and explanation tests |
| Existing authorities remain until parity | current state, plan, rollout | shadow comparison and feature-flag tests |
| Dynamic Container Authority is reused | current state and data model | projection/closure/epoch evidence |
| Platform adapts from usage and outcomes | `growth-learning-loop.md` | proposal creation and attribution tests |
| Adaptation never silently changes authority | spec FR-019–FR-023 | Class E self-approval denial tests |
| Changes are simulated before canary | growth loop and rollout | simulation run and guardrail tests |
| Experiments are reversible | growth loop and rollout | automatic rollback tests |
| Tenant-local improvements may inform platform growth safely | promotion candidate model | privacy review and admin promotion tests |
| Cross-tenant learning/content reuse is controlled | personalization privacy section | anonymization/aggregation governance tests |
| User may inspect, dismiss, opt out, reset | personalization transparency | API and UI acceptance tests |
| APIs are OpenAPI 3.1 and resource-oriented | `api-contracts.md` | OpenAPI route coverage and contract tests |
| Architecture boundaries remain clear | `plan.md` architecture boundaries | architecture drift tests |
| Current branch is repaired before replacement | `plan.md` delivery principle | reconciliation, no-force mutation, ancestry readback |
| No provider writes during design/preview/simulation | README, credential model, growth loop | provider-call and credential-read flags remain false |

| Organizational user, group, service, and agent identities are authoritative | `additional-dimensions-gap-analysis.md` 4; `spec.md` FR-031–FR-032 | principal/group/delegation and separation-of-duties tests |
| Tenant partner/managed-client/white-label relationships stay explicit | gap analysis 5; `spec.md` FR-033–FR-034 | federation and cross-tenant delegation tests |
| Tenant offboarding/export/legal hold/erasure are governed workflows | gap analysis 5–6 | lifecycle, disposition, export, and erasure readback tests |
| Data purpose, consent, sensitivity, retention, residency, and jurisdiction constrain use | gap analysis 6, 12 | prohibited-purpose, residency, hold, and deletion-propagation tests |
| Commercial availability is distinct from authority/readiness | gap analysis 7; `spec.md` FR-037–FR-039 | entitlement, reservation, settlement, and concurrent budget tests |
| Model routing is contextual and evaluation-gated | gap analysis 8; `spec.md` FR-040–FR-042 | policy, fallback, quality, cost, locale, and residency model-selection tests |
| External effects are idempotent, cancellable, and compensatable | gap analysis 9; `spec.md` FR-043–FR-045 | outbox/inbox, duplicate delivery, cancel, saga, and dead-letter tests |
| Artifacts and knowledge are fully attributable and governable | gap analysis 10; `spec.md` FR-046–FR-047 | checksum, provenance, correction, retraction, and disposition tests |
| Temporal/environment/region semantics are first-class | gap analysis 11–12; `spec.md` FR-048–FR-050 | as-of replay, future preview, environment isolation, and regional routing tests |
| Packages and plugins carry supply-chain trust evidence | gap analysis 13; `spec.md` FR-051–FR-052 | signature, SBOM, vulnerability, license, permission, update, and revocation tests |
| Contracts evolve compatibly | gap analysis 14; `spec.md` FR-053 | client negotiation, deprecation, variant rebase, and historical manifest tests |
| Tenants and users can export/exit without secret leakage | gap analysis 15; `spec.md` FR-054 | portable manifest, import conflict, revocation, legal-hold, and deletion-certificate tests |
| New authorities participate in backup/restore and degraded modes | gap analysis 16; `spec.md` FR-055 | RPO/RTO, restore isolation, epoch, cache, and reconstruction tests |
| Human operations have capacity, escalation, and separation-of-duties controls | gap analysis 17; `spec.md` FR-056 | queue, availability, fallback, SLA, support-access, and escalation tests |
| Intent resolves through capability ontology to substitutable implementations | gap analysis 18; `spec.md` FR-057 | equivalence, compatibility, deprecation, and ranking tests |
| Localization and accessibility affect presentation and eligibility without changing IDs | gap analysis 19 | locale, RTL, translation, model-language, and jurisdiction tests |
| Quality, fairness, drift, and cross-tenant learning are governed | gap analysis 20–21; `spec.md` FR-058–FR-060 | golden evaluation, exposure, drift, cohort, opt-out, and privacy tests |

| Business Types define reusable versioned Layer Blueprints | `dynamic-layer-inheritance-model.md`; `spec.md` FR-061–FR-063 | Blueprint registry, relationship, closure, and validation tests |
| Brands selectively inherit from primary/secondary Business Types | inheritance model 8–10; FR-064–FR-065 | binding/profile preview, apply, priority, and effective-date tests |
| Inheritance creates Brand-scoped instances without shared-asset copies | inheritance model 2, 11–12; FR-066–FR-068 | row-count, source-pointer, Agent/profile, member-account, and no-copy tests |
| Departments are under Brands and Groups are under Departments | `principal-authority-decision.md`; FR-067 | Brand/Department/Group scope and hierarchy tests |
| Roles, members, and AI Agents use the same generic inheritance/provenance framework | inheritance model 13; FR-068 | profile assignment, authority ceiling, model/knowledge/cost/evaluation tests |
| Multiple Business Types compose per layer family | inheritance model 14; FR-069 | union/intersection/deny/equivalence/priority/conflict tests |
| Layer and Blueprint graphs are bounded and deterministic | inheritance model 5–6, 11; FR-070 | cycle, depth, path, closure, checksum, and rebuild tests |
| Every inherited result preserves provenance and settings versions | inheritance model 17–18; FR-071, FR-074–FR-075 | manifest/provenance/explanation/version-vector tests |
| Blueprint upgrades are previewed, classified, and reversible | inheritance model 16; FR-072 | auto-safe/review/conflict/pin/revoke/rebase/rollback tests |
| Removing inheritance requires complete disposition | inheritance model 19; FR-073 | orphan member/agent/grant/schedule/approval/variant/artifact tests |
| Specialized tables remain canonical while generic registries connect them | inheritance model 4, 20; FR-062 | architecture-boundary and source-authority tests |

| Global human identity is reused across personal and company Tenants | `member-invitation-onboarding-model.md` 2, 5; `spec.md` FR-076, FR-079, FR-083 | Google-link, existing-user, duplicate-user, and multi-membership tests |
| Scoped invitation joins an existing Tenant without creating another Tenant | invitation model 1, 3–5; FR-077–FR-078 | new-user invite, no-Tenant-creation, and transactional acceptance tests |
| Invitation access is exact rather than a broad membership default | invitation model 3, 8–9; FR-077, FR-081–FR-082 | Brand/Workspace/Department/Group/Role grant and no-broad-default tests |
| Invitation delivery and token handling are single-use and no-secret | invitation model 4, 10–11; FR-080 | hash storage, outbox, expiry, revoke, replay, and log-redaction tests |
| Personal account/workspace is optional and isolated | invitation model 6; FR-078, FR-084 | explicit creation, prompt/decline, isolation, export/copy-policy tests |
| Multi-Tenant users select a validated active context | invitation model 7; FR-085 | context list/switch/revoke/expiry/epoch and mixed-data prevention tests |
| Accepting an invitation preserves unrelated memberships and stronger authority | invitation model 5; FR-081, FR-083 | idempotency, no-downgrade, conflict, and unrelated-context tests |

| Every verified user may explicitly create a Tenant while retaining other memberships | `tenant-workspace-boundary-decision.md` 3, 8–10; `spec.md` FR-086–FR-087, FR-095–FR-096, FR-099–FR-100 | creation capability, provisioning, ownership, plan-limit, and membership-preservation tests |
| Tenant is the ownership, isolation, billing, governance, and lifecycle boundary | boundary decision 1, 4, 14–18; FR-088, FR-095–FR-100 | owner-assignment, federation, billing, export/offboarding, and isolation tests |
| Workspace is a Tenant-owned operational context, not a mini-Tenant | boundary decision 1–2, 5–7; FR-089–FR-091 | one-owner-Tenant, access-chain, binding-not-grant, and no-independent-billing tests |
| Workspace binds to Brands, Departments, Groups, Activities, Roles, Agents, and resources | boundary decision 6–7; FR-090–FR-091 | same-Tenant binding, exact grant, role ceiling, and resource eligibility tests |
| Personal Tenant/Workspace is optional and isolated | boundary decision 5, 11; FR-092, FR-099 | explicit creation, personal/company isolation, copy/export policy, and context tests |
| Multi-Brand Workspace is opt-in and same-Tenant only | boundary decision 13; FR-093–FR-094 | disabled-default, same-Tenant validation, policy conflict, provenance, and cross-Tenant rejection tests |
| Workspace and Tenant lifecycles remain separate | boundary decision 14; FR-097–FR-098 | Workspace disposition, Brand preservation, Tenant offboarding, and dependent-resource tests |

| Access authority alone does not authorize data processing | `data-governance-decision.md` 1–2; `spec.md` FR-101, FR-115 | access-plus-purpose eligibility and fail-closed decision tests |
| Classification is sensitivity plus category attributes | governance decision 3; FR-102 | assignment, non-downgrade, secret/credential, and regulated-category tests |
| Every consequential use declares a registered purpose | governance decision 4; FR-103 | missing, disallowed, audience, sink, and purpose-drift tests |
| Lawful basis and consent are purpose-bound and revocable | governance decision 5; FR-104 | consent grant/version/withdrawal, lawful-basis, and invalidation tests |
| Residency and transfer constrain every destination | governance decision 6; FR-105 | storage, processing, model, provider, backup, export, and cross-border tests |
| Retention and legal hold are independently governed | governance decision 7; FR-106–FR-107 | expiry, hold scope, no-read-authority, release, and disposition tests |
| Privacy requests discover primary and derived data | governance decision 8–9; FR-108–FR-110 | access/export/correction/restriction/erasure/objection and item-readback tests |
| Derived objects preserve lineage and explicit disposition | governance decision 9; FR-109–FR-110 | summary, embedding, index, Agent-memory, evaluation, artifact, provider-copy, and backup propagation tests |
| Model/provider data use is separately eligible | governance decision 10; FR-111–FR-112 | region, retention, training, subprocessors, deletion, contract, zero-retention, and fallback tests |
| Raw cross-Tenant learning is forbidden | governance decision 11; FR-113 | raw-content rejection, cohort, dominance, opt-out, residency, re-identification, and fairness tests |
| Manifest binds immutable data-use decision and governance versions | governance decision 12, 15; FR-114–FR-115 | decision checksum, explanation, expiry, epoch invalidation, and pre-dispatch revalidation tests |
| Commercial semantics are database-authoritative | `commercial-finops-decision.md` 2; FR-116–FR-117 | registry version, unknown key, compatibility, activation, and no-hardcoded-customer-rule tests |
| Credits and money are distinct billing assets | commercial decision 3, 12; FR-117–FR-119 | credits, prepaid, postpaid, conversion-contract, FX, and asset-mismatch tests |
| Users customize only template-exposed billing fields | commercial decision 4; FR-120–FR-121 | eligible option, allowlist, lower-limit, non-customizable field, conflict, and epoch tests |
| One direct billable owner resolves per operation | commercial decision 5; FR-122 | direct contract, non-transitivity, missing/ambiguous owner, and attribution-no-liability tests |
| Metering is multi-dimensional and tokens are one family | commercial decision 6–7; FR-123–FR-127 | operation/time/data/storage/compute/modality/seat/concurrency/channel/business/outcome tests |
| Technical and billable usage remain explainable | commercial decision 6.4–6.5, 7; FR-126–FR-127 | raw event, composite component, correction, dedupe, late-event, and provenance tests |
| Rating is separate from measurement and settlement | commercial decision 8–10; FR-128–FR-130 | included units, tiers, packages, commitments, tax/discount, provider-cost versus customer-charge tests |
| Reservation is atomic and precedes cost-bearing dispatch | commercial decision 11; FR-131–FR-133 | idempotency conflict, concurrent balance/quota, expiry, extension, stop-boundary, and epoch tests |
| Settlement requires verified evidence and authorized bounds | commercial decision 13; FR-134–FR-135 | usage/outcome verification, overage, release, partial charge, zero charge, and absorbed-cost tests |
| Ledger is append-only and double-entry balanced | commercial decision 14–15; FR-136 | balanced posting, immutable history, compensating refund/adjustment/dispute/chargeback, and rebuild tests |
| Standing and manifest linkage are explicit | commercial decision 16–17; FR-137–FR-140 | grace/past-due/paused/cancelled, manifest contribution, commercial epoch, and stable-error tests |

| Selection begins from task/capability contract | `model-governance-decision.md` 1, 4; FR-141–FR-143 | registered-task, capability-profile, unregistered-task, exact-candidate, and contract-mismatch tests |
| Deterministic model gates precede ranking | model decision 5; FR-143–FR-145 | data/region/risk/tool/output/evaluation/readiness/entitlement/lifecycle/commercial exclusion tests |
| Ranking is evidence-based and explainable | model decision 6; FR-146–FR-147 | metric source/version/freshness/confidence/weight, tie-break, and opaque-score rejection tests |
| User model preference is bounded | model decision 7; FR-148–FR-149 | eligible preference, raw-ID rejection, floor protection, lower cost/latency, local-only, and fallback-disable tests |
| Evaluation is contextual and governed | model decision 8–9; FR-150–FR-154 | dataset provenance, deterministic validator, human/model-judge, threshold, zero-tolerance, freshness, scorecard, and drift tests |
| Readiness is independent from quality | model decision 10; FR-155–FR-156 | credential-presence, endpoint/region, capacity, circuit-breaker, incident, stale/unknown, and freshness tests |
| Fallback is independently eligible | model decision 11–12; FR-157–FR-160 | same-gate, certified-equivalence, high-risk-disabled, candidate-specific estimate/reservation, and exhaustion tests |
| Lifecycle supports deprecation and revocation | model decision 13; FR-161–FR-162 | impact-preview, replacement, deadline, shadow/canary, rollback, restriction, revoke, alias movement, and epoch tests |
| Selection decision and manifest are immutable | model decision 15; FR-163–FR-164 | candidate-universe, exact version, policy/evaluation/readiness, fallback, commercial refs, checksum, expiry, and pre-dispatch tests |
| Current routing remains a compatibility bridge | model decision 2, 20; FR-165 | provider-order/free-first shadow parity, task/risk-family cutover, rollback, and hardcoded-list removal gate tests |
| Model-selection preview has no effect | model decision 16; FR-166–FR-167 | no provider/model call, credential read, evaluation execution, reservation, lifecycle mutation, or external write tests |

| Durable Workflow history is authoritative | `durable-workflow-effect-commit-decision.md` 1, 5; FR-168–FR-175 | ordered history, replay determinism, snapshot rebuild, schema/version, and nondeterminism-block tests |
| Dynamic registries define bounded semantics | durable decision 2; FR-170–FR-171 | registry versioning, unsupported handler, arbitrary code/URL/header/secret injection, and compatibility tests |
| Workflow/Activity/Effect are separated | durable decision 3; FR-169, FR-176 | decision-only replay, at-least-once Activity, stable Effect identity, and state-dimension tests |
| Scoped idempotency prevents duplicate logical work | durable decision 8; FR-179–FR-180 | same-key same-payload, changed-payload conflict, provider-key stability, and retention-window tests |
| Effect commit protocol controls uncertainty | durable decision 9, 17; FR-181–FR-184, FR-194 | commit-boundary, verification, timeout-after-dispatch, reconcile-before-retry, confirmed/no-effect/unknown tests |
| Leases and fencing prevent stale writes | durable decision 7; FR-177–FR-178 | lease expiry, heartbeat, owner reassignment, stale token commit, and duplicate Worker tests |
| Retry is policy and Effect aware | durable decision 10; FR-183–FR-185 | error classification, full jitter, Retry-After, deadline, budget, circuit breaker, quota/reservation, and manual-only tests |
| Timers/signals/dependencies are durable | durable decision 11; FR-186 | restart survival, duplicate signal, stale schema, approval expiry, dependency quorum, and missed timer tests |
| Cancellation exposes committed Effects | durable decision 12; FR-187 | before-dispatch, cooperative boundary, compensate, too-late, child propagation, and irreversible-effect tests |
| Outbox/Inbox ensures transport durability | durable decision 13; FR-188–FR-189 | atomic append/outbox, duplicate delivery, checksum conflict, consumer transaction, dead-letter separation, and redrive tests |
| Concurrency and fairness are governed | durable decision 14; FR-190 | Tenant/resource/provider limits, priority aging, recovery capacity, starvation, admission, and backpressure tests |
| Sagas compensate rather than rewrite | durable decision 15; FR-191–FR-193 | dependency order, committed-effect selection, idempotent compensation, compensation failure, and partial-success tests |
| Recovery differs from transport dead letter | durable decision 16; FR-189, FR-193–FR-194 | retry exhausted, outcome unknown, compensation failed, owner/SLA, manual action, and message DLQ tests |
| Replay/resume use verified checkpoints | durable decision 18; FR-195–FR-196 | preview no-effect, checkpoint validity, new identity, current manifest/policy, known Effects, and immutable source history tests |
| Model fallback respects committed Effects | durable decision 19; FR-197–FR-198 | before-output fallback, visible stream, Tool Effect, remaining work, new reservation, and superseding artifact tests |
| Existing runtime remains compatibility authority until cutover | durable decision 20, 25; FR-199 | jobs/plans/outboxes shadow parity, family canary, rollback, and historical reconstruction tests |
| Missing runtime evidence fails closed | durable decision 22–23; FR-200 | stale/ambiguous registry, lease, Effect Contract, verification, recovery, manifest, and commercial evidence tests |

| Stable Artifact identity and immutable versions | `artifact-knowledge-provenance-decision.md` 2; FR-201–FR-203 | logical/version identity, canonical/stored checksums, representation equivalence, immutable correction, and mutable-location rejection tests |
| Source authenticity and integrity remain distinct | provenance decision 3; FR-204–FR-206 | source identity, signature/key revocation, checksum, transparency sequence/root/witness, expiry, and no-secret tests |
| Claim-level epistemic graph preserves disagreement | provenance decision 4; FR-207–FR-208 | claim type/location/checksum, support, contradiction, qualification, supersession, context, and score-non-override tests |
| Citations target immutable evidence | provenance decision 5; FR-209–FR-210 | page/range/JSON Pointer/row/timestamp/chunk/commit locators, floating source, checksum, license, and disclosure tests |
| Trust is multi-dimensional and gate-first | provenance decision 6; FR-211–FR-212 | mandatory dimension, threshold, confidence, freshness, human review, corroboration, missing evidence, and composite-score tests |
| Knowledge builds are reproducible | provenance decision 7; FR-213–FR-214 | ordered source set, handler/model/prompt/parameter/environment, seeds, canonicalization, reproduction classification, and difference tests |
| Artifact versions carry conservative policy | provenance decision 8; FR-215–FR-217 | classification, purpose, audience, license, model use, residency, retention, legal hold, inheritance, declassification, and separation tests |
| Provenance supports selective disclosure | provenance decision 9; FR-218 | public/Tenant/operator/auditor/legal projections, opaque evidence, redaction, contradiction floor, and cross-Tenant leakage tests |
| Knowledge objects are exact-version artifacts | provenance decision 10; FR-219–FR-221 | source/chunk/embedding/index identity, profile/model alias capture, membership, checksums, policy, freshness, and invalidation tests |
| Retrieval is evidence-bearing and gate-first | provenance decision 11; FR-222–FR-224 | query/context/purpose, candidates/exclusions, chunks/scores/reranking, claims/citations, unsupported claim, and rank-bypass tests |
| Correction and retraction preserve history | provenance decision 12; FR-225–FR-226 | new version, corrects/supersedes, impact graph, new-use block, cache/index/manifest invalidation, and notification tests |
| Erasure/disposition propagates under DFR-003 | provenance decision 13; FR-227–FR-228 | delete/rebuild/invalidate/retract/anonymize/aggregate/archive/hold/tombstone propagation and legal-hold tests |
| Eligibility and manifest bind exact evidence | provenance decision 16–17; FR-229–FR-231 | resolver gates, exact versions/checksums, attestations, trust/policy/freshness, retraction, epoch, expiry, and pre-use revalidation tests |
| Registry semantics are bounded and allowlisted | provenance decision 14; FR-232 | schema/canonicalizer/verification/handler/signing/storage/model/policy allowlist and arbitrary code/URL/header/secret rejection tests |
| Current artifact stores remain compatibility inputs | provenance decision 22; FR-233–FR-234 | output/JSON/Drive/graph/memory projection, incomplete provenance, no invented evidence, shadow parity, and family cutover tests |
| Missing provenance evidence fails closed | provenance decision 19–20; FR-235 | missing/stale/conflicting/revoked/unsupported/ambiguous source, claim, citation, attestation, trust, policy, index, retrieval, and epoch tests |

## Source-to-target traceability

| Existing authority | Target role |
|---|---|
| Shared asset tables | canonical asset content |
| `execution_policies` | legacy enforcement and policy atom bridge |
| platform policy registry/rules | target policy definitions and semantics bridge |
| specialized grants/bindings | legacy authorization bridge |
| Dynamic Container Authority | context topology, roles, bindings, epochs, base resolution |
| package variants | reusable patch/version concepts |
| user/dashboard preferences | bridge inputs to the unified user profile |
| recommendation/intent/execution telemetry | adaptive evidence |
| connections/installations/certifications | operational readiness |
| approval holds and capability envelopes | consequential-operation governance |

## Design decision traceability

| Decision | Reason |
|---|---|
| Shared assets remain canonical | avoids duplication, drift, and upgrade fan-out |
| Variants are explicit and sparse | customization without mandatory copies |
| Composition is field-typed | prevents unsafe arbitrary JSON merge |
| Preference follows authority | personalization cannot escalate access |
| Effective manifest is immutable | execution and outcome attribution remain reconstructable |
| Adaptation is proposal-driven | platform can learn without silent self-modification |
| Cutover is family-by-family | preserves rollback and exposes parity gaps |
