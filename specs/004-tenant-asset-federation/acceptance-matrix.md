# Acceptance Matrix

## Dev Orchestrator acceptance overlay

The Dev Orchestrator design bundle extends this matrix through `dev-orchestrator-spec-kit-coverage-matrix.md`, `dev-orchestrator-runtime-registry-api-test-runbook-preview.md`, and `dev-orchestrator-gap-closure-risk-register.md`. Runtime acceptance must include domain/budget separation, mixed-lane privacy, OpenRouter 402/429 fallback, paid-fallback approval, sub-agent denied-tool behavior, SDK trace/session safety, readback failure, partial-effect recovery, and authority-mode human approval. These scenarios remain design-only in PR #1898 and must be implemented in later runtime PRs with same-cycle readback.

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

| User has CRM read access but requests an unregistered purpose | Data-use decision blocks with `PROCESSING_PURPOSE_MISSING` before model, provider, index, export, or transfer |
| Registered purpose excludes the resource classification | Operation blocks with `PROCESSING_PURPOSE_NOT_ALLOWED` even though the access grant remains valid |
| Marketing use requires consent but no current consent exists | Operation blocks with `CONSENT_REQUIRED` and exposes a safe recovery action |
| Consent is withdrawn after an embedding and Agent memory were created | Future use blocks; lineage creates a disposition plan for the embedding, index, memory, summaries, and dependent artifacts |
| Tenant policy requires EU storage and processing | Non-EU provider/model/backup/export candidates are excluded before content transfer |
| Preferred model retains prompts while policy requires zero retention | Preferred model is excluded and fallback is allowed only if it satisfies the same data-use constraints |
| Legal hold covers a customer case | Matching erasure/deletion is suppressed, but the hold grants no additional read access |
| Retention expiry occurs while a legal hold is active | Data is retained under hold with review evidence; ordinary expiry does not delete it |
| Data subject requests correction | Primary data is corrected and dependent summaries, indexes, Agent memory, evaluations, and artifacts are rebuilt, invalidated, or retracted according to lineage |
| Data subject requests erasure | Governed discovery covers primary records, embeddings, indexes, Agent memory, provider copies, artifacts, analytics, and backups; each item records action or lawful exemption |
| Derived summary has no lineage to its source | Consequential reuse or deletion completion blocks with `DERIVED_DATA_DISPOSITION_REQUIRED` |
| Restricted data is sent to an external provider without compatible processing profile | Dispatch blocks with `PROVIDER_DATA_USE_INCOMPATIBLE` before credential materialization or content transfer |
| Model policy forbids fine-tuning or provider training | Training use blocks even when inference with the same provider is otherwise eligible |
| Raw content from two Tenants is proposed for shared learning | Operation blocks with `CROSS_TENANT_RAW_DATA_FORBIDDEN` |
| Aggregate learning cohort is below its privacy threshold | Run blocks with `CROSS_TENANT_COHORT_TOO_SMALL` and produces no reusable output |
| One Tenant dominates aggregate-learning contribution | Contribution/dominance controls block or reweight the run before promotion evidence is accepted |
| Governance policy changes after manifest preview | Governance epoch invalidates the stale manifest and dispatch blocks with `DATA_GOVERNANCE_VERSION_CHANGED` |
| Classification, purpose, or lawful-basis evidence is ambiguous | Most-restrictive evaluation fails closed and records the conflicting sources |
| Personal Workspace attempts to receive restricted company data | Transfer/copy blocks under Tenant, audience, purpose, and destination policy despite user ownership of the personal context |
| Data-use preview is requested | It returns classification, purpose, basis/consent, residency, retention/hold, provider/model, audience/destination, policy sources, blockers, checksum, and expiry without any provider call, deletion, transfer, or external write |
| Billing account permits Credits and Direct Monetary Billing | User can preview and select either eligible model; effective price, reservation asset, collection mode, included units, and maximum charge are explained before publish |
| Billing account permits prepaid only | User attempt to select postpaid invoice blocks with `COLLECTION_MODE_NOT_ALLOWED` and does not alter the active profile |
| User customizes a billing profile | Only template-exposed typed fields such as eligible model, presentation currency, alerts, attribution tags, lower reservation ceiling, and statement grouping can change |
| User attempts to edit a price, tax rule, FX rate, ledger account, billable owner, credit limit, or non-customizable field | Mutation blocks with `BILLING_PROFILE_FIELD_NOT_CUSTOMIZABLE` and preserves the prior profile/version |
| Two equal-ranked billing profiles select incompatible models | Resolution blocks with `BILLING_PROFILE_AMBIGUOUS` and explains both sources |
| Same operation is priced with Credits and money in separate previews | Each preview uses its own price-book lines and settlement asset; neither assumes a fixed credit-to-currency equivalence |
| Direct currency operation uses prepaid balance | Reservation atomically moves monetary capacity from available to reserved before execution and releases unused amount after settlement |
| Direct currency operation uses postpaid invoice | Reservation atomically consumes authorized liability capacity and settlement creates an invoice line without reading payment credentials |
| Credits operation is settled with money or monetary operation with Credits | Settlement blocks with `SETTLEMENT_ASSET_TYPE_MISMATCH` unless an explicit conversion contract and valid quote exist |
| Audio transcription is consumed | Raw usage records `transcription_second` or `audio_input_second`; rating may produce Credits or monetary charge according to the selected profile |
| Image generation is consumed | Meter uses registered image generation/megapixel units instead of text tokens |
| Storage is consumed across time | Meter aggregates canonical `byte_hour` usage rather than a one-time ambiguous GB count |
| Compute-heavy Agent run is consumed | Technical meters record vCPU, memory, GPU, and duration while the customer-facing billable meter may remain one Agent task |
| Customer is charged per processed document | Raw token, vector, compute, and storage events remain immutable while a registered composite `document_processed` meter produces billable usage |
| Customer is charged for a verified outcome | Settlement waits for registered verification, attribution window, deduplication, and dispute evidence before counting the outcome |
| Included subscription units exist | Included quantity is deducted from normalized usage before Credits or monetary rating; included use does not become a third settlement asset |
| Two concurrent operations target the same remaining balance or quota | Exactly one or a bounded allowed subset reserves capacity; no double spend occurs |
| Streaming operation exceeds its reservation window | Runtime requests a bounded extension and stops at the next safe boundary when extension is denied |
| Provider cost exceeds the authorized customer maximum | Customer charge remains capped; the difference is recorded as Platform-absorbed cost or review, not silently billed |
| Raw meter event is replayed | Deduplication returns the existing logical event and creates no duplicate billable usage |
| Meter correction arrives after statement close | Append-only correction and current-period adjustment are created; the closed statement is not rewritten |
| Billing account becomes past due | New cost-bearing reservations block by default while payment recovery, support, and legally required export remain available |
| Meter, price, profile, contract, standing, or commercial policy changes after manifest preview | Commercial epoch invalidates the stale manifest and dispatch blocks with `COMMERCIAL_EPOCH_CHANGED` |
| Billing-profile preview is requested | It returns eligible options, effective limits, meter/unit/rating/price versions, expected reservation, conflicts, and recovery actions without charge, reservation, invoice, payment, provider call, or external write |

| Registered summarization task requests a model | Resolver starts from the versioned task/capability contract and never from a raw model name or global provider order |
| Cheapest candidate is below the groundedness or safety floor | Candidate is excluded before cost-first ranking and cannot be restored by user preference |
| User selects `privacy_first` | Only already eligible candidates are reordered; residency, retention, training, safety, and quality gates remain unchanged |
| User submits a raw model ID or provider endpoint | Preference mutation blocks and preserves the prior preference/version |
| Candidate supports the task but not required structured output or tools | It is excluded with `MODEL_OUTPUT_CONTRACT_UNSUPPORTED` or `MODEL_TOOL_POLICY_INCOMPATIBLE` |
| High-quality candidate is outside the permitted region | It is excluded before ranking with `MODEL_REGION_INELIGIBLE` |
| Provider endpoint is ready but evaluation evidence is stale for an authority-sensitive task | Selection blocks with `MODEL_EVALUATION_STALE` unless an independently certified equivalent fallback is allowed |
| Evaluation passes but provider readiness is stale or unknown | Policy requests fresh readiness, uses only a certified fallback, or blocks; stale is never interpreted as ready |
| Two candidates are equal after all registered tie-breakers | Preview blocks with `MODEL_SELECTION_AMBIGUOUS` and explains both candidates |
| Global provider order places an ineligible provider first | Provider is absent from the eligible ranked set and fallback set |
| Selected candidate cannot obtain cost reservation | Dispatch does not start; another candidate is considered only when pre-approved as fallback and receives a new estimate/reservation |
| Fallback candidate would weaken data retention, region, tool, output, quality, or safety requirements | Fallback is excluded with stable evidence and execution blocks when no valid candidate remains |
| Authority-sensitive operation has no certified-equivalent fallback | Fallback is disabled and provider failure blocks rather than silently switching models |
| Provider outage occurs before dispatch | Runtime revalidates readiness and uses only the manifest-bound fallback or blocks |
| Model begins streaming or emits tool calls before failure | Runtime does not automatically switch models; DFR-006 restart/resume/compensation policy governs the next action |
| Mutable model alias resolves to a new version | Alias snapshot, compatibility, evaluation, and governance epoch determine whether the old decision remains valid |
| Model version is emergency revoked | Affected decisions/manifests invalidate; new dispatch blocks while historical run evidence remains reconstructable |
| Model is deprecated with active Agents/workflows | Deprecation preview lists affected assets, replacements, deadlines, shadow/canary evidence, rollback, and exceptions before apply |
| Production outcomes show quality drift | A drift event triggers review/re-evaluation and does not silently rewrite the prior scorecard or selection policy |
| Tenant chooses a lower maximum cost or latency | Preference narrows eligible candidates but cannot raise contract limits or lower mandatory floors |
| Model-selection preview is requested | It returns gates, candidates, exclusions, evaluation/readiness evidence, ranking, fallback, provisional commercial effects, epoch, and expiry without provider call, credential read, evaluation run, reservation, or external write |

| Workflow request repeats the same scoped idempotency key and checksum | Original logical Workflow and current outcome are returned without duplicate Activity or Effect |
| Same idempotency key is reused with different input | Request blocks with `WORKFLOW_IDEMPOTENCY_CONFLICT` and neither history nor external state changes |
| Workflow replay uses the same history and definition version | The same logical commands are produced; any divergence blocks with `WORKFLOW_NONDETERMINISTIC_REPLAY` |
| Registry row references an unknown or unapproved handler key | Publication or dispatch blocks with `ACTIVITY_HANDLER_NOT_ALLOWED`; no arbitrary code, URL, header, or secret is used |
| Worker lease expires and a newer Worker claims the Activity | Old Worker commit is rejected by monotonic fencing token |
| Provider timeout occurs before request transmission begins | Registered policy may schedule a bounded retry within deadline/reservation limits |
| Provider timeout occurs after transmission begins | Effect becomes uncertain and reconciliation runs before any retry |
| Reconciliation confirms the provider Effect exists | Workflow verifies and completes or advances without dispatching the Effect again |
| Reconciliation confirms no Effect occurred | Retry may be scheduled only according to the registered retry policy |
| Reconciliation remains uncertain after the bounded window | Workflow enters `recovery_required`; it is not falsely marked failed-no-effect or retried blindly |
| HTTP 200 is returned but business verification fails | Effect remains unverified and Workflow follows the registered reconciliation/recovery path |
| Workflow timer is pending during Worker or deployment restart | Timer remains durable and fires exactly once logically through history/inbox deduplication |
| Duplicate callback or signal is received | Registered signal idempotency returns the original processing result without duplicate transition |
| Cancellation arrives before any Effect dispatch | New work stops, unused reservations release, and outcome records `cancelled_no_effect` |
| Cancellation arrives after a user-visible or irreversible Effect | Workflow exposes committed Effects and records cancelled-with-effects, compensation, or manual recovery as applicable |
| Multi-step Workflow fails after reversible Effects commit | Registered compensation Activities execute in dependency-safe reverse order and preserve original history |
| Compensation itself fails | Workflow enters recovery with unresolved Effects, owner, SLA, and permitted next actions |
| Outbox message is delivered twice | Inbox unique identity prevents duplicate logical consumer Effect |
| Transport delivery exhausts retries | Transport artifact is dead-lettered while the business Workflow retains its own accurate recovery/outcome state |
| Queue is saturated for one large Tenant | Registered fairness/admission policy applies backpressure without starving other Tenants or bypassing priority bounds |
| Child Workflow is created | It inherits or tightens parent authority, deadline, data/model/commercial policy, and cannot broaden scope |
| Replay is requested after authority or manifest changes | Preview reports incompatibility or requires a new current manifest; source history remains unchanged |
| Model A fails before any committed output | Eligible Model B may run only after revalidation and a new candidate-specific estimate/reservation |
| Model A already streamed content to the user | Model B cannot silently continue the same output; partial completion, explicit restart, or superseding artifact is required |
| A Tool Effect is already committed before model fallback | Verified checkpoint includes the Effect and fallback executes remaining work only |
| Resume/replay/cancel/recovery preview is requested | It returns history, Effects, blockers, costs, and allowed actions without Activity execution, queue publish, provider/model call, credential read, reservation, compensation, or external write |
| Workflow history projection or snapshot is lost | Current state is rebuilt from immutable ordered history with matching checksum |
| Required Workflow/Activity/Effect policy evidence is stale or ambiguous | Dispatch fails closed with a stable structured error |

| Existing Artifact content is changed | A new immutable Artifact Version is created; prior version/checksum/history remain unchanged |
| Two stored representations encode the same canonical content | They may link to one Artifact Version only when canonicalization proves semantic equivalence and each stored checksum remains distinct |
| Client supplies only a mutable URL, Drive file ID, or latest alias as high-risk evidence | Eligibility blocks until an exact captured version and checksum are available |
| Artifact checksum is valid but source identity attestation is missing | Integrity may pass while authenticity remains failed/unknown; mandatory authenticity use blocks |
| Source signature is valid but the claim is unsupported | Authenticity remains valid while factual-support gate fails; signature cannot promote the claim |
| Required transparency entry/root proof is missing or invalid | Critical Artifact use/publication blocks with `ARTIFACT_TRANSPARENCY_PROOF_INVALID` |
| Provenance graph attempts a prohibited derivation cycle | Publication/build blocks with `ARTIFACT_PROVENANCE_CYCLE`; no partial graph becomes authoritative |
| One Artifact contains supported and contradicted claims | Claim states remain independently visible; Artifact-wide score cannot hide contradiction |
| Citation targets a floating page without immutable capture | Citation is classified unresolved/non-versioned and cannot satisfy high-risk support requirements |
| Citation locator no longer matches captured Source Version | Validation blocks with `CITATION_LOCATOR_INVALID`; source content is not silently reinterpreted |
| Trust composite score is high but a mandatory license or policy dimension fails | Artifact remains ineligible; ranking cannot override the hard gate |
| Financial/legal/publication use has insufficient freshness or review | Risk-specific trust policy blocks even if the same version remains eligible for bounded historical/internal use |
| Reproduction with exact manifest yields identical output | Run is classified bit-reproducible and links to the original without rewriting it |
| Reproduction differs within registered semantic tolerance | Run is classified semantically reproducible or bounded nondeterministic with difference evidence |
| Derived summary omits visible sensitive fields | It does not become public automatically; inherited Policy Envelope remains restrictive until verified declassification |
| User can read an Artifact but license forbids redistribution | Read remains object-authorized; export/publication/derivative use blocks separately |
| Public provenance projection is requested for private source evidence | Projection returns allowed opaque proof/checksum/status and explicit omissions without leaking content or fabricating lineage |
| Knowledge chunk is built | It binds exact Source Version, locator, chunking/normalization/redaction profile versions, policy, and checksum |
| Embedding model alias moved since index build | Existing Embedding/Index Version retains captured exact model/profile; new build requires new version/evaluation |
| Source is retracted after index publication | Affected chunks/embeddings/indexes/retrieval sets/manifests/caches invalidate and cannot serve new eligible use |
| Retrieval ranks a highly relevant but audience-ineligible source first | Source is excluded before ranking; retrieval evidence records the stable exclusion reason |
| Generated answer states a factual claim without supporting citation | Claim is marked unsupported/assumption/opinion/prediction or the output blocks according to risk policy |
| Correction is applied to a published Artifact | New Version is created with `corrects` relation; historical outputs preserve old version and receive impact/review state |
| Retraction is requested | Preview identifies descendants and actions; apply blocks new eligible use without erasing permitted audit history |
| Erasure applies while Legal Hold covers one descendant | Eligible content is deleted/rebuilt elsewhere while held scope remains retained-under-hold with no new read authority |
| Backfill lacks reliable source or license evidence | Record is marked provenance/license incomplete; evidence is never invented or silently promoted |
| Registry row attempts arbitrary transformation code, URL, header, or secret | Validation rejects publication; only allowlisted handlers/providers/operators may be selected |
| Eligibility preview is requested | It returns integrity/authenticity/provenance/trust/policy/freshness/license/retraction evidence without signing, writing, indexing, model call, credential read, invalidation, notification, or external effect |
| Cross-Tenant caller requests Artifact provenance | Object authorization returns scoped not-found/denial and leaks neither source identity nor graph shape |
| Artifact governance epoch changes before consequential use | Manifest revalidation blocks stale use with `ARTIFACT_GOVERNANCE_EPOCH_CHANGED` |

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
