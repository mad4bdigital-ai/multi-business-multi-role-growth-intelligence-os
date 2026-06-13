# Growth Intelligence Operational Runbook

## Baseline

The value path may run only while the platform baseline is pass and healthy. Treat readiness failures, actionable migration drift, or a non-empty governance surface queue as release blockers.

## Status Response

| Signal | Operator action |
|---|---|
| `pass` | Run the pilot and retain readback/audit evidence. |
| `warn` | Identify the warning owner and runbook; do not widen execution authority. |
| `fail` | Stop the value workflow, remediate, and rerun readiness before retrying. |
| health degraded | Verify dependencies and queue state; do not classify the pilot as complete. |
| actionable migration drift > 0 | Run governed migration preflight and reconcile drift before release. |
| surface queue > 0 | Classify and close or defer every item through governance before release. |

## Pilot Checks

Confirm:

- all ten workflow stages are `pass`
- every insight has evidence or explicit assumption state
- every backlog action has score, risk, execution class, and approval state
- all non-advisory actions are held
- provider writes = 0
- external sends = 0
- secrets included = false
- report and audit identifiers are present

When `persistence_mode=internal_registry`, also confirm:

- one workflow run links the report
- all insights and actions link the same report and tenant
- every approval-required action links an open `approval_holds` row
- the transaction completed without partial records
- approval decisions return `execution_dispatched=false`
- Growth Intelligence holds are decided only through the specialized action decision route
- duplicate insights are superseded through the deterministic fingerprint lifecycle
- insight decisions are explicit and superseded insights cannot be decided again
- the latest readiness assessment is retained with its SHA-256 evidence hash
- `review_ready` assessments still return `execution_allowed=false`

## Product Metrics

Review tenant or brand metrics for:

- reports generated and awaiting approval
- evidence-backed versus assumption insights
- accepted, rejected, stale, and superseded insights
- held, approved, and rejected actions
- evidence coverage and insight/action/report approval rates
- blocked versus review-ready assessment history
- provider write, external send, and secret counters

Any non-zero safety counter is a release blocker.

## Readiness Assessment

Before classifying a report as ready for human review, create a readiness
assessment and confirm there are no blocking gaps for report approval, action
approval, insight acceptance, evidence coverage, scoring, readback requirements,
or safety flags. Malformed readback requirements are treated as missing and block
readiness. Readiness is review evidence only; it never authorizes execution.

## Recovery

When brand resolution fails, repair Brand Registry or Brand Core authority. When activity resolution fails, repair the Business Activity Type registry. When a policy or runtime stage fails, keep the action held and attach the failure to audit evidence. Never bypass the hold to make the pilot pass.

## Success Evidence

Retain the JSON report, Markdown report, approval queue view, readback object, audit evidence, and fresh test output.
