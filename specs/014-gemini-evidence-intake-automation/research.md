# Research and Baseline — Gemini Evidence Intake and Development Automation

## Repository governance baseline

The repository already defines:

- specification-before-implementation governance;
- contract-first OpenAPI/JSON Schema surfaces;
- complete operation-path requirements;
- SQL/registry runtime authority;
- tenant/Brand/resource binding;
- replay-safe execution and readback;
- Work Map integration and schema classification;
- repository automation planning and completion gates.

This Spec therefore extends existing governance rather than introducing a parallel workflow engine.

## External operating baseline

Business-side artifacts currently describe:

- CRM and operational Google Sheets;
- form registry and field dictionary;
- intake and error logs;
- Apps Script source drafts;
- evidence capture, naming, classification, routing, review, and client survey journeys;
- a Father Spec covering Gemini use cases, security, tests, and rollout.

These are authoritative product inputs but not runtime authorization or deployment evidence.

## Provider suitability findings

Gemini is a suitable primary provider candidate because the planned system needs text, image, document, audio, video, structured output, function-intent, and embedding capabilities. The product design must nevertheless use:

- logical model aliases;
- provider abstraction;
- pinned stable models after benchmark;
- strict output schemas and semantic validators;
- backend secret boundary;
- data minimization and sensitivity policy;
- manual fallback.

No provider feature creates platform authority.

## Architecture alternatives

### Alternative A — Apps Script calls Gemini directly

Benefits:

- fast pilot;
- fewer components;
- close to Forms/Sheets.

Risks:

- execution/time/concurrency limits;
- weaker job/queue/retry/observability controls;
- harder secret, budget, and tenant isolation at scale;
- risk of making Sheets/Apps Script a shadow authority.

Disposition: may be considered only for a small non-sensitive proof, not the preferred production architecture.

### Alternative B — Backend gateway with queue and registries

Benefits:

- reuses platform authority and durable state;
- bounded asynchronous execution;
- Secret Manager compatibility;
- explicit budgets, retries, dead letter, and observability;
- provider portability.

Costs:

- more implementation and operational work.

Disposition: preferred production direction, pending OD-001.

### Alternative C — Client-side provider calls

Risks:

- key exposure;
- bypassed policy and audit;
- weak scope and cost control.

Disposition: rejected.

## Storage alternatives

### Drive as canonical file store during pilot

Benefits:

- existing business workflow and sharing model;
- original preservation;
- links/shortcuts for multiple uses.

Constraints:

- file operations require strong authority/readback;
- public links and inherited sharing require strict policy;
- Drive metadata is not sufficient runtime state.

Disposition: accepted for canonical originals in pilot; SQL records lifecycle and authority.

### Provider file storage as canonical

Disposition: rejected. Provider files are temporary processing objects only.

## Duplicate detection alternatives

1. Exact checksum and normalized URL: deterministic, low risk, first delivery.
2. Name/size/time heuristics: candidate signal only.
3. Embeddings/perceptual similarity: later wave, benchmarked, scoped, candidate-only.
4. Automatic delete: rejected.

## Review interface alternatives

- Google Sheets queue: fastest pilot, weaker object-level UI and concurrency.
- AppSheet: mobile-friendly and low-code; requires permission and scale review.
- Platform Web UI: strongest integration and authority, more implementation.

Decision remains OD-006.

## Development automation design findings

A useful automation contract must be more than a task list. It needs:

- immutable IDs and cross-references;
- lifecycle and blocker semantics;
- implementation-wave dependencies;
- allowed repository paths and forbidden actions;
- required tests and gates;
- authoritative completion evidence;
- nested authority declaration;
- idempotent resume key and plan hash.

The contract should generate bounded work packets but must not authorize their execution.

## Open research and benchmarks

Before production:

- model quality by use case and language;
- schema validity and semantic error rates;
- audio transcript and video timestamp fidelity;
- PII/sensitivity detection recall and false positives;
- duplicate candidate precision/recall;
- cost/latency by modality and file size;
- provider retention/data-processing posture for approved account/region;
- review workload and SLA impact;
- manual fallback throughput.

## Rejected shortcuts

- Hard-code a single Gemini model alias in product state.
- Store API key in Sheet, Form, repository, or browser.
- Treat `responseSchema` success as semantic truth.
- Let function calling execute protected tools directly.
- Let AI choose ambiguous tenant/Brand/account.
- Store unrestricted raw provider responses in logs.
- Auto-delete duplicate candidates.
- Make Google Sheets the runtime authority.
- Declare implementation complete from merged code without production readback.
