# Data Isolation Checklist

## Shared versus scoped data

- [x] Shared canonical assets contain no tenant-specific secret or private preference.
- [x] Shared catalog projection references canonical assets without copying tenant data.
- [x] Tenant/user use creates scoped bindings or evidence, not shared-asset mutation.
- [x] Every optional variant is tenant-bound even when user-owned.
- [x] Every profile selection, preference, proposal, experiment, and manifest has explicit subject scope.

## Query boundaries

- [x] Tenant ID comes from the authenticated principal.
- [x] Repository queries begin with tenant scope for tenant-owned rows.
- [x] User-owned preferences require tenant + user scope.
- [x] Container, variant, connection, and role references are validated against the same tenant.
- [x] Admin diagnostics are separate from Tenant APIs and audited.
- [x] Cursor tokens cannot be replayed across tenants or incompatible filters.

## Variants and profiles

- [x] Variant owner scope cannot reference another tenant's user, role, workspace, brand, or activity.
- [x] Personal variants are not visible to other users unless explicitly promoted/shared through governed scope.
- [x] Profile selections affect only the declared principal/context.
- [x] Reset and rollback operate only on the caller's authorized scope.
- [x] Shared base updates never copy tenant patch content into another tenant.

## Credentials

- [x] Credential values stay in existing vault/secret authorities.
- [x] Manifests and variants contain opaque references only.
- [x] Connection selection validates tenant/user/workspace/brand eligibility.
- [x] Cross-tenant credential references are blocked before secret materialization.
- [x] Logs and adaptive evidence contain readiness summaries, not credential payloads.

## Learning and telemetry

- [x] User behavioral evidence is scoped to tenant and user where applicable.
- [x] Adaptation consent and visibility controls are represented.
- [x] Platform-wide learning cannot directly consume tenant content as a shared asset.
- [x] Promotion candidates remove tenant identifiers, credential references, confidential content, and proprietary instructions before review.
- [x] Aggregated signals include minimum cohort/privacy policy before cross-tenant use.
- [x] User preference export/reset does not alter tenant policy or shared runtime evidence required for audit.

## Memory and context

- [x] Memory scope links remain linkage evidence, not runtime authorization.
- [x] Memory retrieval uses tenant/user/workspace/brand/activity/role scope.
- [x] Personal memories cannot become tenant or platform policy without explicit promotion.
- [x] Effective manifests disclose source categories without leaking another principal's private values.

## Retention and deletion

- [x] Profiles, variants, proposals, experiments, and ledgers have explicit lifecycle states.
- [x] Preference deletion/reset semantics are separate from immutable security/audit evidence.
- [x] Expired proposals and canaries cannot affect future resolution.
- [x] Retention policies must preserve regulatory/audit requirements without retaining unnecessary personal detail.
- [ ] Data retention periods approved by policy owners.
- [ ] Subject export/deletion tests implemented.

## Invitation, membership, and personal-context isolation

- [x] An invitation targets exactly one Tenant and cannot create or modify another Tenant.
- [x] Exact Brand/Workspace/Department/Group/Role/resource scopes are tenant- and object-bound.
- [x] Accepting one invitation cannot change memberships or grants in unrelated Tenants.
- [x] A personal-account Tenant and personal Workspace are separate from company Tenants and hidden from their administrators.
- [x] Company resources, artifacts, knowledge, connections, and credentials cannot be copied into personal space without explicit authorized policy.
- [x] Active context contains one Tenant boundary and cannot aggregate unrelated Tenant data implicitly.
- [x] Context switching revalidates current membership, grants, Brand/Workspace scope, and authority epoch.
- [x] Revocation invalidates only affected Tenant contexts and preserves unrelated personal/company contexts.
- [x] Public invitation preview reveals only safe labels and no private member, asset, credential, or data details.
- [x] Identity-provider linkage does not grant Tenant membership or resource access by itself.
- [ ] Cross-Tenant invitation token substitution tests implemented.
- [ ] Personal/company data crossover and context-confusion tests implemented.

## Tenant and Workspace isolation

- [x] Every Workspace has exactly one owning Tenant and cannot move across Tenants by rebinding.
- [x] Workspace Brand, Department, Group, Activity, Agent, and resource bindings reference objects in the same Tenant.
- [x] Workspace grants never create Tenant membership or cross-Tenant authority.
- [x] Owning one Tenant does not expose Workspaces or resources in another Tenant.
- [x] Personal-account Workspaces are invisible to company Tenant administrators.
- [x] Company resources cannot be copied into personal space without explicit export/copy policy, authorization, provenance, and data-governance review.
- [x] Multi-Brand Workspaces remain inside one Tenant and preserve Brand-specific policy and access boundaries.
- [x] Active context identifies one Tenant boundary and prevents implicit mixed-Tenant views.
- [x] Workspace archive/deletion preserves required audit and disposes only scoped operational dependencies.
- [x] Tenant offboarding enumerates and processes every owned Workspace.
- [ ] Same-Tenant binding and cross-Tenant rejection tests implemented for every Workspace binding type.
- [ ] Personal/company isolation and multi-Brand data-separation tests implemented.

## Blueprint inheritance and Brand isolation

- [x] Business-Type Blueprints are reusable templates and contain no Brand credentials, memberships, or private content by default.
- [x] Every inherited operational instance begins with tenant and Brand scope.
- [x] Brand layer relationships and closure never traverse into another Brand.
- [x] Shared resource bindings store canonical references and provenance, not copied tenant data.
- [x] Brand-local overrides remain tenant/Brand scoped and cannot modify another Brand's inherited instance.
- [x] Member and Agent profile assignments validate the same tenant/Brand/Department/Group before authority resolution.
- [x] Knowledge inheritance references only data whose audience, purpose, residency, and Brand policy permit use.
- [x] Cross-Brand learning or Blueprint promotion never copies raw Brand content automatically.
- [x] Removing a Business-Type binding preserves or disposes Brand-local data according to an approved plan; it never deletes canonical shared assets.
- [x] Export/import preserves Blueprint and canonical source references while remapping Brand-scoped instance IDs safely.
- [x] Backup/restore validates Brand and Blueprint provenance and rejects cross-Brand reference corruption.
- [ ] Brand inheritance crossover test suite implemented for every layer family.
- [ ] Knowledge/resource binding audience and residency tests implemented.

## Federation, lifecycle, and portability

- [x] Parent/partner/managed-client/white-label relationships require explicit delegated scope.
- [x] Group and service identities remain tenant-bound and cannot resolve cross-tenant members implicitly.
- [x] Tenant ownership transfer and offboarding include connection, grant, variant, approval, schedule, artifact, and export disposition.
- [x] Tenant and user exports are no-secret, checksummed, scope-authorized, and auditable.
- [x] Imports validate tenant ownership, stable IDs, conflicts, schema compatibility, and prohibited references.
- [x] Legal hold blocks deletion without granting new access.
- [x] Erasure propagation covers preferences, adaptive evidence, derived artifacts, and indexes subject to minimal audit retention.

## Data location and model use

- [x] Residency and jurisdiction restrict storage, indexing, model, provider, and connector eligibility.
- [x] Environment and region bindings are validated before credential materialization.
- [x] Model routing cannot move tenant content to an ineligible provider or region through fallback.
- [x] Simulation and evaluation corpora remain tenant-scoped unless an approved aggregate dataset is used.
- [x] Cross-tenant aggregation uses minimum cohorts, privacy policy, weighting, and opt-out controls where applicable.

## Purpose-bound data isolation

- [x] Every data-use decision is scoped to one authenticated Tenant context plus exact Brand/Workspace/resource/subject evidence where applicable.
- [x] Access authority does not bypass purpose, classification, lawful-basis/consent, residency/transfer, retention, legal-hold, provider/model, audience, or destination policy.
- [x] Classification assignments and purpose rules cannot reference another Tenant's private resource or policy authority.
- [x] Personal and company contexts cannot silently exchange restricted data even when the same global user owns or belongs to both Tenants.
- [x] Data-subject discovery and lineage traversal remain Tenant/object scoped and reject cross-Tenant edges.
- [x] Correction, restriction, erasure, and consent-withdrawal propagation cannot mutate another Tenant's summaries, embeddings, indexes, Agent memory, evaluations, artifacts, provider copies, or backups.
- [x] Legal hold scope is exact and cannot be used to discover or read data outside existing authority.
- [x] Provider/model candidate selection removes ineligible regions, recipients, training modes, retention modes, and destinations before content or credentials are materialized.
- [x] Raw cross-Tenant content is never an aggregate-learning input or output.
- [x] Aggregate-learning evidence carries cohort, participation, contribution, privacy, residency, provenance, quality, and fairness versions without exposing Tenant-specific examples.
- [x] Data-use and governance-epoch cache keys prevent a decision from one Tenant, purpose, subject, destination, or policy version being reused in another.
- [ ] Cross-Tenant lineage corruption, provider-copy, backup, and aggregate-learning isolation tests implemented.
- [ ] Personal/company copy, export, correction, and erasure boundary tests implemented.

## Commercial and metering isolation

- [x] Every billing account, profile, meter event, estimate, reservation, settlement, ledger account, statement, invoice, dispute, and attribution row carries exact Tenant and billing-account scope.
- [x] A billable owner differing from the execution Tenant requires a direct active commercial relationship and grants no data or resource access.
- [x] Billing-profile discovery and customization expose only options allowed for the signed principal and exact billing account/context.
- [x] Profile selections, budgets, alerts, attribution tags, included units, and meter rules cannot reference another Tenant's private objects or pricing terms.
- [x] Meter event source context includes exact Tenant, account, operation, manifest, meter/version, unit, and deduplication scope.
- [x] The same source event cannot create billable usage in more than one Tenant or billing account.
- [x] Composite meter components cannot traverse cross-Tenant raw usage or reveal another Tenant's technical consumption.
- [x] Shared meter/unit/rating definitions contain no Tenant-private price or usage values; price books and contracts remain scoped.
- [x] Direct billing relationships are non-transitive and cannot cause a parent, manager, reseller, or white-label Tenant to inherit another relationship automatically.
- [x] Cost attribution to Brand, Workspace, Department, Group, campaign, objective, principal, or project grants no liability, authority, or content visibility.
- [x] Credits, monetary balances, included units, quotas, budgets, and postpaid limits cannot be reserved or settled across billing accounts without an explicit governed transfer/conversion contract.
- [x] Ledger entries and balance projections use Tenant/account-leading keys and reject cross-account debit/credit lines except registered Platform clearing transactions.
- [x] Statements and invoices expose only the caller's authorized account, safe meter labels, and scoped evidence; provider/internal costs remain protected unless policy allows disclosure.
- [x] Usage disputes and refunds cannot enumerate or mutate another Tenant's events, settlements, or ledger entries.
- [x] Commercial epoch and profile cache keys prevent decisions from one Tenant/account/profile/model/price version being reused in another.
- [ ] Cross-Tenant meter replay, billing-owner confusion, profile leakage, invoice enumeration, and ledger cross-posting tests implemented.
- [ ] Managed-service and reseller billing isolation tests implemented for direct and non-transitive relationships.

## Model governance isolation

- [x] Every model preference, selection decision, candidate evidence row, fallback set, evaluation run, scorecard, readiness snapshot, and incident/deprecation scope carries exact Tenant/context or explicit Platform ownership.
- [x] Candidate discovery returns only options eligible for the signed principal's Tenant, plan, data policy, region, risk, commercial account, and exact context.
- [x] A shared model/provider/capability definition contains no Tenant-private prompt, usage, price term, evaluation sample, preference, or credential value.
- [x] Tenant-scoped optimization preferences and model pins cannot affect another Tenant or Platform defaults.
- [x] Evaluation datasets and results apply object-level authority, purpose, sensitivity, residency, retention, and audience policy before access or reuse.
- [x] Cross-Tenant aggregate quality evidence may be used only through approved privacy-governed aggregation and cannot expose raw Tenant content or identifiable examples.
- [x] Provider endpoint profiles and readiness snapshots expose only no-secret status and exact eligible scope; credential values remain in connection/vault authorities.
- [x] Candidate evidence and explanations redact hidden provider contract terms and another Tenant's private commercial or evaluation data.
- [x] A model-selection decision from one Tenant/context/account cannot be reused in another because cache/manifest identity includes Tenant, principal, context, data-use decision, commercial refs, and governance epoch.
- [x] Fallback sets are bound to the same Tenant/context/capability/data/commercial scope and cannot cross to another Tenant's endpoint, credential, reservation, or policy.
- [x] Managed-service, reseller, parent, support, or white-label relationships do not imply access to client model preferences, evaluation data, readiness, prompts, or credentials.
- [x] Model run and outcome evidence remains Tenant-scoped even when the same shared model version is used across multiple Tenants.
- [x] Historical selection evidence preserves exact scope and cannot be globally exposed merely because a model becomes deprecated or retired.
- [x] Model incident restrictions may be Platform-wide or exactly scoped but never silently broaden Tenant data visibility.
- [ ] Cross-Tenant candidate-list leakage, preference reuse, evaluation-sample exposure, readiness inference, fallback substitution, and selection-cache poisoning tests implemented.
- [ ] Managed-service and shared-provider isolation tests implemented for model selection, runs, outcomes, and commercial reservations.

## Durable Workflow and Effect isolation

- [x] Every Workflow, Activity, Attempt, Effect, timer, signal, dependency, checkpoint, recovery case, replay, queue assignment, lease, and transport record carries exact Tenant ownership or explicit Platform scope.
- [x] Workflow history, idempotency, cache, queue, and replay identities include Tenant/account, principal/context, Workflow/Effect type, target resource, manifest, and governance epochs.
- [x] A Workflow, checkpoint, Activity result, Effect reference, reservation, or recovery case from one Tenant cannot be reused under another Tenant.
- [x] Child Workflows inherit the parent Tenant and cannot cross Tenant boundaries through dependencies, signals, callbacks, or compensation.
- [x] Shared Workflow/Activity/Effect definitions contain no Tenant-private input, prompt, output, provider reference, commercial term, or credential value.
- [x] History and Effect explanations expose only object-authorized safe evidence and redact private payloads, credentials, hidden provider headers, and another Tenant's state.
- [x] Outbox/Inbox consumer keys, queue assignments, leases, fencing tokens, and dead letters preserve Tenant/resource scope and cannot deduplicate or redrive across Tenants.
- [x] Signals and callbacks validate target Workflow Tenant/context and sender authority before appending history.
- [x] Recovery operators see only cases within delegated scope; managed-service/support relationships do not imply raw history, payload, Effect, or credential access.
- [x] Compensation and replay remain bound to original Tenant ownership, known Effects, current manifest, and exact commercial account.
- [x] Model fallback checkpoints expose only authorized verified state and remaining work, never credential values or another Candidate/Tenant's hidden context.
- [x] Cross-Tenant fairness may use privacy-safe aggregate queue metrics but cannot expose Workflow payloads or allow one Tenant to claim another Tenant's work.
- [x] Platform-wide incidents may restrict handler/Effect types globally without broadening Tenant data visibility.
- [x] Historical Workflow evidence retains its original Tenant/context even after deletion, retirement, replay, or migration, subject to DFR-003 retention/disposition rules.
- [ ] Cross-Tenant idempotency collision, queue claim, signal spoof, checkpoint reuse, replay, compensation, recovery-case disclosure, and dead-letter redrive tests implemented.
- [ ] Managed-service and shared-provider isolation tests implemented across Workflow history, Effects, reservations, model fallback, and manual recovery.

## Verifiable Artifact, Knowledge, and Provenance isolation

- [x] Every Artifact, Version, Content Object, Representation, Source, Attestation, Claim, Citation, Trust Assessment, Policy Envelope, Knowledge Build, Retrieval Evidence, Correction, Retraction, and Disposition record carries exact Tenant ownership or explicit Platform scope.
- [x] Shared logical definitions contain no Tenant-private payloads, signing secrets, restricted source evidence, private citations, or customer-specific policy terms.
- [x] Artifact/version identity, checksums, cache keys, index memberships, retrieval evidence, and governance epochs include Tenant/scope where required and cannot collide across Tenants.
- [x] One Tenant cannot attach, cite, index, embed, retrieve, correct, retract, disposition, export, or publish another Tenant's Artifact Version without an explicit authorized cross-boundary contract and eligible data/license policy.
- [x] Provenance graph traversal applies object authorization at every node/edge and returns scoped not-found or selectively disclosed evidence rather than graph-shape leakage.
- [x] Claims and citations expose only eligible source content/locators; opaque evidence references do not become a side channel to private identities or URLs.
- [x] Public/Tenant/operator/auditor/legal/regulator provenance projections are independently authorized and checksummed.
- [x] Trust scores, confidence, verification, and source classes cannot reveal another Tenant's raw evidence, usage, model prompts, contractual terms, or reviewer identity.
- [x] Knowledge chunks, embeddings, indexes, and retrieval candidates retain exact Tenant/purpose/audience/license/residency policy and cannot mix unauthorized source memberships.
- [x] Cross-Tenant aggregate knowledge requires DFR-003 approved purpose/cohort/privacy controls and never exposes raw Tenant content or Tenant-specific examples.
- [x] Correction/retraction/invalidation propagates only through authorized dependency edges while still blocking affected hidden descendants from use.
- [x] Erasure removes eligible content from primary and derived surfaces while minimal tombstones retain no erased payload and remain access-controlled.
- [x] Legal Hold prevents scoped disposition but grants no provenance/content/index/retrieval read authority.
- [x] Source/signing identities and transparency witnesses may be shared only through approved disclosure profiles; raw key material is never Tenant-visible.
- [x] Compatibility projections from output/JSON/Drive/graph/memory stores preserve original Tenant/scope and do not promote unknown ownership to Platform-global.
- [x] Provider/model/index/storage adapters receive only manifest-authorized Artifact Versions and no credentials or unrelated Tenant evidence.
- [ ] Cross-Tenant provenance traversal, citation inference, checksum collision, scope-link misuse, index-membership poisoning, retrieval leakage, correction/retraction, erasure tombstone, and export tests implemented.
- [ ] Shared source, managed-service, auditor, legal, regulator, and cross-Tenant aggregate disclosure tests implemented across all projections.

## Artifact and recovery isolation

- [x] Provenance exposes safe source IDs/evidence without another tenant's private content.
- [x] Correction/retraction/erasure propagation never crosses tenant boundaries accidentally.
- [x] Backup and restore preserve tenant ownership and validate no cross-tenant reference after recovery.
- [x] Disaster/degraded modes cannot widen tenant or data access.

## Verification

- [ ] Cross-tenant list/get/search/mutation tests pass for every new resource.
- [ ] Inference and promotion pipelines pass privacy review.
- [ ] Query plans and indexes confirm tenant-leading lookups.
- [ ] No-secret scans pass across database, logs, OpenAPI examples, and runtime responses.
