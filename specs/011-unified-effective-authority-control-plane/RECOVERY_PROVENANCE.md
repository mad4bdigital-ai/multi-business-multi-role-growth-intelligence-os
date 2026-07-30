# UEACP Recovery Provenance

## Purpose

This file records the governed recovery of Spec Kit `011-unified-effective-authority-control-plane` from stale mixed-scope PR `#2888`.

## Source

- Source pull request: `#2888`
- Source branch: `gpt/011-unified-effective-authority-control-plane-20260720`
- Source condition at recovery: open, cumulative, and no longer suitable for merge as one unit

## Recovery boundary

The recovery copies only files under:

```text
specs/011-unified-effective-authority-control-plane/
```

It does not copy runtime source, root OpenAPI changes, routes, migrations, activation surfaces, generated artifacts, workflow changes, deployment configuration, or secrets from the stale branch.

This recovery performs no migration, provider call, credential payload read, external write, deployment, Production promotion, enforcement cutover, or protected-branch merge.

## Related implementation paths

- PR `#3351` is a closed, unmerged, superseded T010/T011 recovery path.
- PR `#3471` is the current clean T010/T011 recovery path.
- Remaining UEACP implementation must continue through bounded PRs based on current `main`; this specification recovery does not authorize importing the residual runtime diff from `#2888`.

## Historical evidence rule

The following recovered documents preserve historical engineering evidence from the former branch:

- `implementation-evidence.md`
- `live-sql-census-gap-evidence.md`
- `query-performance-retention-review.md`
- `security-review-evidence.md`

Their recorded branch names, SHAs, PR status, CI results, live-read observations, and implementation claims are snapshots only. They are not current merge-readiness, migration, deployment, Production, or post-merge evidence. Current claims must be re-established on each clean replacement PR and recorded in `completion.json`.

## Safety readback

```text
runtime_behavior_changed=false
migration_execution_authorized=false
provider_calls=false
credential_payload_reads=false
external_writes=false
deployment_authorized=false
production_promotion_authorized=false
secrets_included=false
```
