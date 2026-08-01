# Security and Privacy Checklist — Spec 014

## Identity and authority

- [ ] Internal submitters are authenticated before mutable scope resolution.
- [ ] Client/partner links are bounded, non-enumerable, revocable, purpose-limited, and expire where appropriate.
- [ ] Tenant, workspace, Brand, account, project, evidence, and target IDs come from canonical authority, not caller override.
- [ ] Reviewer and repair actions require object-level capability and current record version.
- [ ] Service workers cannot expand scope from payload fields.
- [ ] Repository automation contracts are not treated as runtime or mutation authority.

## Files and storage

- [ ] Canonical originals are preserved before rename, move, derivative generation, or provider upload.
- [ ] MIME, size, duration, and source policy are enforced independently from filenames.
- [ ] Quarantine, restricted, unsorted, and manual-review states are explicit.
- [ ] File move/rename/share operations are idempotent and verified by readback.
- [ ] Duplicate candidates are not auto-deleted.
- [ ] Public-link creation is denied unless a separately approved use case requires it.

## Gemini/provider boundary

- [ ] Production credentials remain in approved secret authority only.
- [ ] No API key, access token, signed URL, authorization header, or provider secret appears in repository, Sheets, Forms, prompts, logs, fixtures, or evidence.
- [ ] Provider calls are backend-to-backend in production.
- [ ] Restricted data is denied provider processing by default.
- [ ] Client Confidential processing has an approved purpose, policy, and consent basis.
- [ ] Prompt injection inside text, PDF, image, audio, video, or webpage is treated as untrusted content.
- [ ] Model output is untrusted and cannot approve, delete, publish, grant access, or mutate protected resources.
- [ ] Function calls are allowlisted proposals only and receive independent authorization before execution.
- [ ] Provider temporary files are leased, expiring, tracked, and never canonical.

## Structured results and semantic validation

- [ ] Model output validates against the pinned JSON Schema.
- [ ] Unknown enums, routes, identities, authority claims, impossible dates/numbers, and missing provenance fail semantic validation.
- [ ] Verbatim claims include page, timestamp, message, paragraph, region, or explicit unknown provenance.
- [ ] AI confidence is never used as access or approval authority.
- [ ] Raw provider responses are bounded, redacted, retained by policy, and not generally exposed.

## Privacy and retention

- [ ] Data minimization applies to provider input manifests.
- [ ] Personal-data categories and sensitivity are reviewed, not accepted solely from model classification.
- [ ] Recording/audio/video consent language and evidence are approved before activation.
- [ ] Retention differs for originals, provider files, results, embeddings, logs, and audit evidence.
- [ ] Legal/contractual hold overrides ordinary deletion.
- [ ] Deletion is a governed lifecycle with evidence and readback.

## Abuse and negative tests

- [ ] Wrong-tenant, wrong-Brand, wrong-account, wrong-resource, and confused-deputy tests deny before content/provider access.
- [ ] Duplicate/replay and unknown-outcome tests prevent repeated mutation.
- [ ] Oversized, unsupported, misleadingly named, redirected, and malformed files are tested.
- [ ] Prompt-injection fixtures cover every supported modality.
- [ ] Secret-scanner and log-redaction tests pass.
- [ ] Cost/budget bypass attempts fail closed.
- [ ] Stale reviewer version and concurrent decision tests produce conflicts, not silent overwrite.

## Release security gate

- [ ] Security and privacy decisions OD-002, OD-003, OD-007, OD-008, and OD-009 are resolved before their implementation waves.
- [ ] Exact-head CI includes security, privacy, no-secret, cross-scope, and adversarial test evidence.
- [ ] Production readback verifies feature flags, model/policy versions, budgets, queues, and manual fallback.
- [ ] Rollback can disable provider dispatch without losing intake or evidence.
