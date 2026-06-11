# n8n VPS Migration Readiness Runbook

This runbook tracks migration from the temporary/local n8n origin to a VPS-hosted platform-managed origin.

## Required readiness evidence

- ESSAM/local n8n backup exists.
- VPS n8n target is provisioned.
- Workflows/data restore dry-run passes.
- Editor is reachable.
- Webhook domain is reachable.
- Rollback plan is documented.
- `connected_systems` can be updated from temporary origin to VPS origin after validation.

## Safety

Do not cut over `n8n.mad4b.com` or mutate `connected_systems` from a static scorecard. Cutover requires a separate governed rollout with backup, restore, validation, and rollback evidence.
