# Permissions and Responsibility Matrix

## 1. Independent decision planes

| Plane | Question | Canonical authority |
|---|---|---|
| Authentication | Who is the principal? | signed session/JWT and membership |
| Context | Where is the principal operating? | Dynamic Container Authority |
| Authorization | What may the principal use or execute? | roles, resource bindings, specialized grants, capability envelopes |
| Composition | How do applicable layers combine? | composition profiles constrained by dimension/policy registries |
| Preference | What does the user prefer among allowed results? | user runtime preference profile |
| Variant | Has an authorized scope customized an asset? | optional variant and patches |
| Readiness | Can the operation run now? | connection, installation, credential eligibility, certification, quota, approval |
| Data governance | May this authorized data be processed for this exact purpose, audience, destination, provider/model, region, and retention context? | classification, purpose, lawful-basis/consent, residency/transfer, retention/legal-hold, lineage/disposition, provider/model, and data-use decision authorities |
| Commercial and FinOps | Is this exact operation entitled, measurable, priced, funded/reservable, billable, and settleable for one account/profile/model/asset/manifest? | billing account/owner, model/profile, meter/unit, rating/price, entitlement, estimate, reservation, settlement, ledger, standing, and commercial-epoch authorities |
| Contextual Model Governance | Which exact provider endpoint/model version/inference profile is eligible, evaluated, ready, ranked, reserved, and safely fallback-compatible for this task/context? | task/capability, model/provider endpoint, context policy, optimization, evaluation, scorecard, readiness, selection, fallback, lifecycle, incident, deprecation, and model-governance-epoch authorities |
| Durable Workflow and Effect Commit | How is long-running work decided, delivered, timed, retried, cancelled, verified, reconciled, compensated, replayed, recovered, and isolated without duplicating committed Effects? | Workflow/Activity/Effect definitions, history, attempts, leases/fencing, timers/signals, Effect Ledger, verification/reconciliation, Outbox/Inbox, Saga, checkpoint/replay, recovery, queue/concurrency/fairness, and runtime-governance-epoch authorities |
| Verifiable Artifact and Knowledge | Which exact Artifact/Source/Claim/Citation/Chunk/Embedding/Index version is authentic, intact, supported, fresh, licensed, policy-eligible, reproducible, selectively disclosable, publishable, correctable, retractable, and usable for this purpose? | Artifact/version/content, source/attestation/transparency, provenance/claim/citation, trust/verification/policy/freshness, reproducibility, knowledge build/retrieval, correction/retraction/disposition, and artifact-governance-epoch authorities |
| Adaptation | Should a change be proposed? | adaptive proposal and experiment authorities |

No plane silently substitutes for another.

## 2. Permission vocabulary

- `catalog.view`
- `asset.use`
- `asset.execute`
- `variant.create`
- `variant.edit`
- `variant.publish`
- `variant.manage_versions`
- `composition_profile.view`
- `composition_profile.select`
- `composition_profile.create`
- `composition_profile.publish`
- `preference.read_own`
- `preference.edit_own`
- `connection.configure`
- `grant.manage`
- `policy.manage`
- `data_governance.classify`
- `data_governance.manage_purpose`
- `data_governance.manage_residency`
- `data_governance.manage_retention`
- `data_governance.manage_model_use`
- `data_governance.preview_decision`
- `data_governance.apply_disposition`
- `legal_hold.manage`
- `privacy_request.manage`
- `cross_tenant_learning.manage_policy`
- `billing_profile.view`
- `billing_profile.select`
- `billing_profile.customize`
- `billing_profile.publish`
- `billing_account.manage`
- `billing_owner.manage`
- `commercial_relationship.manage`
- `commercial_registry.manage`
- `price_book.manage`
- `meter_registry.manage`
- `usage.view`
- `usage.dispute`
- `budget.manage`
- `reservation.preview`
- `reservation.create`
- `settlement.view`
- `refund_adjustment.review`
- `invoice.view`
- `cost_attribution.manage`
- `model_task_class.view`
- `model_capability.view`
- `model_candidate.view`
- `model_selection.preview`
- `model_selection.view`
- `model_preference.manage_self`
- `model_preference.manage_scoped`
- `model_provider_endpoint.manage`
- `model_version.manage`
- `model_inference_profile.manage`
- `model_context_policy.manage`
- `model_optimization_profile.manage`
- `model_evaluation_suite.manage`
- `model_evaluation.run`
- `model_evaluation.review`
- `model_scorecard.publish`
- `model_readiness.publish`
- `model_incident.restrict`
- `model_deprecation.manage`
- `model_fallback.manage`
- `workflow_type.view`
- `workflow.create`
- `workflow.view`
- `workflow.signal`
- `workflow.cancel`
- `workflow.resume`
- `workflow.replay`
- `workflow_definition.manage`
- `workflow_policy.manage`
- `activity_type.manage`
- `activity_handler.certify`
- `effect_contract.manage`
- `effect_verification.review`
- `effect_reconciliation.run`
- `effect_compensation.run`
- `runtime_recovery.view`
- `runtime_recovery.act`
- `runtime_recovery.resolve`
- `transport_dead_letter.view`
- `transport_dead_letter.redrive`
- `runtime_queue.manage`
- `runtime_concurrency.manage`
- `runtime_fairness.manage`
- `runtime_determinism.review`
- `artifact.view`
- `artifact_version.view`
- `artifact_provenance.view`
- `artifact_claim.view`
- `artifact_citation.view`
- `artifact_trust.view`
- `artifact_policy.view`
- `artifact_reproducibility.view`
- `artifact_source.manage`
- `artifact_schema.manage`
- `artifact_attestation.issue`
- `artifact_attestation.verify`
- `artifact_transparency.manage`
- `artifact_claim.manage`
- `artifact_citation.manage`
- `artifact_trust_policy.manage`
- `artifact_verification.run`
- `artifact_publication.review`
- `artifact_policy_envelope.manage`
- `artifact_selective_disclosure.manage`
- `artifact_reproduction.run`
- `knowledge_source.manage`
- `knowledge_index.build`
- `knowledge_index.publish`
- `knowledge_retrieval_evidence.view`
- `artifact_correction.request`
- `artifact_correction.apply`
- `artifact_retraction.request`
- `artifact_retraction.apply`
- `artifact_disposition.preview`
- `artifact_disposition.apply`
- `adaptation.review`
- `experiment.manage`
- `platform_candidate.promote`

Permissions are explicit. `edit` does not imply `grant`; `select profile` does not imply `publish profile`; `configure connection` does not reveal credentials.

## 3. Shared asset operations

| Operation | Platform asset | Tenant/user effect | Required authority |
|---|---|---|---|
| View catalog | read canonical projection | none | visibility + membership |
| Use shared read asset | reference canonical asset | execution/session evidence only | asset/grant/context readiness |
| Execute shared write action | reference canonical action | provider/runtime effect | exact action + endpoint + resource + approval readiness |
| Customize asset | platform base unchanged | creates optional scoped variant | variant.create + modifiable-path policy |
| Update base | creates new platform version | variants receive upgrade state | platform governance only |
| Archive/revoke base | base status changes | dependent variants may block | platform governance only |

## 4. Blueprint and inheritance permissions

### Platform governance

May:

- register layer and relationship types;
- publish Platform and Business-Type Blueprint versions;
- define required/recommended/optional adoption classes;
- define allowed merge, replacement, supersession, upgrade, and security-revocation behavior;
- certify Blueprint packages and shared-resource bindings;
- revoke unsafe Blueprint/resource versions;
- define Platform hard bounds and settings schemas.

May not silently create Brand memberships, credentials, or execution grants through Blueprint publication.

### Tenant owner

May:

- allow or deny Business Types and Blueprint families for Tenant Brands;
- set Tenant inheritance bounds below Platform maxima;
- delegate Brand inheritance publication authority;
- approve cross-Brand participation exceptions where Platform policy allows;
- review destructive removal/disposition and high-risk upgrade decisions.

### Brand administrator

May, within Tenant/Platform bounds:

- create and manage primary/secondary Business-Type bindings;
- select required/recommended/optional Blueprints;
- publish Brand inheritance profiles;
- preview/apply Brand-scoped Department, Group, Role, member-profile, Agent-profile, knowledge, and resource-binding instances;
- pin, replace, upgrade, disable, or locally patch eligible inherited layers;
- resolve non-safety inheritance conflicts;
- manage Brand Departments and Groups.

May not:

- modify another Brand;
- exclude mandatory Platform/Tenant controls;
- auto-create human users;
- duplicate or mutate canonical shared assets;
- inherit credential values;
- grant an Agent/Role more authority than current Brand/Tenant policy;
- remove active inherited layers without an approved disposition plan.

### Department administrator

May select and administer only Brand-approved inherited layers delegated to the Department, including local Groups, Role/member/Agent profile assignments, knowledge/workflow/tool selection, stricter settings, and local queues. It cannot publish a new Business-Type binding or exceed Brand bounds.

### User

May view inherited provenance and select eligible non-authority preferences. It cannot change Business-Type bindings, inheritance profiles, Department/Group structure, or inherited authority unless separately delegated.

## 5. Invitation, identity-link, and personal-context permissions

### Tenant/Brand inviter

May invite only when holding explicit invitation authority for the target Tenant and every included Brand, Workspace, Department, Group, Role/profile, and resource scope. The inviter cannot delegate a permission, environment, expiry, approval bypass, or redelegation capability beyond its current authority ceiling.

### Invitee

May:

- view a safe invitation preview;
- authenticate with the exact verified invited identity;
- accept or decline;
- review the exact resulting membership and scopes;
- create a separate personal account/workspace only through an explicit operation;
- switch among currently authorized contexts.

May not edit invitation scope, select another invitee identity without revalidation, access target resources before acceptance, or infer private Tenant contents from preview.

### Tenant owner/admin

May create, list, resend through approved delivery, revise with renewed disclosure, revoke, and audit invitations within delegated scope. It cannot read raw invitation tokens after delivery or access the invitee's personal workspace.

### Platform identity governance

May define identity-provider validation, link/recovery policy, token/session bounds, invitation security floors, personal-account limits, and context schema. It cannot grant Tenant access solely because an external identity or domain exists.

### Personal account owner

Owns the personal-account Tenant and personal Workspace within plan and Platform bounds. Company Tenant administrators have no authority over personal resources, and personal ownership grants no authority in company Tenants.

## 6. Tenant creation and Workspace permissions

### Verified global user

May:

- inspect Tenant-creation capability and limits;
- request creation of an allowed Tenant type;
- cancel a pending provisioning run where safe;
- create an optional personal account/workspace;
- retain memberships in other Tenants;
- switch among authorized contexts.

May not bypass plan, verification, region, risk, fraud, or legal policy; create a Tenant implicitly through sign-in/invitation; or gain authority in another Tenant because it owns one Tenant.

### Tenant owner

May, within Platform and plan bounds:

- create and administer Workspaces;
- publish Workspace context policies;
- bind same-Tenant Brands, Departments, Groups, Activities, Agents, and resources;
- grant Workspace access within its own authority ceiling;
- enable multi-Brand Workspaces when allowed;
- archive or request deletion with dependency disposition.

May not create cross-Tenant Workspace bindings, expose personal-account resources, store credential values in Workspace settings, or use a Workspace to bypass Tenant/Brand/Role authority.

### Workspace administrator

May manage delegated Workspace settings, members/grants, bindings, tasks, schedules, and operational resources. It cannot change Tenant ownership, billing owner, federation contracts, Brand ownership, Tenant security floors, or Workspace owning Tenant.

### Platform governance

May define Tenant/Workspace types, creation hard bounds, regional/plan availability, risk/verification, personal-account policy, multi-Brand constraints, and lifecycle schemas. It cannot silently create Tenants for users or treat commercial restrictions as security grants.

## 7. Data-governance permissions

### Platform governance

May define mandatory classification categories, prohibited uses, jurisdiction registry, policy schema/operators, provider/model minimum controls, legal-hold and audit floors, and cross-Tenant learning hard bounds. It may not use Platform scope to expose one Tenant's private content to another Tenant.

### Tenant data-governance administrator

May, within Platform and jurisdiction bounds:

- assign or approve classifications;
- publish Tenant purpose, residency/transfer, retention, and model-data-use policy;
- manage eligible provider processing profiles and aggregate-learning participation;
- create or release legal holds when separately authorized;
- review privacy-request and disposition runs;
- preview data-use decisions and explanations.

May not grant resource access, weaken Platform/legal/security/contract floors, authorize cross-Tenant raw content use, read credential values, or use a legal hold as a discovery/read grant.

### Brand or Workspace administrator

May select or tighten eligible purposes, audiences, destinations, environments, providers/models, data classes, and retention behavior only where parent policy delegates that field. It cannot create a lawful basis, override a legal hold, authorize a prohibited transfer, or weaken Tenant/Platform policy.

### Privacy operator

May process identity-verified access, export, correction, restriction, erasure, objection, and consent-withdrawal requests within exact object scope. It receives the minimum content and evidence required for the workflow and cannot bypass ordinary object authority outside the request.

### Legal-hold operator

May create, change, or release an exact hold scope with required approval and audit. Hold authority prevents covered deletion or mutation but grants no new read, export, or processing authority.

### Data subject or user

May inspect applicable transparency, consent, preference, request, and status information; grant or withdraw consent where consent is the applicable basis; and submit supported privacy requests. A subject preference or consent cannot authorize a use prohibited by higher policy.

### Runtime and Agent principals

May only consume data when an immutable data-use decision allows the exact operation, purpose, provider/model, region, audience, destination, and retention context. They cannot self-classify data downward, invent purpose, create lawful basis, override hold, or reuse a decision across a changed governance epoch.

### Cross-Tenant learning governance

May approve only aggregate-learning policy and runs satisfying Platform hard bounds, Tenant participation, minimum cohort, contribution/dominance, residency, re-identification, provenance, quality, and fairness rules. Raw Tenant content and Tenant-specific examples remain forbidden.

## 8. Commercial and FinOps permissions

### Platform commercial governance

May define and activate billing-model, collection-mode, currency, credit-unit, usage-unit, meter, aggregation, rating, price-book schema, profile-template, customizable-field, standing, reason-code, ledger-policy, and state-transition registries. It may define Platform hard bounds, accounting floors, tax/FX source policy, compatibility, and deprecation.

May not use registry authority to expose another Tenant's private usage, silently change an already reserved price, mutate posted ledger entries, or bypass data, authorization, approval, fraud, or payment controls.

### Billing-account owner or Tenant commercial administrator

May, within Platform, contract, subscription, accounting, tax, risk, and payment bounds:

- select allowed billing models and collection modes;
- create or publish billing profiles from eligible templates;
- configure delegated budgets, quotas, included units, overage, alerts, statement grouping, and attribution;
- approve direct commercial relationships where separately authorized;
- review estimates, reservations, settlements, statements, invoices, disputes, and adjustments;
- choose stricter limits or require additional approval.

May not invent prices, meters, units, formulas, currencies, FX rates, ledger accounts, tax behavior, or billable ownership outside registered authorities; raise contract ceilings; edit posted entries; or expose payment credentials.

### Brand or Workspace commercial administrator

May customize only delegated profile fields and lower limits for its exact scope, select eligible meter bundles, attribution tags, alerts, and approval thresholds, and inspect scoped usage/cost evidence. It cannot change billing owner/account, parent price book, tax, payment terms, credit limit, or another scope's profile.

### End user

May, when permitted by the active template and contract:

- view eligible billing models, collection modes, meters, units, included quantities, and price explanations;
- preview Credits versus Direct Monetary Billing;
- select an eligible billing profile;
- customize presentation currency, notification/alert preferences, statement grouping, attribution tags, and a lower personal reservation ceiling;
- view own/scoped usage and submit a dispute.

May not change price, tax, FX, credit conversion, billable owner, credit limit, overage hard maximum, ledger, invoice, payment collection, or non-customizable fields.

### Meter source principal

May submit or derive usage only through an approved internal ingestion contract for registered meter/version/unit and exact Tenant/account/operation/manifest scope. It cannot rate, settle, alter billing ownership, or replay an event to create duplicate billable usage.

### Rating and settlement service principals

May rate verified usage and create reservation/settlement proposals only from registered policies and exact versions. Settlement posting requires exact reservation, verified evidence, idempotency, commercial epoch, and ledger balancing. These principals cannot edit price books, approve their own high-risk adjustments, or access raw payment credentials.

### Finance, refund, and dispute operators

May review scoped statements, invoice, payment-result references, disputes, refunds, adjustments, and reconciliation evidence according to separation-of-duties policy. They cannot mutate original meter events or posted ledger entries; corrections use append-only events and compensating transactions.

### Runtime and Agent principals

May dispatch cost-bearing work only when the manifest binds an active compatible reservation and current commercial decision. They cannot self-select an ineligible model/profile, extend reservations beyond policy, create prices/meters, or continue after safe-stop when extension fails.

## Contextual Model Governance permissions

### Platform model-governance administrator

May define and version task classes, capability dimensions/profiles, provider endpoint/deployment profiles, exact model versions, inference profiles, context-policy schemas, optimization profiles, evaluation-suite schemas, metric semantics, lifecycle, and compatibility contracts.

May not use registry authority to bypass data governance, commercial reservation, credential isolation, evaluation evidence, approval, separation of duties, or provider adapter allowlists.

### Tenant model-policy administrator

May, within Platform, contract, plan, data, region, safety, quality, and commercial bounds:

- select allowed optimization profiles and fallback behavior;
- define stricter task/model/provider/region restrictions;
- configure eligible user/delegated preference templates;
- require higher evaluation/readiness floors or disable fallback;
- inspect scoped candidate, selection, scorecard, readiness, drift, and deprecation evidence.

May not register raw provider endpoints/models, lower mandatory floors, modify Platform evaluation results, expose credentials, authorize prohibited data use, or select another Tenant's private endpoint/profile.

### End user

May, when the active template permits:

- view eligible candidates and exclusion explanations;
- preview model selection;
- select an eligible optimization profile;
- prefer an eligible provider/model;
- request local-only/privacy-first behavior;
- set lower personal cost/latency ceilings;
- disable fallback or pin an eligible low-risk candidate.

May not submit raw unregistered IDs/endpoints, lower mandatory floors, override data/region/tool/output policy, change evaluation/readiness evidence, bypass reservation, or modify credentials.

### Evaluation designer and runner

The designer may create versioned evaluation-suite drafts, dataset references, rubrics, metrics, thresholds, validators, sample policy, and freshness requirements. The runner may execute an approved suite against exact candidate versions and persist immutable results.

Neither role may unilaterally publish a high-risk scorecard when separation of duties requires independent review. Evaluation access does not grant production-dispatch or provider-policy authority.

### Evaluation reviewer / scorecard publisher

May review suite/run provenance, deterministic/human/model-judge evidence, confidence, failures, thresholds, and drift before publishing a bounded scorecard. Cannot alter source results, candidate identity, or commercial evidence.

### Readiness publisher

May publish no-secret endpoint/model readiness from approved health, quota, capacity, incident, latency, and feature sources. Cannot expose credential values or mark readiness contrary to source evidence.

### Incident and revocation operator

May apply exact provider/endpoint/model/version restrictions or emergency revocation with reason, authority, effective scope, expiry/review, audit, and readback. Cannot delete historical evidence or silently broaden data access.

### Deprecation operator

May preview and manage approved deprecation runs, replacements, deadlines, shadow/canary evidence, migration state, rollback, and exceptions. Cannot force a replacement that fails contextual gates.

### Selection runtime principal

May construct candidate sets, apply deterministic gates, rank eligible candidates, create immutable selection decisions, and request candidate-specific commercial estimate/reservation. It cannot create policy, evaluation, readiness, or credentials, and cannot dispatch a candidate absent current manifest-bound evidence.

### Provider adapter runtime principal

May invoke only the exact manifest-bound, pre-dispatch-revalidated provider endpoint/model/inference profile through an allowlisted backend adapter and resolved credential reference. It cannot choose a different candidate or fallback independently.

## Durable Workflow and Effect Commit permissions

### Platform runtime-governance administrator

May define and version Workflow, Activity, Effect, event, state, transition, timer, signal, retry, cancellation, compensation, reconciliation, checkpoint, replay, recovery, queue, concurrency, fairness, and reason-code schemas and policies.

May not use registry authority to inject executable code, arbitrary endpoints/headers, credentials, provider/model payloads, or bypass authorization, data, model, commercial, approval, audit, or handler certification.

### Workflow-definition publisher

May publish an immutable deterministic Workflow definition only after schema, command/event compatibility, replay determinism, Activity/Effect allowlist, deadline/cancellation/recovery, and migration checks pass. Cannot certify its own executable handler where separation of duties applies.

### Activity-handler certifier

May certify an allowlisted code handler/build digest for exact Activity types, input/output schemas, Effect classes, environments, and runtime versions. It cannot publish arbitrary code through the registry or grant production dispatch authority.

### Effect-contract administrator

May define bounded commit boundaries, idempotency, verification, reconciliation, cancellation, compensation, retention, and evidence for an exact Effect type/provider family. It cannot expose credentials, authorize prohibited provider/data use, or mark uncertain non-idempotent Effects as safe retries without evidence.

### Workflow requester / end user

May create an eligible Workflow, inspect own/scoped history and Effects, send an allowed signal, request cancellation, and request resume/replay previews where the Workflow policy permits.

May not choose unregistered handlers, alter history, force retry, edit Effect state, bypass deadline/reservation, broaden a child Workflow, or redrive transport artifacts.

### Workflow decision service principal

May replay immutable history, resolve registered transitions/policies, append deterministic decision events, schedule Activities/timers/dependencies, and create recovery requirements. It cannot execute provider Effects, read credentials, or invent unregistered commands.

### Activity Worker principal

May claim only an eligible queued Activity through a bounded lease, execute its allowlisted handler, record attempt/dispatch/result evidence, heartbeat, and commit using the current fencing token. It cannot select another Activity/Effect type, modify policy, or commit after lease loss.

### Verification and reconciliation principal

May run only registered verification/reconciliation strategies against exact Effect IDs and safe provider references. It can classify confirmed-effect, confirmed-no-effect, still-unknown, conflicting-evidence, or manual-review-required, but cannot rewrite original dispatch evidence.

### Compensation principal

May execute only a registered compensation Activity for an exact committed reversible Effect with current authority, approvals, dependency order, deadline, and commercial/data policy. It cannot erase history or compensate unrelated Effects.

### Runtime recovery operator

May inspect assigned recovery cases, preview allowed actions, request reconciliation, approved replay, compensation, or manual resolution, and record evidence. It cannot run arbitrary commands, edit history, declare success without verification, or access another Tenant's case.

### Transport dead-letter operator

May inspect and redrive scoped Outbox/Inbox/queue/callback/notification artifacts after a no-effect redrive preview and current consumer/schema compatibility. This authority does not permit replaying the business Workflow or repeating an external Effect.

### Queue/concurrency/fairness administrator

May define bounded service classes, Tenant/resource/provider limits, priority aging, admission, backpressure, and reserved recovery capacity. It cannot use priority or capacity settings to bypass authority, approval, safety, data/model governance, or commercial reservation.

### Determinism reviewer

May inspect definition/history compatibility and replay-command differences using safe checksums/evidence. It cannot mutate history or approve a mismatch as equivalent without a new compatible definition/version and governed migration.

## Verifiable Artifact and Knowledge permissions

### Platform Artifact-governance administrator

May define typed Artifact, schema, provenance, claim, relation, citation, trust, attestation, transparency, policy-envelope, reproducibility, Knowledge build, correction, retraction, and disposition registries and hard bounds.

May not use registry authority to inject executable code, arbitrary endpoints/headers, signing keys, credentials, unrestricted model behavior, or bypass data/license/publication/retention controls.

### Source-identity administrator

May register and verify source identities, trust domains, authority scope, assurance, lifecycle, key/certificate references, and revocation evidence. It cannot assert factual truth or publish an Artifact solely from identity verification.

### Artifact ingester / producer

May create a logical Artifact and immutable Version through an approved ingestion/transformation handler, bind exact source/checksum/manifest/policy evidence, and request verification. It cannot edit a published version, self-verify mandatory dimensions, or broaden inherited policy.

### Attestation issuer

May issue only registered attestation types for exact versions/checksums within its signing authority and trust domain. It cannot access raw private keys through the registry or issue publication/truth claims outside its scope.

### Attestation verifier / transparency operator

May verify signatures, expiry/revocation, log inclusion, roots, and witnesses and publish no-secret validation evidence. It cannot rewrite log history, suppress a fork, or convert signature validity into factual support.

### Claim and citation curator

May create or review claim objects, support/contradiction relations, and exact citation locators within authorized content. It cannot alter source versions, hide material contradiction, or cite inaccessible evidence as publicly disclosed.

### Trust-policy administrator

May define task/risk/use/audience trust dimensions, thresholds, freshness, confidence, corroboration, review, and zero-tolerance conditions. It cannot make a composite score override mandatory policy/license/data/retraction gates.

### Artifact verifier / reviewer

May execute registered verification policies against exact versions/claims/evidence and record results. High-risk review follows separation of duties; a producer or model judge cannot be the sole mandatory authority where policy forbids it.

### Publication reviewer

May approve or block one exact Version for one channel/audience/purpose after integrity, source, claim, trust, Brand, safety, license, data, and freshness gates pass. Publication authority grants neither content ownership nor source modification.

### Policy-envelope administrator

May define conservative inheritance, destination/use constraints, and approved declassification/redaction/anonymization paths. It cannot weaken source restrictions without exact transformation, verification, legal/data authority, and approval.

### Selective-disclosure administrator

May define audience-specific provenance projections and opaque-reference/redaction behavior. It cannot fabricate lineage, hide material contradiction, expose another Tenant's evidence, or represent omitted proof as complete.

### Reproduction operator

May run an approved reproduction manifest with exact source/handler/model/prompt/parameter/environment versions and record differences. It cannot replace the original Artifact or promote a failed reproduction silently.

### Knowledge-source/index administrator

May register eligible Knowledge Sources and initiate versioned Chunk/Embedding/Index builds using approved profiles. It cannot inject arbitrary source memberships, model aliases, provider endpoints, or bypass policy/trust/freshness gates.

### Knowledge publisher

May activate one exact Index Version after build integrity, membership, source eligibility, embedding/model, retrieval/reranking, data/license/audience/freshness, rollback, and verification gates pass. It cannot mutate the active version in place.

### Artifact reader / end user

May read only authorized Artifact Versions, Claims, Citations, Trust/Policy summaries, Indexes, and Retrieval Evidence through the applicable selective-disclosure profile. Read authority does not grant export, redistribution, training, correction, retraction, or disposition rights.

### Correction requester / applier

A requester may propose corrected claims/content and impact evidence. An authorized applier may create a new immutable corrected Version after review. Neither role may edit the source Version or silently rewrite historical outputs.

### Retraction requester / applier

A requester may raise evidence for restricting/retracting exact Versions/Claims/Indexes. An authorized applier may block new eligible use and initiate dependency invalidation/notification after required review. Retraction authority does not grant erasure authority.

### Disposition operator

May preview and apply only DFR-003-authorized delete, rebuild, invalidate, retract, anonymize, aggregate, archive, hold, notify, or minimal-tombstone actions with exact scope, legal-hold/retention revalidation, approvals, durable Workflow evidence, and readback.

### Auditor / legal / regulator viewer

May inspect only the exact evidence and selective-disclosure projection delegated to that role. Audit/legal access is not an unrestricted content or credential grant and remains purpose, scope, retention, and jurisdiction bound.

### Separation of duties

For critical families, one principal cannot alone act as producer, mandatory verifier, publication approver, correction/retraction final approver, disposition executor, and transparency witness for the same Version. Emergency restriction may be immediate but remains reviewable and cannot erase evidence.

## 9. Composition profile permissions

### User

May:

- select platform templates;
- create personal profiles within allowed operators;
- preview exact impact;
- bind a personal profile to their own eligible contexts;
- reset to defaults.

May not:

- select an operator forbidden by the dimension registry;
- remove required layers mandated by tenant/workspace policy;
- publish a profile for another user, role, workspace, brand, activity, or tenant without delegated authority;
- weaken mandatory platform rules.

### Tenant/workspace/brand/activity administrator

May create or publish scoped profiles only within their governed scope and delegated authority. A child scope may tighten inherited policy; loosening requires exact approved override where allowed.

## 5. Preference permissions

A user can edit only their own preference profile unless explicit administrative support authority exists. Preferences may rank and narrow but never grant.

Allowed examples:

- preferred authorized agent;
- preferred workflow among eligible workflows;
- explanation depth;
- language and tone;
- notification cadence;
- dashboard layout;
- default composition template.

Forbidden examples:

- enabling an unauthorized action;
- selecting another tenant's connection;
- raising a quota;
- lowering approval or risk;
- disabling audit or certification;
- storing secrets.

## 6. Variant ownership scopes

| Owner scope | Who may create | Who may publish/use |
|---|---|---|
| User | the user or delegated assistant | owner user in authorized contexts |
| Role | role administrator | principals receiving the role |
| Workspace | workspace administrator | authorized workspace members |
| Brand | brand administrator | authorized brand contexts |
| Business activity | activity administrator | authorized activity contexts |
| Tenant | tenant owner/admin | authorized tenant contexts |

Every variant is tenant-bound even when user-owned.

## 7. Policy customization

Tenant or user customization may:

- add restrictions;
- add validators;
- increase review requirements;
- lower limits;
- change eligible preference fields;
- customize presentation and non-mandatory prompts;
- choose a stricter composition mode.

It may not:

- remove mandatory denies;
- lower approval severity;
- lower risk or sensitivity classification;
- raise quotas beyond inherited ceilings;
- bypass Brand Core, credentials, installation, certification, or readback;
- enable provider writes without exact authority.

## 8. Adaptive change permissions

| Proposal class | Example | Decision authority |
|---|---|---|
| A | language/layout preference | user confirmation or prior opt-in |
| B | preferred authorized workflow | user confirmation |
| C | composition profile change | user plus scoped policy rules; impact simulation |
| D | optional asset variant | variant publisher and required certification |
| E | grant, credential, spend, provider write, deployment | existing governed authority and approvals only |

An adaptive system never self-approves Class E.

## 9. Delegation rules

- Delegation names exact resource, operation, scope, validity, and delegator evidence.
- A delegate cannot exceed the delegator's effective authority.
- Wildcard write delegation is forbidden.
- Revocation invalidates future manifests and stale experiments.
- Credential eligibility can be delegated; credential values cannot.

## 10. Approval-sensitive grants

The UI and awareness model must distinguish:

- `approval_sensitive_active_grant` — a grant exists but invocation still requires approval;
- `pending_approval_request` — an actual open hold awaiting decision;
- `approved_for_exact_execution` — one bounded approved invocation;
- `approval_expired_or_consumed` — no longer usable.

## 11. Administrative support

Support or platform administrators receive no implicit cross-tenant edit or execution bypass. Any assisted action requires explicit support scope, tenant-visible audit, least privilege, and the same runtime safety gates.
