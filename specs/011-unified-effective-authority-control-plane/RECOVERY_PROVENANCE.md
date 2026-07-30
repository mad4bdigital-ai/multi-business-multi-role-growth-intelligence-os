# UEACP Recovery Provenance

## Purpose

This file records the governed recovery of Spec Kit `011-unified-effective-authority-control-plane` from stale mixed-scope PR `#2888` and the bounded replacement of its T010/T011 implementation slice.

## Source

- Source pull request: `#2888`
- Source branch: `gpt/011-unified-effective-authority-control-plane-20260720`
- Source condition at recovery: open, cumulative, and no longer suitable for merge as one unit

## Recovery boundary

The specification recovery copies only files under:

```text
specs/011-unified-effective-authority-control-plane/
```

It does not copy runtime source, root OpenAPI changes, routes, migrations, activation surfaces, generated artifacts, workflow changes, deployment configuration, or secrets from the stale branch.

This specification recovery performs no migration, provider call, credential payload read, external write, deployment, Production promotion, enforcement cutover, or protected-branch merge.

## Related implementation paths

- PR `#3351` is a closed, unmerged, superseded T010/T011 recovery path.
- PR `#3471` is the clean merged T010/T011 recovery path.
- Reviewed implementation head: `9452d47d628ca17985c998720b56060b6a82c7e7`.
- Merge SHA on `main`: `0ff39a85661a9552daa52d3a56338a24fe6bf560`.
- Merged at: `2026-07-30T10:17:40Z`.
- PR `#3471` passed the four required CI jobs and the additional repository guards recorded in `completion.json`.
- PR `#3471` added application/domain contracts and tests only; it did not add public routes, migrations, provider calls, deployment, Production promotion, or runtime enforcement cutover.
- Remaining UEACP implementation must continue through bounded PRs based on current `main`; this specification recovery does not authorize importing the residual runtime diff from `#2888`.

## Historical evidence rule

The following recovered documents preserve historical engineering evidence from the former branch:

- `implementation-evidence.md`
- `live-sql-census-gap-evidence.md`
- `query-performance-retention-review.md`
- `security-review-evidence.md`

Their recorded branch names, SHAs, PR status, CI results, live-read observations, and implementation claims are snapshots only. They are not current merge-readiness, migration, deployment, Production, or post-merge evidence.

Current T010/T011 evidence is limited to PR `#3471` and is explicitly recorded in `completion.json`. Other historical claims must be re-established on future clean replacement PRs.

## Safety readback

```text
spec_recovery_runtime_behavior_changed=false
t010_t011_runtime_wiring_enabled=false
migration_execution_authorized=false
provider_calls=false
credential_payload_reads=false
external_writes=false
deployment_authorized=false
production_promotion_authorized=false
secrets_included=false
```
