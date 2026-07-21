# OpenAPI Guard Failure and Recovery Drill Report

## Scope

This report records the controlled failure/recovery drill for the Custom GPT Contract Guard, including GitHub Issue lifecycle, SQL Operational Alert lifecycle, SLO evidence, and production readiness.

## Implementation

- CI signal ingestion endpoint: `POST /activation/operational-attention/ci-signals`
- SQL event authority: `operational_alert_ci_signal_events`
- Alert authority: `operational_alerts`
- Lifecycle audit: `operational_alert_lifecycle_events`
- Notification authority: `operational_alert_notification_outbox`
- Dashboard surface: `dashboard.ci_guard_slo` and tile `openapi_guard_slo`
- Runbook: `docs/openapi-response-object-guard-runbook.md`

## SLO targets

| Objective | Target |
|---|---:|
| Successful default-branch guard runs | At least 1 per 24 hours |
| Failure detection | 300 seconds or less |
| Recovery | 3,600 seconds or less |

## Drill evidence

The final run IDs, Issue number, SQL alert ID, SQL event IDs, detection time, recovery time, merge commit, deployed commit, and readiness result are added after the production drill completes.

| Step | Run ID | Result | Issue | SQL evidence |
|---|---|---|---|---|
| Controlled failure 1 | pending | pending | pending | pending |
| Controlled failure 2 | pending | pending | pending | pending |
| Recovery success | pending | pending | pending | pending |

## Acceptance criteria

- Two controlled failures do not modify repository files.
- Both failures update one deduplicated GitHub Issue.
- Both failures create distinct idempotent SQL event rows and one open SQL alert.
- Recovery closes the GitHub Issue and resolves the SQL alert.
- Dashboard reports the daily success, detection-time, and recovery-time objectives.
- All repository CI checks and production release-readiness checks pass.
- No secrets are stored in event or alert evidence.
