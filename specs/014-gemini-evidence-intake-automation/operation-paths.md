# Operation Paths — Gemini Evidence Intake and Development Automation

Every path below distinguishes validation, execution, delivery, acknowledgement, and authoritative readback. Transport success alone is never final success.

## OP-001 — Development work-packet planning

### Actor and entry point

- Actor: repository automation planner or authorized developer.
- Entry: validated `development-automation.json` plus current repository/spec evidence.
- Mode: read-only planning by default.

### Preconditions and authority

- Contract validates against `contracts/development-automation.schema.json`.
- All referenced requirements, tasks, acceptance criteria, operation paths, waves, decisions, and paths exist.
- `work-map-integration.json` fingerprint is current.
- Planning caller may read repository/spec metadata.
- The contract is not mutation authority.

### Normal sequence

1. Read the contract and source revision.
2. Validate cross-references, lifecycle states, dependency graph, decision states, allowed paths, forbidden actions, gates, and evidence requirements.
3. Calculate task readiness from dependencies, decisions, Work Map state, and entry gates.
4. Select one task or coherent wave.
5. Produce a deterministic work packet containing:
   - spec, wave, task, requirements, acceptance criteria, and operation paths;
   - allowed repository surfaces;
   - forbidden actions;
   - required tests and gates;
   - required nested authority;
   - expected completion evidence;
   - rollback posture and resume key.
6. Compute a plan hash from canonicalized packet content and source revision.
7. Return `ready` or `blocked` with explicit reasons.

### Alternate and denial paths

- Missing reference: `AUTOMATION_CONTRACT_INVALID`.
- Dependency cycle: `AUTOMATION_CONTRACT_INVALID`.
- Open blocking decision: `AUTOMATION_TASK_BLOCKED`.
- Stale Work Map fingerprint: `AUTOMATION_TASK_BLOCKED`.
- Requested mutation without nested authority: planning may describe the required authority but must not execute.

### Idempotency and replay

Idempotency scope:

```text
spec_key + task_key + source_revision + canonical_packet_hash
```

The same inputs produce the same plan hash. A verified checkpoint prevents regeneration from being treated as new work.

### Observability and readback

- Log spec/task/wave, plan hash, source SHA, gate decisions, and bounded blocker codes.
- Do not log secrets or private source content.
- Success readback is the validated packet and its stable hash.

### Recovery

Repair the contract or evidence, then rerun. No repository rollback is needed because planning is read-only.

---

## OP-002 — Evidence intake and registration

### Actor and entry point

- Team member through authenticated internal UI/form.
- Client through bounded intake link or authenticated client surface.
- Partner through a limited delivery link.
- Entry adapters may include HTTP, Google Forms/Sheets, or a governed connector.

### Preconditions and authority

- Authenticated principal or valid bounded-link identity.
- Canonical tenant/workspace/Brand/account/resource resolution.
- Allowed form/version/use case.
- File type, size, source, sensitivity, consent, and retention policy checks.
- No credentials or prohibited data.

### Normal sequence

1. Accept bounded metadata and file/link references.
2. Derive idempotency key from form response or client request identity and authorized scope.
3. Read existing intake receipt.
4. If absent, create `INTAKE_ID` in `accepted` state.
5. Preserve original file/reference before any derivative operation.
6. Create `EVIDENCE_ID` and provenance metadata.
7. Normalize URL and calculate supported checksums.
8. Apply deterministic initial sensitivity and route policy.
9. Generate sanitized canonical name without overwrite.
10. Move or bind the object to intake/quarantine/restricted storage through a governed adapter.
11. Read back canonical file identity, location, owner, and access state.
12. Queue optional AI work only after intake success.
13. Return a receipt immediately; model processing remains asynchronous.

### Alternate and degraded paths

- Duplicate delivery: return prior receipt and current status.
- Missing context: retain no partial operational record; return typed remediation.
- Unsupported or oversized file: request permitted Drive-link or alternate route.
- Sensitivity uncertain: route to restricted/quarantine and review.
- Storage transport failure after dispatch: mark outcome unknown and reconcile before retry.
- Gemini disabled: create manual-review work only.

### Idempotency and replay

```text
source event/request identity + canonical authorized scope
```

Storage mutations additionally use stable operation fingerprints and same-cycle readback.

### Success readback

- Durable intake receipt.
- Evidence record.
- Original/canonical storage reference.
- Audit event.
- Optional queued job reference.

### Recovery

- Reconcile unknown storage operations.
- Resume from the last durable checkpoint.
- Never discard accepted intake because AI failed.

---

## OP-003 — AI dispatch and structured-result validation

### Actor and entry point

- Evidence worker service principal.
- Entry: one durable `AI_JOB_ID` in `ready` state.

### Preconditions and authority

- Use-case policy allows the evidence modality and sensitivity.
- Consent and purpose are present when required.
- Model alias resolves to a certified pinned model.
- Prompt, JSON Schema, semantic validator, safety profile, and budget are active.
- Input manifest is minimized and hashed.
- Secrets are available only through approved secret authority and never included in payload records.

### Normal sequence

1. Claim the job using lease/compare-and-set semantics.
2. Revalidate current policy, budget, model, prompt, schema, and scope.
3. Create or reuse temporary provider file lease when needed.
4. Dispatch with stable operation fingerprint.
5. Record provider operation identity without sensitive payload.
6. Receive bounded response.
7. Validate provider/safety status.
8. Validate JSON Schema.
9. Apply semantic validators and route/enum allowlists.
10. Store proposed `AIResult` with complete lineage.
11. Record cost, latency, tokens/bytes, safety, and validation metrics.
12. Transition evidence to `awaiting_review` or an allowed deterministic non-authoritative state.

### Alternate and degraded paths

- Policy or sensitivity denial: `policy_blocked`, manual path.
- Budget denial: `budget_blocked`, manual or deferred path.
- Provider rate limit/5xx: bounded retry with jitter.
- Timeout after dispatch: `outcome_unknown`; inspect provider/job/lease evidence before replay.
- Safety block: preserve bounded safety metadata, no downstream proposal.
- Schema invalid: quarantine result; do not apply.
- Semantic invalid: preserve findings; request review or corrected job.
- Provider unavailable: manual fallback.

### Function-intent boundary

Model function output may propose only allowlisted intents such as:

- `suggest_route`
- `suggest_classification`
- `request_clarification`
- `propose_usage_link`
- `propose_audit_candidate`

Application code independently validates and authorizes any subsequent action. The provider never receives direct mutation authority.

### Idempotency and readback

```text
AI_JOB_ID + input_manifest_hash + prompt_version + schema_version + model_version + policy_version
```

Recovered provider success must match the same fingerprint. Blind retry is forbidden.

### Success readback

- Terminal provider receipt.
- Validated `AIResult`.
- Cost/safety/lineage ledger.
- Review queue entry when applicable.

---

## OP-004 — Human review and promotion

### Actor and entry point

- Authorized reviewer with object-level authority.
- Entry: evidence plus optional AI result in reviewable state.

### Preconditions and authority

- Reviewer membership and capability are current.
- Evidence belongs to the authorized tenant/workspace/Brand/account/resource.
- Current record version is supplied to prevent lost updates.
- Sensitive data is displayed only to permitted reviewers.

### Normal sequence

1. Read original evidence, provenance, current state, AI proposal, duplicate candidates, and existing usage links.
2. Reviewer chooses approve, approve-with-change, reject, reclassify, request clarification, merge candidate, archive, or escalate.
3. Validate decision-specific fields and authority.
4. Record `REVIEW_DECISION_ID`, actor, reason, overrides, prior version/state, and request hash.
5. Apply bounded state transition.
6. Create typed usage/promotion links when authorized.
7. Read back evidence state, decision, and links.
8. Notify or queue downstream consumers only after authoritative transition success.

### Denial and conflict paths

- Wrong scope: deny before content disclosure.
- Stale version: `REVIEW_DECISION_CONFLICT`; refresh, do not overwrite.
- Missing approval for protected promotion: remain awaiting review.
- Model-proposed approval/access/delete/publish: reject as forbidden intent.

### Idempotency

```text
REVIEW_DECISION_ID + EVIDENCE_ID + expected_record_version
```

### Success readback

- Persisted review decision.
- Evidence version/state.
- Typed downstream link or explicit no-promotion outcome.
- Audit entry.

### Recovery

State transitions are append-only/versioned. Compensating decisions supersede rather than erase prior history.

---

## OP-005 — Duplicate candidate and canonical merge

### Preconditions

- Two or more evidence records exist.
- Exact or semantic candidate evidence is available.
- Reviewer has authority over all candidate records.

### Normal sequence

1. Compare checksum, normalized URL, MIME/size, capture context, semantic similarity, and existing usage links.
2. Present candidate evidence and confidence; do not auto-delete.
3. Reviewer selects distinct, duplicate, derivative, or unresolved.
4. If duplicate, choose canonical record and preserve all source records.
5. Create canonical relationship and migrate only approved usage links.
6. Create shortcuts/references rather than copies where supported.
7. Read back canonical relationship, retained originals, and link set.

### Conflict and recovery

- Different tenant/Brand/resource authority: no merge.
- Competing concurrent merge: optimistic conflict, reread.
- Incorrect merge: superseding decision restores distinct state; originals remain available.

---

## OP-006 — Clarification request and response

### Normal sequence

1. Reviewer or validated AI proposal identifies specific missing/ambiguous fields.
2. System creates `CLARIFICATION_ID` bound to original intake/evidence and allowed questions.
3. Create bounded, expiring, revocable client/team response link.
4. Respondent sees only necessary context and questions.
5. Response receives idempotent receipt.
6. Validate and attach response as a new version/evidence item.
7. Return review item to the correct queue.

### Denial and expiry

- Expired/revoked link: deny without revealing record existence.
- Question set attempts to collect secrets: reject at contract/policy gate.
- Duplicate response: return prior receipt.

---

## OP-007 — Prompt, model, and policy publication

### Preconditions and authority

- Admin principal and action-specific capability.
- Draft definition is schema-valid.
- Benchmark/security/privacy/cost evidence satisfies the definition class.
- Exact content hash and version are bound to approval.

### Normal sequence

1. Create immutable draft version.
2. Validate compatibility, allowed use cases, schema, safety, cost, and fallback.
3. Run golden and negative tests.
4. Obtain separate approval for activation.
5. Activate for disabled/shadow/internal/pilot cohort.
6. Read back active pointer and retained previous version.
7. Expand rollout through separate governed stages.

### Rollback

Move the active pointer to the prior approved version or disable the use case. Never edit an active version in place.

---

## OP-008 — Failure recovery and dead-letter replay

### Preconditions

- Durable failed/unknown operation and current state/readback are available.
- Operator has repair/replay authority.

### Normal sequence

1. Read failure, attempt history, operation fingerprint, receipts, and current authoritative state.
2. Classify as completed/recovered, retryable, data/policy repair required, manual-only, or terminal.
3. If completed, mark recovered without replay.
4. If retryable, create one bounded repair attempt using the original idempotency scope.
5. If repair required, create explicit task and keep the original record.
6. If attempts are exhausted, move to dead letter with owner and reason.
7. Read back final/next state and repair audit.

### Safety

No unbounded automatic replay. No retry after unknown outcome without readback. No deletion of failed evidence.

---

## OP-009 — Rollout, verification, rollback, and closeout

### Entry

- Bounded implementation PR or release wave.
- Exact head/base SHA and current requirements/tasks/evidence.

### Sequence

1. Validate task scope and contract traceability.
2. Require current Work Map readiness and classification coverage.
3. Run unit, integration, contract, security, fault, and completion gates.
4. Pin exact PR head/base and required checks.
5. Merge only through governed repository authority.
6. Apply migration only through separate checksum/statement-count authorization when required.
7. Deploy through the approved environment path.
8. Verify production/main parity, health, runtime smoke, feature state, queue/worker state, budgets, and manual fallback.
9. Run rollback rehearsal or bounded disable-path verification.
10. Update `completion.json` only with authoritative evidence.
11. Classify unresolved work as owned backlog, deferred-with-risk, cancelled, or blocker.

### Rollback triggers

- Cross-scope access or secret exposure.
- Intake loss/duplication beyond accepted threshold.
- Provider output bypassing review or validation.
- Budget runaway or unbounded retries.
- Queue growth/SLA breach without safe backpressure.
- Production/main drift or failed health/readback.

### Closeout readback

Completion requires exact-head CI, merged PR inventory, migration ledger when applicable, deployment parity, production health/smoke, rollback posture, no-secret evidence, and no unowned blockers.
