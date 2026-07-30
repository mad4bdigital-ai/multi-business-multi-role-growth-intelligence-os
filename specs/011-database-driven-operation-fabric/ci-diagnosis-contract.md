# CI Diagnosis and Recovery Contract

## Goal

Convert a failed CI gate into a bounded, structured explanation and safe next action without requiring the caller to inspect raw workflow pages, job IDs, logs, or workflow source manually.

## Diagnosis chain

```text
commit or pull request
→ required check
→ check run
→ workflow run
→ job
→ failing step
→ annotations and bounded logs
→ normalized reason
→ affected paths
→ recovery recipe
```

## Result envelope

```json
{
  "status": "failed",
  "check": "Syntax Check",
  "job": "syntax",
  "step": "Guard merge and runtime interruption readiness",
  "reason_code": "BRANCH_RECONCILIATION_REQUIRED",
  "retryable": false,
  "affected_paths": ["docs/work-maps/README.md"],
  "recommended_operation": "repo.branch.reconcile",
  "evidence_refs": ["artifact_ref_1"]
}
```

## Normalized reason classes

- branch freshness or merge conflict;
- generated artifact drift;
- schema or OpenAPI drift;
- migration placement or documentation gap;
- deterministic syntax/lint/test failure;
- flaky test candidate;
- infrastructure unavailable;
- rate limit or dependency timeout;
- missing credential/reference;
- capability/approval denial;
- deployment parity failure;
- unknown failure requiring human review.

## Log handling

- Fetch only required job/step output.
- Redact tokens, headers, credentials, cookies, and secret-like values.
- Store bounded summaries and hashes, not unlimited logs.
- Link to governed artifacts for authorized deeper inspection.
- Normalize upstream HTML and transport failures into JSON errors.

## Recovery

A recovery recipe declares:

- eligible reason codes;
- whether a repository or runtime write is required;
- required capability and approval;
- idempotency key derivation;
- maximum attempts and backoff;
- readback required before retry;
- terminal stop conditions.

Examples:

- reconcile branch, then rerun required checks;
- regenerate registered artifacts, then run drift gate;
- retry a transient GitHub 5xx after readback confirms no write;
- block deterministic test failure and return the failing assertion;
- request credential repair without exposing credential values.

## Completion

CI diagnosis is complete only when every required check is successful, intentionally skipped by documented policy, or blocked with an explicit unresolved reason and owner. A generic exit code is insufficient.
