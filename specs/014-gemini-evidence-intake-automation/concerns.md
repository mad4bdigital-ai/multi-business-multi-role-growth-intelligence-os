# Cross-Cutting Concerns — Gemini Evidence Intake and Development Automation

## Authentication and authorization

- Signed principal or bounded client-link identity is required before mutable scope resolution.
- Authentication does not imply authorization.
- Object-level authority is checked before content disclosure, file access, review, promotion, repair, or provider dispatch.
- Tenant/workspace/Brand/account/resource overrides in caller payloads are ignored or rejected.

## Tenant, Brand, and resource isolation

- All records, queues, caches, files, jobs, results, reviews, embeddings, and searches are scope-bound.
- Cross-tenant joins/search and mixed-scope batches are forbidden unless a separately governed platform-owned aggregate contract permits them.
- Wrong-resource denial happens before credential or provider access.

## Privacy, consent, and data minimization

- Sensitivity classes: Public Reference, Internal, Client Confidential, Restricted, Contains Personal Data.
- Restricted is provider-denied by default.
- Recording/audio/video use requires approved consent evidence when applicable.
- Only necessary excerpts/metadata are sent to providers.
- Provider temporary files are not canonical storage.
- Retention, legal hold, and deletion are explicit lifecycle policies.

## No-secret handling

Never place in repository, Sheets, prompts, logs, evidence, fixtures, or completion reports:

- API keys, OAuth tokens, authorization codes;
- passwords, client secrets, provider headers;
- raw credential payloads;
- signed URLs or temporary download URLs beyond restricted transient handling;
- raw financial/payment credentials;
- unbounded provider/model responses containing sensitive content.

## Untrusted content and prompt injection

- Text inside files, images, audio, video, web pages, and PDFs is data, not system instruction.
- Model output is also untrusted input.
- Function calling is constrained to allowlisted proposal intents.
- No model-proposed authority, route, permission, delete, publish, or approval is executed directly.

## Idempotency, replay, and unknown outcome

- Intake: source event/request identity plus canonical scope.
- File operations: stable operation fingerprint and readback.
- AI: job ID plus input/prompt/schema/model/policy versions.
- Review: decision ID plus expected record version.
- Unknown transport outcome permits reconciliation only until resolved.
- Bounded retries and dead-letter states are mandatory.

## Availability and backpressure

- Synchronous intake does not wait for AI.
- Provider degradation switches to queue/manual review, not data loss.
- Queue concurrency and budgets are scope-bound.
- Backpressure prevents uncontrolled file/model dispatch.
- Operators can pause individual use cases or cohorts.

## Performance

- Bounded intake payloads and asynchronous heavy processing.
- Cursor pagination and field allowlists for lists/search.
- Cache only immutable/versioned resolution data with scope keys.
- Embeddings are generated once per content/version unless policy requires refresh.

## Observability

- Stable trace/request/intake/evidence/job/result/review/work-packet identifiers.
- Structured reason codes and lifecycle states.
- Metrics for cost, latency, retries, schema/semantic failures, safety blocks, queue age, overrides, duplicates, clarification, and utilization.
- Logs are redacted and bounded.

## Compatibility and migration

- Additive schemas and disabled flags first.
- Existing CRM/Research/Audit flows remain functional during pilot.
- External Sheets are not promoted to runtime authority.
- No bulk legacy file mutation until observe-only analysis and rollback mapping exist.
- Generated canonical files are updated through their generators.

## Rollout and rollback

- Disabled → shadow → internal → pilot → canary → production.
- Separate flags for text/image/PDF/audio/video/embeddings/client journeys.
- Rollback stops new dispatch first, preserves intake/evidence, pauses workers, restores prior active definitions, and verifies manual fallback.

## Bias and quality

- Arabic and mixed-language performance is benchmarked separately.
- Confidence is a model claim, not decision authority.
- Demographic inference is not used as an unreviewed policy.
- Human override rates and false positives/negatives are monitored by use case.

## Repository automation

- The development contract may plan, lint, generate bounded packets, and request evidence.
- It may not create approvals, broaden paths, merge, deploy, migrate, or call providers by itself.
- Exact source SHA, plan hash, and nested authority are required for mutation stages.
- Completion remains governed by repository completion gates and authoritative readback.
