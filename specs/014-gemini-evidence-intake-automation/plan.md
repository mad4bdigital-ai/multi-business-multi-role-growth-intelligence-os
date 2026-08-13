# Implementation Plan: Gemini Evidence Intake and Development Automation

**Spec**: `specs/014-gemini-evidence-intake-automation/spec.md`  
**Branch**: `gpt/spec-014-gemini-evidence-automation-20260801`  
**Status**: Draft; runtime implementation blocked

## Constitution check

| Principle/gate | Evidence | Status |
|---|---|---|
| Work Map integration and dimension discovery | `work-map-integration.json` | draft/gap |
| Complete schema classification | current coverage matrix reports no unresolved objects; new entities not yet implemented | pass for spec, required again before schema work |
| Existing-map reuse before new-map proposal | no new Work Map proposed | pass |
| Registry and SQL authority | `spec.md`, `data-model.md` | pass |
| Complete operation paths | `operation-paths.md` | pass for design review |
| Security and tenant isolation | `concerns.md`, security checklist | draft/gap |
| Contract-first surfaces | `contracts/` | pass for draft contracts |
| Durable/replay-safe execution | OP-002, OP-003, OP-008 | pass for design review |
| Evidence/readback | OP-001 through OP-009 | pass for design review |
| Brownfield compatibility | additive/disabled-first plan | pass |
| Testing and fault injection | this plan and checklists | draft/gap |
| Governed delivery | `development-automation.json`, `completion.json` | pass for spec stage |

## Verified baseline

- Repository base: `main@b684537eb79710fa1744a955bcce95f9a0b0dae0`.
- Spec governance: `.specify/memory/constitution.md` and `docs/spec-kit-governance.md`.
- Completion gate: `.specify/spec-kit-governance.json` and `http-generic-api/scripts/spec-kit-completion-gate.mjs`.
- Work Map index source hash: `752bc2ef9ed7417689f1644ab9b492009fa4611a2c91e4bf0d2ddf0326d25073`.
- Coverage source hash: `0cdfc494f247174aa8badfb019a7ce3aec1df42173f69b0f870ea9d55012159f`.
- Calculated Work Map registry fingerprint: `f282e53d6620e906ca48ff703e2e0b65c5fde6b10d20194b596c2bd2e687f235`.
- External Google documents/Sheets are business inputs only and are not repository runtime authority.

## Technical approach

Use the existing platform control-plane model:

```text
stable identity/policy/runtime kernel
+
versioned evidence and AI registries
+
provider and Google Workspace adapters behind ports
+
async jobs and durable receipts
+
strict structured contracts
+
human review and typed downstream links
```

The development automation contract is consumed before implementation to select a bounded task, produce a deterministic work packet, and request required evidence. It never authorizes mutations.

## Workstreams

### WS0 — Spec, Work Maps, and automation contract

- Validate `development-automation.json` and all refs.
- Resolve Work Map and domain decisions.
- Close or govern open decisions.
- Freeze schemas, state transitions, operation paths, and error taxonomy.

### WS1 — Contracts and persistent state

- Evidence/intake/usage-link entities.
- AI job/result/prompt/model/policy entities.
- Review/clarification/temporary-file lease entities.
- Additive migrations, indexes, lifecycle constraints, no-secret controls.

### WS2 — Intake and file lifecycle

- Authenticated/internal and bounded-client intake.
- Forms/Sheets/Drive adapters.
- Original preservation, naming, checksum, routing, quarantine, restricted handling, and readback.
- Exact duplicate foundation.

### WS3 — Gemini gateway and structured intelligence

- Backend secret boundary and provider abstraction.
- Durable job dispatch and temporary provider files.
- Structured output and semantic validators.
- Bounded function intents.
- Text, image, PDF, audio, video, and embeddings as separately enabled use cases.

### WS4 — Review and downstream linkage

- Reviewer queue and object-level authority.
- Approve/reject/reclassify/clarify/merge/archive/escalate transitions.
- Typed links to Research, Audit, Activity, Hypothesis, Task, Opportunity, and Report.
- Human override and lineage evidence.

### WS5 — Reliability, observability, and rollout

- Retry/readback/dead-letter/manual fallback.
- Cost and budget ledger.
- Metrics, alerts, runbooks, golden benchmark, pilot, canary, rollback, and closeout.

## Dependency order

```text
Spec and Work Map readiness
→ data/state contracts
→ intake and canonical storage
→ Gemini gateway
→ structured validation
→ review lifecycle
→ client journeys
→ embeddings/audio/video
→ observability/recovery
→ pilot
→ production hardening
→ closeout
```

See `development-automation.json` for exact wave/task dependencies.

## Data and migration plan

- Additive tables and indexes only in initial runtime delivery.
- No active table is repurposed as a parallel authority.
- IDs are immutable and scope-bound.
- Active prompt/model/policy versions are immutable; pointer changes create auditable activation events.
- Migration application is separately authorized by exact checksum and statement count.
- Backfill begins in observe-only mode and never renames/moves legacy files without a reviewed plan.
- Rollback disables new behavior and pointers; destructive down migrations are not the primary rollback.

## API and contract plan

- Draft gateway contract in `contracts/gemini-evidence-gateway.openapi.yaml`.
- Structured model output in `contracts/gemini-evidence-result.schema.json`.
- Repository work orchestration in `contracts/development-automation.schema.json`.
- Implementation PRs update canonical OpenAPI sources/generators rather than generated roots.
- List/search endpoints use pagination and field allowlists.
- Tenant responses exclude credentials, internal provider payloads, prompt bodies when restricted, and cross-scope data.

## Security plan

- Reuse signed principal/context-kernel authority.
- Default deny and object-level authorization before content disclosure or adapter access.
- Treat files and model output as untrusted input, including prompt-injection attempts.
- Secret Manager or approved secret authority for production credentials.
- Restricted data provider-denied by default.
- Verify wrong-tenant, wrong-Brand, wrong-resource, replay, confused-deputy, privilege-expansion, and public-link abuse cases.

## Test plan

### Deterministic tests

- Contract/reference validation.
- State machines and lifecycle guards.
- Naming/URL/fingerprint logic.
- Policy/model/prompt resolution.
- Budget and retry classification.

### Integration and contract tests

- Intake to receipt/evidence.
- Storage mutation to readback.
- Job to provider mock to validated result.
- Review to typed downstream link.
- Clarification round trip.
- OpenAPI/JSON Schema parity.

### Fault and abuse tests

- Duplicate delivery.
- Timeout after provider/storage dispatch.
- 429/5xx and retry exhaustion.
- Invalid JSON, valid JSON with invalid meaning, unknown enums/routes.
- Prompt injection inside each supported modality.
- Cross-tenant and wrong-resource attempts.
- Restricted data and credential submission.
- Cost hard stop and provider-disabled manual path.

### Release tests

- Exact-head CI.
- Migration dry-run/ledger when applicable.
- Production/main parity and health.
- Runtime smoke, queue state, budget state, manual fallback, and rollback.

## Rollout plan

1. Specification and validators only.
2. Disabled state/registry foundations.
3. Internal intake and storage without Gemini.
4. Shadow non-sensitive text/image analysis.
5. Mandatory-review internal pilot.
6. Selected client pilot.
7. Embeddings, audio, and video as separate flags.
8. Tenant/Brand cohort canary.
9. Broad production after quality, cost, privacy, fallback, and operator gates.

## Evidence and completion

Authoritative closeout evidence must cover:

- current Work Map readiness and classification;
- schema/reference validation;
- task/checklist closure;
- merged PRs and exact-head CI;
- migration checksum, statement count, and ledger when applicable;
- deployment parity, health, and runtime smoke when applicable;
- manual fallback and rollback;
- benchmark/cost/privacy results;
- explicitly owned unresolved backlog.

## Risks and mitigations

| Risk | Probability | Impact | Prevention | Detection | Recovery |
|---|---|---|---|---|---|
| Development automation widens scope | M | H | allowed paths and forbidden actions per task | work-packet validation | block packet and regenerate |
| Contract mistaken for mutation authority | M | H | explicit authority boundary | negative authority tests | stop and require nested approval |
| Wrong scope reaches file/provider | L/M | Critical | signed context and object authority | cross-scope tests/audit | disable feature and incident review |
| Prompt injection influences action | M | H | content treated as data; bounded intents | adversarial tests | reject result and manual review |
| Sensitive data sent externally | L/M | Critical | default-deny sensitivity policy | dispatch audit/privacy alerts | revoke/disable and incident workflow |
| Provider cost runaway | M | H | budgets, model tiers, caching, hard stops | cost metrics/alerts | disable use case/provider |
| Unknown outcome causes duplicate mutation | M | H | durable fingerprint and readback-before-retry | receipt reconciliation | recover without replay |
| Model/schema drift | M | H | pinned versions and benchmark gates | contract/golden failures | restore prior active version |
| Review queue becomes operational bottleneck | M | M/H | priority/SLA/backpressure/manual capacity | queue age metrics | reduce AI/use-case intake or add reviewer capacity |
| Legacy file migration damages provenance | L/M | H | observe-only and no bulk rename first | diff/readback samples | rollback mapping and preserve originals |
