# Repository Conflict Intelligence Phase 2

## Scope

Phase 2 activates four safe operating surfaces on top of the merged analyzer:

1. Production smoke contracts for ADMIN and TENANT-safe responses.
2. A reproducible case study for the stale PR #2474 generated-doc conflict.
3. A resolver dry-run that emits typed operations but performs no Git mutation.
4. A PR automation preview that produces a bounded advisory-comment plan without posting it.

## Resolver dry-run contract

The resolver dry-run accepts analysis metadata or raw compare/file/commit metadata. It returns:

- classification and recommended path
- typed resolution operations
- blocked paths
- required acceptance gates
- capability-envelope and approval requirements
- `provider_write: false`
- `execution_allowed: false`

The dry-run must not create branches, update refs, comment on PRs, merge, delete branches, or call provider write endpoints.

## PR automation preview

The automation preview decides whether a PR needs an advisory comment and returns sanitized Markdown. Posting remains a separate governed operation using a plan-bound approval hold and typed confirmation.

## Case study

`pr_2474_generated_docs_conflict` demonstrates the expected behavior:

- generated docs are classified separately from runtime source files
- docs-agent commits trigger clean-branch replay
- semantic files remain represented in the action plan
- no provider write occurs
- sensitive paths remain `manual_required`

## Acceptance criteria

- ADMIN smoke returns the expected generated-doc classification.
- TENANT smoke returns no execution capability and no cross-tenant metadata.
- Resolver dry-run never marks execution as allowed.
- Comment preview contains classification, recommendation, bounded file summary, and no secrets.
- OpenAPI 3.1 documents every Phase 1 and Phase 2 endpoint.
- Registry migration is additive and idempotent.
