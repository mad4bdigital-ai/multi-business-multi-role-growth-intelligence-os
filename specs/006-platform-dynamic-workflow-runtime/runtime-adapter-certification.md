# Runtime Adapter Certification

## Purpose

An adapter is executable only while a versioned certification is active for the requested capability, provider, action/endpoint identity, execution mode, and risk class.

## Certification record

A certification contains:

- adapter key and implementation version;
- provider/connector family;
- supported step types and execution modes;
- canonical endpoint/action identities;
- request/response schema versions;
- payload, duration, and concurrency limits;
- credential and tenant-isolation model;
- idempotency classification;
- callback verification scheme;
- status inspection, cancellation, and readback capabilities;
- error mapping and retry taxonomy;
- test evidence references;
- approved risk classes;
- effective/expiry times;
- certifying principal and approval reference;
- certification hash and status.

## Idempotency classifications

- `provider_native` — provider accepts and enforces a stable idempotency key.
- `platform_receipt_guarded` — platform receipt/inspection prevents unsafe redispatch.
- `read_only_repeatable` — repeat has no mutation effect.
- `non_idempotent_compensatable` — execution needs explicit approval and compensation.
- `unsupported_for_retry` — timeout/unknown outcome blocks automated redispatch.

## Capability matrix

| Capability | Required for sync | Required for callback | Required for high risk |
|---|---:|---:|---:|
| input validation | yes | yes | yes |
| dispatch receipt | yes | yes | yes |
| inspect/status | recommended | yes | yes |
| cancellation | policy dependent | policy dependent | yes where provider supports |
| callback verification | no | yes | if callbacks used |
| readback | policy dependent | policy dependent | yes |
| normalized output | yes | yes | yes |
| idempotency evidence | yes | yes | yes |
| secret redaction | yes | yes | yes |

## Readiness decision

Certification alone is insufficient. Runtime readiness also checks:

- exact tenant/platform resource binding;
- credential reference availability and scope;
- endpoint/action registry status;
- current health and freshness;
- rate-limit/capacity availability;
- plan schema compatibility;
- approval requirement;
- readback availability.

Readiness states:

- `ready`
- `ready_requires_approval`
- `degraded`
- `blocked`
- `unsupported`

## Expiry and revocation

Expired or revoked certifications block new dispatch. In-flight runs enter policy-defined verification, cancellation, or operator-recovery behavior. Revocation never deletes historical certification evidence.

## Certification test evidence

The certification suite must include happy path, invalid input, auth failure, permission denial, rate limit, timeout before/after transmission, duplicate dispatch, callback replay, cancellation race, readback mismatch, malformed provider response, output normalization failure, and secret-redaction verification.
