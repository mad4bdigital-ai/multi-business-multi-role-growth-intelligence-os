# DR Certification and Tool Bus Gated Read-Only Pilot

This runbook documents the Sprint 68 DR certification and Tool Bus gated read-only pilot surfaces.

## DR certification

Source-controlled certifiers live under:

- `http-generic-api/scripts/dr-certifiers/db-isolated-restore-certifier.mjs`
- `http-generic-api/scripts/dr-certifiers/n8n-isolated-restore-boot-certifier.mjs`

The certifiers are designed for local connector or dedicated restore hosts. They require explicit artifact, manifest, and recovery-key paths. Recovery-key content is read only inside the local restore process and is never printed or written to evidence.

Safety guarantees:

- No production DB touch.
- No n8n production user folder touch.
- No published Docker ports for DB restore.
- n8n binds to `127.0.0.1` on isolated ports.
- Plaintext SQL/ZIP restore material is removed after certification.
- Evidence summaries must set `secrets_included=false`.

Release readiness reads metadata-only summaries from:

- `platform_runtime_config.dr_certification.db_isolated_restore.latest`
- `platform_runtime_config.dr_certification.n8n_isolated_restore_boot.latest`

## Tool Bus gated read-only pilot

The pilot tool lives at:

- `http-generic-api/scripts/tool-bus-gated-read-only-dispatch.mjs`

It only allows tenant-safe Repository Intelligence tools:

- `tenant_repository_intelligence_report`
- `tenant_repository_action_planner_dry_run`
- `tenant_repository_intelligence_v3_v4_readiness_smoke`

The pilot validates the descriptor, policy, no-mutation/no-secret tags, and returns metadata-only readback. It does not call providers, mutate repositories, read credential payloads, or perform external writes.

## Workflow

`.github/workflows/dr-certification-readiness.yml` runs static contract checks on PR/push and on schedule. Full restore certification remains local/dedicated-host only because backup artifacts and recovery keys are not available to GitHub-hosted runners.
