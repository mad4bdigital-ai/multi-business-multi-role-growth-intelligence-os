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
