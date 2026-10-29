# QA Docker lifecycle policy (report-only)

Read-only VPS baseline on 2026-10-29: 53 Docker containers, 50 running, 3 exited. Many apparently QA-related containers carry database storage, bind-mounted site source, production-facing routes or are Coolify-managed. Age and QA/test names do not establish deletion permission.

## Explicit lifecycle metadata for newly created disposable QA

Set labels on a verified isolated QA service or Compose stack:
- ops.lifecycle: ephemeral
- ops.environment: qa
- ops.owner: qa-team (replace with responsible owner)
- ops.expires_at: 2026-11-02T12:00:00Z (UTC)

Recommend a 72-hour lifetime for short-lived QA and explicitly renew before expiry if needed. Existing containers without labels are NEVER assigned implicit expiry.

## Retire a service safely

1. Inventory using python3 ops/vps-maintenance/docker_qa_inventory.py. The helper only performs Docker ps/inspect, never accesses Config.Env or container logs.
2. QA owner confirms test closure, no ongoing CI/QA, no in-flight requests, source and config uploaded to GitHub, and the exact orchestrator (Coolify/Compose/manual).
3. Inspect network dependency graph, ports, volumes, bind mounts and any database contents. Do not treat a persistent database as disposable. Backup/export only with data owner approval.
4. Drain/stop the whole isolated project using its governing orchestrator, after separately approved authority and maintenance window. Check all dependent services and health; retain an easy rollback.
5. After at least 24 hours of verified inactivity, remove only exact previously approved stopped containers. Preserve volumes, backups, images used for rollback and registry config unless separately reviewed.
6. Never run automatic Docker system prune, container prune, volume prune, compose down --volumes, or remove-by-name regex.

The classifier emits protected_managed, protected_data_or_critical, incomplete_or_invalid_qa_labels, labelled_qa_not_expired, expired_qa_manual_review, possible_qa_manual_review and unclassified_preserve. Every candidate retains cleanup_authorized=false.

An optional private daily report can be run through the reviewed host-hygiene systemd timer after approval. This PR does not install anything on VPS, stop containers, remove volumes, merge to main or enable automated cleanup.
