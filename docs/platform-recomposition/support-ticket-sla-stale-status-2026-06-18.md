# Support Ticket SLA Stale Status Guard — 2026-06-18

## Scope

This change corrects SLA reconciliation for open support tickets that no longer have any valid due dates.

Previously, the no-due-date branch reused the stored `sla_status`. A ticket could therefore remain `breached` or `warning` after its due dates were removed. The calculator now derives `on_track / no_due_dates` for open tickets with no valid due dates.

## Boundaries

- Closed and other non-open tickets keep the existing `ticket_not_open` behavior.
- Tickets with valid due dates still compute `breached`, `warning`, or `on_track` from those dates.
- No database migration, bulk reconciliation, provider write, external send, or live ticket mutation is included.
- Existing reconciliation writes remain governed by the current support-ticket runtime path.

## Validation

- `test-support-ticket-sla-stale-status-guard.mjs`
- `test-ticket-lifecycle-runtime-links.mjs`
- syntax validation
- architecture validation
- full test manifest
- `git diff --check`

## Rollback

Revert the PR. No schema or data rollback is required.
