# Data Model — Gemini Evidence Intake and Development Automation

## Authority and storage posture

If implemented, SQL/runtime registries are authoritative for platform lifecycle, authority, job, review, and evidence-link state. Google Sheets and Forms are external adapters, operational views, and asynchronous mirrors; they do not become authorization or runtime policy authority.

All persistent records include canonical scope, immutable identity, timestamps, lifecycle version, and no-secret guarantees.

## Core entities

### IntakeSubmission

| Field | Meaning |
|---|---|
| `intake_id` | Immutable intake identity |
| `tenant_id`, `workspace_id`, `brand_id`, `account_id` | Canonical resolved scope; nullable only when the use case explicitly permits global research |
| `principal_id` or `client_binding_id` | Authenticated/bounded submitting identity |
| `source_type`, `form_key`, `form_version`, `form_response_id` | Adapter and source identity |
| `idempotency_key` | Unique replay key within scope |
| `raw_payload_ref` | Bounded reference, not an unbounded sensitive payload in logs |
| `status` | accepted, validating, registered, blocked, failed, completed |
| `error_code`, `error_detail_ref` | Structured failure metadata |
| `submitted_at`, `processed_at` | Lifecycle time |

Constraints:

- unique `(scope, idempotency_key)`;
- form response replay resolves the prior receipt;
- caller-supplied scope is never authoritative.

### EvidenceRecord

| Field group | Fields |
|---|---|
| Identity/scope | `evidence_id`, tenant/workspace/Brand/account/project refs |
| Source | source platform, URL, title, author, capture time, uploader |
| Canonical file | Drive/resource identity, original name, canonical name, MIME, size, checksum |
| Content separation | verbatim text, observation, interpretation, hypothesis, recommendation refs |
| Governance | sensitivity, personal-data flag, consent status, retention class, legal hold |
| Lifecycle | registration, normalization, routing, duplicate, AI, review, archival states |
| Lineage | canonical evidence candidate, current AI result, reviewer, versions |

Proposed lifecycle:

```text
captured
→ metadata_pending | registered
→ normalized
→ routed | quarantine | restricted
→ ai_pending | manual_review
→ awaiting_review
→ validated | rejected | needs_clarification
→ linked | promoted
→ archived
```

State dimensions remain distinct; routing success is not review success.

### EvidenceUsageLink

Represents one evidence object used by one target without copying the canonical file.

Fields:

- `usage_link_id`
- `evidence_id`
- target type and canonical target ID
- purpose and relationship type
- primary flag
- created/removed actor and time
- lifecycle version

### AIJob

| Field group | Fields |
|---|---|
| Identity | `ai_job_id`, evidence/intake refs, trace ID |
| Scope | tenant/workspace/Brand/account and policy scope |
| Contract | use-case key, prompt/schema/model/policy versions |
| Input | minimized manifest reference and SHA-256 |
| Dispatch | provider, operation fingerprint, provider operation ref |
| Lifecycle | queued, ready, running, retry_scheduled, outcome_unknown, succeeded, blocked, failed, dead_letter |
| Retry | attempt count, maximum, not-before, lease |
| Cost | bytes/tokens, estimated/actual cost, budget decision |
| Safety/error | safety status, error code, bounded detail ref |

Unique operation identity prevents replay of the same provider mutation/analysis.

### AIResult

Fields:

- `ai_result_id`, `ai_job_id`, `evidence_id`
- bounded result JSON/reference and hash
- result summary
- model, prompt, schema, policy versions
- schema and semantic validation status
- safety metadata
- confidence/limitations as model claims, not authority
- human decision and override refs
- created/reviewed timestamps

Raw unbounded provider responses are not generally exposed or logged. Retention is policy-controlled.

### ReviewDecision

Fields:

- `review_decision_id`
- evidence/result refs
- expected record version
- reviewer principal and capability evidence
- decision enum
- rationale and bounded override JSON
- prior/new state
- request hash, created time
- supersedes decision ref when correcting history

### ClarificationRequest

Fields:

- `clarification_id`
- intake/evidence/review refs
- permitted question schema/version
- bounded-link identity, expiry, revocation
- response identity and idempotency key
- state: draft, sent, viewed, answered, expired, revoked, closed

### PromptDefinition

Immutable versions with:

- prompt key/version and purpose;
- system instruction/template references;
- schema key/version;
- model tier, safety profile, permitted use cases;
- status and effective window;
- owner, approval, benchmark, content hash;
- secrets included = false.

### ModelDefinition

Immutable registry versions with:

- logical alias and resolved provider/model ID;
- version class: stable/preview/disabled;
- modalities, limits, allowed use cases;
- benchmark, cost, fallback, verification time;
- rollout state and active pointer.

### AIUseCasePolicy

Binds:

- use-case key;
- permitted modality/MIME and size/duration;
- permitted sensitivity/consent state;
- model tier and fallback;
- prompt/schema/semantic validator;
- budget class and retry policy;
- manual fallback and review requirement.

### ProviderFileLease

Tracks temporary provider-side files:

- lease ID, evidence/file/job refs;
- provider object ref/hash;
- created/expiry time;
- status and cleanup attempts;
- canonical Drive source remains separate;
- no signed URL or credential stored in broadly visible state.

### AutomationWorkPacket

Generated read-only planning artifact:

- work packet ID, spec/wave/task;
- source revision and plan hash;
- requirement/acceptance/operation-path refs;
- allowed paths and forbidden actions;
- required tests/gates/evidence;
- nested authority requirements;
- rollback posture and resume key;
- state and bounded blockers.

### AutomationCheckpoint

- checkpoint ID and resume key;
- plan/source hash;
- last verified task state;
- evidence refs and timestamp;
- no mutation authority or secret material.

## State machines

### AI job

```text
queued
→ policy_check
→ ready | policy_blocked | budget_blocked
→ running
→ succeeded | retry_scheduled | outcome_unknown | safety_blocked | schema_invalid | semantic_invalid | failed
→ dead_letter | cancelled
```

`outcome_unknown` permits reconciliation/readback only until resolved.

### Review

```text
not_required | awaiting_review
→ in_review
→ approved | approved_with_changes | rejected | needs_clarification | merged | escalated
```

### Prompt/model/policy version

```text
draft
→ validated
→ approved
→ shadow | pilot | active
→ deprecated
→ archived
```

Active versions are immutable. Rollback changes the active pointer.

## Index and partition requirements

- All list/read paths begin with canonical tenant scope and, where applicable, workspace/Brand/account.
- Unique indexes enforce idempotency and immutable version keys.
- Queue indexes cover status, not-before, priority, scope, and lease expiry.
- Review indexes cover scope, status, priority, age, sensitivity, and owner queue.
- Usage links index target type/ID and evidence ID.
- Embedding storage, if approved, is separately scope-bound and versioned; vectors are not placed in primary operational list cells.

## Retention and deletion

Retention is unresolved under OD-003. The model must support distinct policies for:

- canonical originals;
- provider temporary files;
- AI results and bounded raw response references;
- embeddings;
- operational logs/metrics;
- audit decisions and legal holds.

Deletion is a governed lifecycle, not direct ad hoc erasure. Evidence needed for audit or legal hold remains protected.

## Migration posture

- Initial changes additive and disabled by default.
- No destructive backfill.
- No bulk rename/move of existing Drive files in the first migration.
- Schema classification and Work Map integration must be updated before migration implementation.
- Apply requires exact checksum, statement count, dry-run, authorization, ledger, and business-state readback.
