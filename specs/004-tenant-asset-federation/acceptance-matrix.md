# Acceptance Matrix

| Scenario | Expected result |
|---|---|
| Tenant member views a shared agent or workflow | Canonical asset is visible without creating a tenant copy |
| Tenant grants use of a shared skill | Grant/binding changes; no variant or duplicated skill row is created |
| User selects an authorized shared workflow | Workflow is referenced directly and recorded in the runtime manifest |
| User explicitly customizes output ordering | A user-owned optional variant is created with a bounded patch |
| User resets a personal variant | Shared base becomes effective again; grants and credentials are unchanged |
| Platform updates a shared base with no patch conflict | Variant upgrade preview succeeds with deterministic checksum |
| Platform update conflicts with a variant patch | Variant enters conflict/review state; no silent overwrite |
| User selects guarded union for workflow discovery | Positive candidates are unioned, then denies and readiness gates are applied |
| User selects strict intersection for actions | Action is executable only when every required authority layer allows it |
| Intersection profile omits a required role layer | Resolution blocks with `COMPOSITION_SCOPE_MISSING` |
| Union includes an action denied by brand policy | Deny remains effective; action is excluded or blocked |
| Two equal-ranked scalar policies disagree | Resolution blocks with `POLICY_CONFLICT` |
| Tenant quota is 100 and workspace quota is 50 | Effective quota is 50 through `minimum` |
| Brand risk is medium and activity risk is high | Effective risk is high through `maximum` |
| User prefers Agent A but only Agent B is authorized | Agent B remains effective; preference cannot grant Agent A |
| User hides an authorized workflow in personal view | Workflow remains authorized but is personally de-ranked/hidden |
| User preference tries to lower approval severity | Mutation is rejected with `PREFERENCE_VALUE_NOT_ALLOWED` |
| Variant patch targets mandatory audit policy | Patch is rejected with `VARIANT_PATCH_FORBIDDEN` |
| Role allows edit but not grant | User may edit an eligible personal/scoped variant but cannot change grants |
| Brand administrator creates a brand variant | Variant is visible only in authorized brand contexts |
| Workspace profile and brand profile use different eligible operators | Each policy family resolves independently using registered semantics |
| Brand, activity, and workflow have multiple containment paths | All paths are evaluated; non-mergeable conflict blocks |
| Dynamic Container graph is empty during initial rollout | Legacy enforcement remains authoritative; shadow coverage reports missing projections |
| Current legacy policy and contextual shadow decision match | Parity sample is recorded as match |
| Current legacy policy and contextual decision differ | Mismatch is recorded; no cutover occurs |
| Shared plugin is visible but tenant has no connection | Catalog shows `credential/connection required`; asset is not executable |
| Tenant adds its own credentials through governed intake | Asset stores only opaque connection binding; secret remains in vault authority |
| Registry connector is active but installation row is absent | Operational state remains pending, not active |
| Installation exists but certification expired | Execution blocks with `CERTIFICATION_REQUIRED` |
| Approval-sensitive active grant exists without open hold | UI reports approval-sensitive grant, not pending request |
| Sensitive action is invoked | Exact approval hold is created or required; no broad permanent approval is inferred |
| User changes explanation depth | Class A preference can be applied with rollback and no authority effect |
| System observes repeated preferred workflow selection | It may create a Class B proposal with evidence; no silent change |
| System proposes composition profile change | Impact simulation and user confirmation are required |
| System proposes provider write or new grant | Classified Class E and routed to existing governed approval; no self-approval |
| Adaptive simulation detects policy regression | Proposal is blocked and cannot enter canary |
| Canary improves target KPI without guardrail regression | Proposal may be promoted to stable scoped profile/variant after criteria pass |
| Canary causes quality or safety regression | Automatic rollback/expiry is triggered and recorded |
| Tenant-local improvement is considered for platform reuse | Privacy-safe promotion candidate is created; shared base is not changed automatically |
| Cross-tenant variant or connection reference is attempted | Request is rejected before credential or provider access |
| Authority epoch changes during mutation | Mutation blocks or retries safely; stale manifest cannot dispatch |
| Preview is requested | No secret read, provider call, installation mutation, or external write occurs |
| Effective manifest is inspected | Every selected asset, profile, operator, variant, preference, and blocker is explainable |
| User opts out of behavioral adaptation | Behavioral proposals stop; explicit preferences and necessary operational telemetry remain governed separately |
| User deletes/resets preference data | Personal profile is reset without changing tenant policies, grants, or shared assets |
| Resolution exceeds path/candidate/time limits | Fails closed with typed limit error; no partial allow |
| Cached decision predates revocation | Epoch/version invalidation prevents stale authority from granting execution |

| User receives a role through a nested group | Membership path is bounded, tenant-scoped, cycle-free, versioned, and included in the manifest |
| Group membership is revoked after preview | Authority epoch/version invalidates the preview before dispatch |
| Service principal has no active owner or assurance | Sensitive execution blocks with principal-readiness evidence |
| Partner tenant manages a client tenant | No client resource access exists unless the exact relationship policy and delegated grant allow it |
| Tenant enters offboarding | New consequential work blocks; export, connection shutdown, grant disposition, legal hold, and erasure follow the lifecycle plan |
| User requests preference export or erasure | Export/reset/erasure respects legal hold and preserves only required minimal audit evidence |
| Artifact is classified for a prohibited processing purpose | Model, provider, indexing, or cross-tenant use blocks before content transfer |
| Data residency allows one region only | Ineligible model/provider/connection regions are removed from candidates |
| Cost-bearing action is previewed | Estimate and reservation requirements are shown without debit or provider write |
| Two concurrent requests reserve the same remaining budget | At most one succeeds or both receive a consistent bounded reservation result; no overspend |
| Execution fails after a cost reservation | Settlement releases/refunds unused reservation idempotently |
| Model is cheaper but fails required quality/data policy | It is excluded; free-first cannot weaken the constraints |
| Selected model version lacks current evaluation evidence | Sensitive execution blocks with `MODEL_EVALUATION_REQUIRED` |
| Model fallback would cross residency boundary | Fallback blocks rather than silently switching provider |
| External operation is retried after timeout | Universal idempotency prevents duplicate effect and records delivery semantics |
| Multi-step provider operation partially succeeds | Saga state identifies completed steps and executes or requests approved compensation |
| User cancels a queued operation before dispatch | Cancellation is durable and no provider call occurs |
| Artifact is produced | Checksum, schema, manifest, provenance, sensitivity, license, freshness, verification, and retention are recorded |
| Source artifact is corrected or erased | Dependent artifacts/indexes are revalidated, retracted, corrected, or disposed according to policy |
| Future policy is scheduled | Current and future-state previews differ by explicit `as_of` time without early enforcement |
| Preview was created in staging | It cannot authorize production execution |
| Production connection is referenced from sandbox | Environment binding blocks before credential materialization |
| Package signature or dependency evidence is missing | Code-bearing package installation/publication blocks |
| Client lacks support for manifest schema version | Compatibility negotiation selects an approved version or returns a migration/deprecation error |
| Tenant export is requested | Portable no-secret manifest is complete, checksummed, authorized, and auditable |
| Restored backup contains profiles and variants | Tenant isolation, authority epochs, manifest reconstruction, and cache invalidation pass restore validation |
| Primary approver is unavailable | Approved fallback/escalation policy applies without weakening separation of duties |
| Two assets implement the same capability | Only compatible, authorized, ready, policy-compliant alternatives are ranked by quality/risk/cost/preference |
| Arabic tenant experience uses a model without Arabic quality evidence | Model is excluded or marked insufficiently evaluated |
| Recommendation is repeatedly shown because of prior exposure | Exposure ledger and exploration/calibration controls prevent self-reinforcing ranking |
| High-volume tenant dominates aggregate evidence | Cohort and weighting controls prevent automatic platform-default promotion |

| Brand is linked to one primary Business Type | Compatible required/recommended/optional Blueprints become eligible; no Department, membership, credential, or execution grant is created until an approved inheritance apply |
| Brand previews Travel Agency inheritance | Preview shows proposed Departments, Groups, Roles, member profiles, AI Agent profiles, knowledge trees, and canonical asset references with provenance and no provider call |
| Brand applies a Department Blueprint | A Brand-scoped Department instance and typed relationships are created; shared Skills, Workflows, Policies, Apps, Tools, Graphs, Engines, Logic, and Knowledge remain references |
| Business Type Blueprint contains an AI Agent profile | Brand receives a scoped Agent assignment/profile referencing the shared Agent; the base Agent is not copied and no extra authority is granted |
| Member-profile Blueprint is inherited | Existing/invited members may be assigned to the profile; no human account is auto-created |
| Brand has primary Travel and secondary Ecommerce Business Types | Compatible Department/knowledge/workflow Blueprints compose per registered layer rules; action authority remains restrictive |
| Two Business Types contribute equivalent Departments | Equivalence/supersession metadata de-duplicates deterministically or resolution blocks if ambiguous |
| Two equal-ranked Blueprints conflict | Apply blocks with a typed inheritance conflict until an authorized resolution is recorded |
| Brand excludes an optional Blueprint | Exclusion is recorded in the inheritance profile and explanation; required mandatory controls remain effective |
| Brand pins a Blueprint version | Future ordinary upgrades remain preview-only while security revocation can still block the unsafe version |
| Blueprint adds a new optional Group | It is not auto-adopted under the recommended default; Brand receives an upgrade proposal |
| Blueprint security update revokes an unsafe Tool | Effective inherited binding is invalidated according to security policy and affected manifests expire |
| Local Brand patch does not overlap a Blueprint update | Upgrade is classified auto-safe or reviewable according to profile and can rebase deterministically |
| Local patch conflicts with the updated Blueprint | Upgrade enters conflict state and current behavior is pinned or blocked according to risk policy |
| Brand removes a Business-Type binding with active members and agents | Removal blocks until an approved disposition plan covers Departments, Groups, roles, memberships, agents, grants, schedules, approvals, variants, artifacts, and dependencies |
| Department hierarchy exceeds Brand/Tenant/Platform depth | Publication or inheritance apply blocks before graph mutation |
| Blueprint or instance graph creates a cycle | Publication/apply blocks and authority epoch remains unchanged |
| Unknown layer type or relationship type is referenced | Blueprint publication/resolution blocks; no generic JSON fallback is used |
| Brand inheritance settings attempt to weaken Tenant safety | Setting is rejected by parent-bound validation |
| Principal preference ranks inherited workflows | Ranking applies only inside the authorized inherited candidate set and does not change Blueprint, grant, or policy authority |
| Effective manifest is inspected | It includes Business Types, Blueprints, inheritance profile, Brand layer graph, source asset versions, merge operators, exclusions, conflicts, local patches, and authority/version vector |

| New Google user accepts a scoped invitation | One global user identity is created/linked; no new Tenant or personal workspace is created; target membership and exact grants are applied transactionally |
| Existing user accepts an invitation to another Tenant | Existing identity and unrelated memberships/personal resources remain unchanged; only target membership/scopes are added |
| Invited Google email does not match the signed-in verified email | Acceptance blocks and offers account switching without leaking invitation scope |
| Invitation targets one Brand and Workspace | User receives minimal Tenant membership plus only the listed Brand/Workspace/Department/Group/Role grants; no broad default workspace grant is created |
| Invitation scope is changed after delivery | Original acceptance checksum fails; user must accept a disclosed revision or new invitation |
| Inviter lost authority before acceptance | Acceptance blocks or recomputes within the inviter's current delegation ceiling; stale invitation grants are not applied |
| Invitation token is replayed | Second acceptance is idempotent or rejected as already used; no duplicate memberships or grants are created |
| Invitation is revoked or expired | Preview/acceptance fails closed and no context is issued |
| User already holds a stronger target role | Acceptance adds missing exact scopes without downgrading the stronger role |
| Scoped invitation contains conflicting Role/Group assignments | Acceptance blocks with typed conflict evidence until authorized resolution |
| User accepts invitation and requests personal workspace | Personal account/workspace is created only through the separate explicit operation and remains isolated from company Tenant resources |
| User declines personal workspace prompt | Team membership remains active; no personal Tenant is created |
| Multi-Tenant user signs in | UI/API requires or restores a validated active context; first membership order is not treated as authority |
| User switches context from personal to company Workspace | New short-lived context is issued after current membership/grant/epoch validation; previous context cannot expose mixed data |
| Company membership is revoked while context is active | Active context expires or is invalidated and company resources become inaccessible without affecting personal/other Tenant contexts |
| Google identity is linked to an existing password account | Provider subject links to the same global user after verified ownership checks; duplicate users are not created |

| Verified user explicitly creates a company Tenant | Governed provisioning creates the Tenant, owner assignment, owner membership, selected region/plan, audit, and readback without altering other memberships |
| User signs in with Google but does not request Tenant creation | No Tenant, Brand, or Workspace is created automatically |
| User accepts a team invitation | User joins the existing target Tenant only; Tenant creation capability remains available separately |
| User owns a personal Tenant and belongs to a company Tenant | Both contexts remain visible and isolated; company administrators cannot access personal resources |
| User reaches owned-Tenant plan limit | Creation blocks with a commercial/entitlement explanation and upgrade/request path, not an authorization error |
| Workspace is created | It records exactly one immutable owning Tenant and an allowed registered Workspace type |
| Brand Workspace is bound to one Brand | Binding affects context/resource eligibility but does not transfer Brand ownership or create access by itself |
| User has active Tenant membership but no Workspace grant | Workspace and its resources remain inaccessible |
| User has Workspace grant but Tenant membership is revoked | Access blocks and active context is invalidated |
| Multi-Brand Workspace is requested under default settings | Creation or additional binding blocks until Tenant policy explicitly enables it |
| Multi-Brand Workspace is enabled | All bound Brands belong to the same Tenant and exact grants/policy conflicts/provenance are enforced |
| Cross-Tenant Brand or resource is bound to a Workspace | Binding blocks before mutation |
| Sandbox Workspace attempts production execution | Dispatch blocks regardless of user preference or inherited Blueprint |
| Workspace is archived or deleted | Tenant and Brands remain; tasks, schedules, Agents, grants, artifacts, bindings, and active operations follow approved disposition |
| Tenant enters offboarding | Every owned Workspace and dependent operational resource appears in the lifecycle impact plan |
| User switches from owned Tenant to invited Tenant Workspace | Context is revalidated and no data from the previous Tenant remains visible implicitly |

## Success thresholds before enforcement

- zero cross-tenant leakage in tests and shadow evidence;
- zero secret values in profiles, variants, manifests, proposals, and logs;
- 100% required audit coverage;
- no critical parity mismatches;
- at least the configured minimum comparable shadow samples per cutover family;
- p95 and p99 resolution latency within rollout policy budgets;
- deterministic checksum equality for repeated identical inputs;
- all mutation routes demonstrate idempotency, version conflict handling, and same-cycle readback;
- user impact preview correctly predicts changed effective fields for certified test cases;
- rollback works for profiles, variants, experiments, and resolver cutover flags.
