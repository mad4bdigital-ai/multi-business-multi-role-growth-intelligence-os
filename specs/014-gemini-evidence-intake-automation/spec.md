# Feature Specification: Gemini Evidence Intake and Development Automation

**Branch**: `gpt/spec-014-gemini-evidence-automation-20260801`  
**Created**: 2026-08-01  
**Status**: Draft; implementation blocked pending clarification and Work Map readiness  
**Delivery**: `multi_pr`  
**Spec owner**: platform-team

## Problem and verified baseline

The business workflow requires team members, clients, and bounded partners to submit links, screenshots, images, audio, video, documents, observations, and structured survey responses. The intended operating model requires stable evidence identity, original-file preservation, deterministic naming, sensitivity handling, duplicate detection, classification, Drive routing, CRM/Research/Audit linkage, review, and audit history.

The current external operating artifacts include a Google Sheets CRM/operations workbook, a Forms registry and field dictionary, raw intake and error logs, Apps Script source drafts, an evidence operating guide, and a Father Spec document. Those external documents are product inputs, not repository runtime authority and do not themselves authorize code, provider calls, Google Workspace mutations, or deployment.

The repository already provides specification governance, Work Map integration, repository automation, capability/approval boundaries, durable state patterns, tenant/Brand authority, exact-head CI evidence, and completion gates. This feature must reuse those authorities rather than create a parallel ungoverned automation system.

## Objective

Create a repository-native, machine-readable contract that can drive bounded development planning and later implement a governed multimodal evidence-intake subsystem using Gemini as a replaceable analysis provider.

The result must allow automation to answer:

1. What requirement is being implemented?
2. Which actor, tenant, workspace, Brand, account, and resource scopes apply?
3. Which task and implementation wave owns it?
4. Which code, schema, API, migration, and documentation surfaces may change?
5. Which approvals and policy gates are required?
6. Which tests and evidence prove completion?
7. What remains blocked or unresolved?
8. How can execution resume without replaying completed mutations?

## Scope

### Included

- Repository-native development automation contract and JSON Schema.
- Evidence, intake, AI-job, AI-result, prompt, model, review, and usage-link state contracts.
- Google Forms/Sheets/Drive integration boundaries as external adapters.
- Gemini multimodal extraction, classification, summarization, structured output, and embedding boundaries.
- Human review and override lifecycle.
- Tenant/workspace/Brand/account/resource binding.
- Idempotency, retries, unknown outcomes, dead-letter handling, audit, and readback.
- Privacy, sensitivity, consent, retention, no-secret, and data-minimization controls.
- Multi-PR implementation-wave planning.
- Acceptance, security, operations, rollout, rollback, and closeout requirements.

### Excluded

- No runtime implementation in this specification PR.
- No Gemini API call or API key creation.
- No Google Form, Sheet, Drive folder, trigger, or permission mutation.
- No database migration or registry activation.
- No provider credential ingestion.
- No production deployment or branch promotion.
- No autonomous approval, deletion, access grant, external publish, or financial decision by a model.
- No model fine-tuning on client content in the first release.
- No replacement of Drive as canonical file storage during the pilot.
- No replacement of SQL/runtime registries by external Sheets.

## Work Map integration and dimension discovery

`work-map-integration.json` binds this feature to the complete current Work Map index and domain registry. Implementation remains blocked while any relevant decision is `needs_analysis`, any schema dimension is unresolved, or the registry fingerprint is stale.

Existing maps must be reused or extended before proposing a new map. This feature is expected to integrate or reuse, at minimum:

- activation access and onboarding;
- connector/provider boundaries;
- data-model domains;
- execution logs and evidence;
- platform resources and graph authority;
- policy and approval authority;
- workflow/task orchestration;
- observability/release;
- repository automation and development;
- migration lifecycle when persistent runtime state is introduced.

## Actors and authority

| Actor | Principal/auth mode | Allowed responsibilities | Forbidden overrides |
|---|---|---|---|
| Team submitter | Signed user principal | Submit evidence for authorized scope; read own receipt | Tenant, Brand, account, sensitivity, approval, or target-resource override |
| Client respondent | Bound client intake identity/link | Submit assigned survey and permitted files | Internal IDs, other-account access, credentials, approval authority |
| Reviewer | Signed principal plus reviewer capability | Approve, reject, reclassify, request clarification, merge candidate records | Cross-tenant access, silent deletion, provider credentials |
| Platform admin | Admin principal plus action capability | Manage prompts, models, policies, queues, repair, and governed configuration | Bypass typed confirmation, nested authority, readback, or no-secret policy |
| Evidence worker | Service principal | Process one authorized job and write bounded result/receipt | Resolve user identity from payload overrides; grant access; approve result |
| Gemini provider | External provider through adapter | Return bounded model output | Direct runtime authority, direct repository/Drive/database mutation |
| Repository automation | Governed orchestration principal | Read contract, plan work, generate bounded work packets, collect evidence | Invent approvals, mutate outside declared scope, declare completion without evidence |

## User journeys

### US1 — Generate a bounded development work packet (P1)

**Given** a valid `development-automation.json`, current Work Map fingerprint, and resolved dependencies  
**When** repository automation selects a ready task or wave  
**Then** it produces a deterministic work packet with requirement refs, allowed files/surfaces, forbidden actions, required tests, required authority, acceptance evidence, rollback posture, and resume key.

### US2 — Submit evidence without exposing technical IDs (P1)

**Given** a user is authenticated or holds a bounded client intake link  
**When** the user submits text, link, or permitted file  
**Then** the system creates an idempotent intake receipt, resolves scope from authority, preserves the original, and returns a status reference without requiring the user to choose internal folders or IDs.

### US3 — Process evidence through Gemini safely (P1)

**Given** an evidence record passes sensitivity, consent, file, budget, and model-policy gates  
**When** an AI job is dispatched  
**Then** the provider result is validated against a pinned schema and semantic policy, stored as a proposal, and never treated as approval or authoritative evidence by itself.

### US4 — Human review and promotion (P1)

**Given** a valid evidence record and proposed AI analysis  
**When** an authorized reviewer acts  
**Then** the system records the decision, overrides, reason, identity, timestamp, and resulting links or promotion while preserving the original and full audit trail.

### US5 — Recover from uncertain provider or storage outcomes (P1)

**Given** a timeout or transport failure occurs after dispatch  
**When** outcome is unknown  
**Then** the system performs same-operation readback before retry, prevents blind duplicate execution, and moves exhausted cases to a repairable dead-letter state.

### US6 — Operate without Gemini (P2)

**Given** Gemini is disabled, unavailable, unsafe, or over budget  
**When** an intake is submitted  
**Then** the system preserves intake, creates a manual review path, and does not lose or misclassify the submission as successfully analyzed.

## Operation paths

See `operation-paths.md` for:

- OP-001 development work-packet planning;
- OP-002 evidence intake and registration;
- OP-003 AI job dispatch and structured-result validation;
- OP-004 human review and promotion;
- OP-005 duplicate candidate and canonical merge;
- OP-006 clarification request and response;
- OP-007 model/prompt/configuration publication;
- OP-008 failure recovery and dead-letter replay;
- OP-009 rollout, production verification, and rollback.

## Functional requirements

### Development automation contract

- **FR-001** The feature MUST provide a JSON Schema-valid machine-readable contract linking goals, requirements, operation paths, tasks, implementation waves, dependencies, gates, evidence, rollout, rollback, and open decisions.
- **FR-002** Every automated task MUST have an immutable task key, requirement refs, acceptance refs, dependency refs, owner class, allowed change surfaces, forbidden mutations, required tests, and completion evidence.
- **FR-003** Automation MUST fail closed when a referenced requirement, task, acceptance criterion, contract, operation path, or dependency does not exist.
- **FR-004** Automation MUST distinguish `draft`, `ready`, `blocked`, `in_progress`, `implemented`, `verified`, and `closed` lifecycle states.
- **FR-005** A task MUST NOT become `ready` while any blocking decision, dependency, Work Map dimension, security gate, or contract freeze is unresolved.
- **FR-006** Work packets MUST bind repository, branch/base intent, spec key, task key, requirement set, allowed paths, prohibited actions, expected evidence, and a stable plan hash.
- **FR-007** Automation MUST NOT treat the development contract as mutation authority.
- **FR-008** Automation MUST preserve idempotent resume checkpoints and avoid regenerating or replaying already verified work.
- **FR-009** Completion automation MUST read `tasks.md`, checklists, contract state, PR/CI evidence, and required post-merge evidence before declaring completion.
- **FR-010** Generated reports MUST identify implemented, verified, blocked, deferred, and unowned work separately.

### Context, identity, and evidence intake

- **FR-011** Every intake MUST resolve authenticated principal or bounded client-link identity before accepting mutable scope.
- **FR-012** Tenant, workspace, Brand, account, project, and target-resource identities MUST come from canonical authority or a signed/bound context; caller overrides are forbidden.
- **FR-013** Every accepted submission MUST receive an `INTAKE_ID`, idempotency key, source identity, form/version identity, submission timestamp, and processing status.
- **FR-014** Every evidence object MUST receive an immutable `EVIDENCE_ID` and preserve original name, source link, capture time, uploader, MIME type, size, canonical storage reference, and sensitivity metadata.
- **FR-015** Intake response latency MUST NOT depend on completion of Gemini processing.
- **FR-016** Duplicate form events or replayed client requests MUST return the prior receipt or deterministically resume the existing operation.
- **FR-017** The system MUST separate verbatim content, observation, interpretation, hypothesis, and recommendation.
- **FR-018** The system MUST support one canonical evidence object with multiple governed usage links.

### File lifecycle and classification

- **FR-019** The system MUST preserve the canonical original before rename, route, derivative generation, or provider upload.
- **FR-020** File naming MUST be generated from validated metadata and sanitized; a model may propose tokens but MUST NOT control extension, storage authority, or overwrite behavior.
- **FR-021** The system MUST compute deterministic file or content fingerprints where supported and normalize source URLs.
- **FR-022** Exact duplicates MUST be detected deterministically; semantic similarity MUST create candidates only.
- **FR-023** Potential duplicates MUST NOT be deleted automatically and MUST retain canonical-candidate relationships and reviewer decisions.
- **FR-024** Unresolved, sensitive, unsupported, or ambiguous items MUST route to explicit quarantine, restricted, unsorted, or review states rather than silent fallback.
- **FR-025** File movement, shortcut creation, rename, and access changes MUST be auditable, idempotent, bounded to authorized resources, and verified by readback.

### AI job and provider boundary

- **FR-026** Every provider operation MUST be represented by an `AI_JOB_ID` with job type, policy profile, input manifest, prompt/schema/model versions, status, attempts, cost, timing, safety result, and trace ID.
- **FR-027** Gemini MUST be accessed through a provider abstraction; product contracts MUST use logical model tiers rather than hard-coded preview aliases.
- **FR-028** Production provider calls MUST use a backend-to-backend boundary with secrets outside Sheets, Forms, client code, logs, and model-visible payloads.
- **FR-029** Each AI use case MUST declare permitted modalities, maximum input policy, sensitivity policy, consent requirement, budget class, model tier, output schema, semantic validators, and fallback path.
- **FR-030** Structured output MUST validate against JSON Schema before any downstream interpretation.
- **FR-031** Semantic validation MUST reject unknown enums, invalid routes, impossible dates/numbers, missing verbatim provenance, unsupported authority claims, or policy-conflicting suggestions.
- **FR-032** Function calling MUST return a bounded proposal/intent; execution remains in governed application code with independent authorization and readback.
- **FR-033** Model output MUST remain proposed until an explicit deterministic rule or authorized human decision permits a bounded state transition.
- **FR-034** Provider timeouts and transient failures MUST use bounded retry with readback and jittered backoff; unknown outcomes MUST NOT be blindly replayed.
- **FR-035** The system MUST support provider-disabled and manual-review modes without losing submissions.

### Review, promotion, and downstream linkage

- **FR-036** Review actions MUST require object-level authority and record actor, decision, rationale, overrides, prior state, resulting state, and evidence refs.
- **FR-037** The system MUST support approve, approve-with-change, reject, request-clarification, reclassify, merge-candidate, archive, and escalate decisions.
- **FR-038** AI proposals MUST NOT approve Audit findings, financial values, access grants, external publishing, deletion, or sensitive routing.
- **FR-039** Promotion to Research, Audit, Hypothesis, Activity, Task, Opportunity, or Report MUST use distinct typed links and preserve source lineage.
- **FR-040** Client statements MUST remain distinguishable from independently verified facts.
- **FR-041** Clarification requests MUST ask only for missing/ambiguous information and bind the reply to the original intake/evidence context.

### Governance, lifecycle, and observability

- **FR-042** Prompts, schemas, model aliases, policies, and routing rules MUST be versioned, immutable when active, reviewable, and rollback-capable.
- **FR-043** Every active model alias MUST resolve to an allowed provider/model with verified capability, benchmark, cost profile, and fallback posture.
- **FR-044** Every operation MUST expose bounded reason codes, lifecycle states, trace IDs, and authoritative evidence references without secrets or unnecessary personal data.
- **FR-045** The system MUST maintain cost, latency, schema-failure, safety-block, retry, human-override, duplicate, clarification, and evidence-utilization metrics.
- **FR-046** Daily and monthly budgets MUST support warning, degradation, and hard-stop thresholds per environment and permitted scope.
- **FR-047** Retention and deletion workflows MUST distinguish canonical source, provider-temporary object, derived result, audit evidence, and legal/contractual hold.
- **FR-048** Restricted data MUST be denied external-provider processing by default unless a separately approved policy explicitly permits the use case.
- **FR-049** No secret, token, authorization header, signed URL, raw credential, or unbounded provider payload may appear in contracts, model prompts, logs, test fixtures, or completion evidence.
- **FR-050** All new persistent entities MUST be classified into existing schema domains and Work Maps before implementation readiness.
- **FR-051** Rollout MUST support disabled, internal, shadow, pilot, canary, and production states with bounded rollback.
- **FR-052** Closeout MUST verify exact-head CI, contract parity, migration evidence if applicable, production/main parity, health, runtime smoke, fallback, unresolved backlog, and documentation alignment.

## Non-functional requirements

- **NFR-001 Security**: default deny, least privilege, explicit audience/resource binding, and no caller-controlled scope identity.
- **NFR-002 Privacy**: data minimization, purpose limitation, sensitivity policy, consent evidence, retention, and redaction.
- **NFR-003 Availability**: intake remains available when the provider is degraded; heavy processing is asynchronous.
- **NFR-004 Durability**: accepted intake and mutation receipts survive worker restarts and provider failures.
- **NFR-005 Idempotency**: unsafe retryable operations use durable identity and deterministic replay behavior.
- **NFR-006 Performance**: bounded synchronous intake response; bounded list/search/result payloads.
- **NFR-007 Observability**: traceable lifecycle, structured reason codes, metrics, alerts, and no-secret diagnostics.
- **NFR-008 Compatibility**: additive contracts and migrations first; existing CRM/Research/Audit consumers remain compatible during pilot.
- **NFR-009 Portability**: provider abstraction supports Gemini replacement without changing product-level state contracts.
- **NFR-010 Testability**: deterministic policy and state logic is separable from external adapters.
- **NFR-011 Arabic quality**: Arabic and mixed Arabic/English content remain supported and benchmarked.
- **NFR-012 Accessibility**: client/team intake must remain usable from mobile and not expose internal identifiers.
- **NFR-013 Cost control**: model routing, caching, reuse, batching where safe, and budget enforcement are measurable.
- **NFR-014 Bounded retries**: retry count, delay, and dead-letter transition are explicit.
- **NFR-015 Recovery**: repair and replay actions operate from durable checkpoints and prior readback.
- **NFR-016 Auditability**: model, prompt, schema, policy, input manifest hash, human decision, and state transition are attributable.
- **NFR-017 Isolation**: queues, caches, storage, search, and embeddings are scope-bound.
- **NFR-018 Explainability**: users and reviewers receive bounded reason and provenance, not hidden authority claims.
- **NFR-019 Configuration safety**: no unrestricted executable code is stored as prompt/routing/configuration authority.
- **NFR-020 Operational fallback**: a documented manual path exists and is tested before production.

## State and data requirements

See `data-model.md`. Core proposed entities:

- `IntakeSubmission`
- `EvidenceRecord`
- `EvidenceUsageLink`
- `AIJob`
- `AIResult`
- `ReviewDecision`
- `PromptDefinition`
- `ModelDefinition`
- `ProviderFileLease`
- `ClarificationRequest`
- `AutomationWorkPacket`
- `AutomationCheckpoint`

SQL/runtime registries will be authoritative if implementation introduces persistent platform state. External Sheets remain adapter inputs, mirrors, and operational views only.

## Contracts

- `contracts/development-automation.schema.json`
- `development-automation.json`
- `contracts/gemini-evidence-result.schema.json`
- `contracts/gemini-evidence-gateway.openapi.yaml`

OpenAPI is draft-only and does not create a callable route. Generated canonical OpenAPI must be changed through repository generators in an implementation PR.

## Error taxonomy

| Code | Status | Stage | Retryable | User/operator action | Readback |
|---|---:|---|---|---|---|
| `EVIDENCE_CONTEXT_MISSING` | 422 | intake | no | select/repair authorized context | principal/resource authority |
| `EVIDENCE_SCOPE_FORBIDDEN` | 403 | intake/review | no | request access | policy and resource authority |
| `EVIDENCE_DUPLICATE_EVENT` | 200/409 | intake | no | use prior receipt | intake idempotency record |
| `EVIDENCE_FILE_UNSUPPORTED` | 422 | file policy | no | submit permitted type/link | file policy registry |
| `EVIDENCE_SENSITIVITY_BLOCKED` | 403 | provider policy | no | manual/restricted workflow | sensitivity policy decision |
| `AI_BUDGET_EXCEEDED` | 429 | dispatch | later | manual review/wait for budget | cost ledger |
| `AI_PROVIDER_RATE_LIMITED` | 503 | provider | yes | automatic bounded retry | job attempt/readback |
| `AI_PROVIDER_OUTCOME_UNKNOWN` | 202 | provider/readback | conditional | reconcile before replay | provider operation fingerprint |
| `AI_SCHEMA_INVALID` | 422 | result validation | maybe with changed prompt | repair prompt/model/schema | stored raw bounded result hash |
| `AI_SEMANTIC_INVALID` | 422 | semantic validation | no automatic replay | human review or corrected job | validation findings |
| `AI_SAFETY_BLOCKED` | 422 | provider safety | no | manual path/policy review | provider safety metadata |
| `REVIEW_DECISION_CONFLICT` | 409 | review | no | refresh and reapply | current record version |
| `AUTOMATION_CONTRACT_INVALID` | 422 | planning | no | repair schema/reference | contract validator |
| `AUTOMATION_TASK_BLOCKED` | 409 | planning | no | resolve blockers | dependency/decision state |
| `AUTOMATION_EVIDENCE_INCOMPLETE` | 409 | verification | no | collect required evidence | PR/CI/runtime authorities |

## Security and privacy

- Authentication and authorization are separate gates.
- Scope derives from signed principal/resource authority.
- Client links must be bounded, expiring where appropriate, non-enumerable, revocable, and purpose-limited.
- API keys and credentials are stored only in approved secret authorities.
- Input manifests minimize data and record purpose.
- Prompt injection inside a document/image/audio/video is treated as untrusted content, never system instruction.
- Provider output is untrusted input.
- Restricted data is provider-denied by default.
- Logs store identifiers, hashes, reason codes, and bounded metadata rather than raw sensitive payloads.
- Cross-tenant, wrong-Brand, wrong-resource, confused-deputy, replay, privilege-expansion, and public-link abuse cases require tests.

## Observability and evidence

Required identifiers:

- `TRACE_ID`
- `REQUEST_ID`
- `INTAKE_ID`
- `EVIDENCE_ID`
- `AI_JOB_ID`
- `AI_RESULT_ID`
- `REVIEW_DECISION_ID`
- `WORK_PACKET_ID`
- `OPERATION_FINGERPRINT`

Required evidence distinguishes:

- validation;
- accepted intake;
- provider dispatch;
- provider completion;
- schema/semantic validation;
- human review;
- downstream linkage;
- delivery/acknowledgement;
- rollback/compensation.

## Rollout, rollback, and compatibility

Proposed rollout:

1. Contracts and validators only.
2. SQL/state and internal adapters behind disabled flags.
3. Text and small non-sensitive screenshot shadow processing.
4. Internal pilot with mandatory review.
5. Selected client pilot.
6. Audio/video and embeddings separately enabled.
7. Production canary by tenant/Brand/cohort.
8. Broad production only after benchmark, cost, privacy, fallback, and operator readiness gates.

Rollback disables dispatch first, preserves intake and evidence, drains or pauses queues, revokes temporary provider files, restores prior prompt/model/policy versions, and verifies manual processing remains available.

## Success criteria

- **SC-001** The development automation instance validates against its JSON Schema.
- **SC-002** Every task resolves to existing requirements, acceptance criteria, operation paths, and dependencies.
- **SC-003** Automation can generate deterministic ready/blocked work packets without mutation authority.
- **SC-004** New evidence intake is idempotent under duplicate delivery.
- **SC-005** Original files are preserved and no automatic duplicate deletion occurs.
- **SC-006** Wrong-tenant/Brand/resource tests deny before file/provider access.
- **SC-007** Gemini output cannot directly approve, grant access, delete, publish, or mutate protected resources.
- **SC-008** Invalid schema or semantic output never reaches downstream operational state.
- **SC-009** Provider outage does not lose accepted intake.
- **SC-010** Unknown outcome is reconciled before retry.
- **SC-011** Restricted input is blocked from provider dispatch by default.
- **SC-012** Every AI result records model, prompt, schema, policy, and input-manifest lineage.
- **SC-013** Manual fallback completes a representative intake-to-review journey.
- **SC-014** Human overrides are attributable and preserved.
- **SC-015** Cost and latency are measurable by use case and scope.
- **SC-016** A representative Arabic/mixed-language golden set meets agreed quality thresholds.
- **SC-017** Rollback disables AI dispatch without losing intake or evidence.
- **SC-018** Closeout cannot report complete without required exact-head and production evidence.

## Open questions

- **OD-001** Choose pilot and production gateway runtime; owner: platform architecture; due before runtime planning.
- **OD-002** Approve policy for `Client Confidential` data sent to external providers; owner: privacy/security; due before provider integration.
- **OD-003** Approve retention periods for originals, provider files, results, embeddings, logs, and audit evidence; owner: privacy/operations; due before data-model implementation.
- **OD-004** Set daily/monthly budgets and hard-stop behavior; owner: product/finance/platform; due before provider pilot.
- **OD-005** Select pinned stable models after use-case benchmark; owner: AI/platform; due before production model registry activation.
- **OD-006** Choose pilot review UI and production review surface; owner: operations/platform; due before reviewer workflow implementation.
- **OD-007** Define maximum file size/duration and direct-upload versus Drive-link policy; owner: platform/operations; due before form/file adapter implementation.
- **OD-008** Decide embedding storage authority and deletion semantics; owner: data/platform; due before semantic-search implementation.
- **OD-009** Approve client recording/consent language and evidence; owner: legal/privacy; due before audio pilot.
- **OD-010** Select pilot tenants/Brands and success thresholds; owner: product/operations; due before pilot rollout.

## Delivery state

This branch creates specification and machine-readable planning contracts only. It does not authorize runtime implementation. Implementation may start only after:

- `work-map-integration.json` is current and `ready_for_implementation`;
- all implementation-blocking open decisions are closed or explicitly governed;
- contracts and operation paths are reviewed;
- implementation tasks are moved from blocked/draft to ready;
- the relevant mutation authorities remain separately available at execution time.
