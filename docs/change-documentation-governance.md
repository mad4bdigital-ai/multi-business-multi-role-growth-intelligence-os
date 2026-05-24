# Repo and SQL Change Documentation Governance

## Purpose

Every meaningful repo or SQL change must leave a durable written trail. Runtime behavior, registry mutations, repair actions, and operational guardrails must not live only in chat history or transient execution logs.

## Applies to

This policy applies to:

- source code changes
- migrations
- SQL replay or repair operations
- registry row mutations
- tool export changes
- OpenAPI/GPT Action schema changes
- connector or credential behavior changes
- session archive repairs
- deployment, DNS, Hostinger, Cloudflare, Drive, GitHub, or local connector operational changes

## Required documentation outputs

For each change, update at least one of the following, depending on scope:

| Change type | Required docs |
|---|---|
| Runtime/code behavior | `README.md`, `runtime_boundary_map.md`, relevant contract docs |
| Registry/taxonomy change | `docs/registry-taxonomy.md`, `Updating Registry Patch Index.md` |
| Auth/credential behavior | `docs/external-endpoint-auth-strategy.md`, `connector_contracts.md` |
| Restore/relink/incident recovery | incident runbook under `docs/`, `Updating Registry Patch Index.md`, `deployment_parity_checklist.md` |
| New migration or repair script | migration/script inline comments, runbook or operations doc, patch index |
| GPT action/tool schema change | OpenAPI/schema docs and affected tool registry notes |
| Deployment or CI behavior | `deployment_parity_checklist.md` |
| Agent operating rule | `AI_Agent_Knowledge_Guide.md` when safe, or a dedicated `docs/*` runbook linked from checklist docs |

## Patch index rule

`Updating Registry Patch Index.md` is the chronological operational ledger. Add a new patch entry whenever a change affects:

- SQL authority
- registry rows
- runtime routing
- credential selection
- deployment behavior
- archive/session repair
- recovery procedures

Do not duplicate patch numbers. If duplication is found, fix the ledger before adding new entries.

## SQL mutation note rule

For SQL mutations, record:

- target tables
- key predicates
- whether the change was dry-run or apply
- exact safety class: `CREATE IF NOT EXISTS`, `INSERT ... ON DUPLICATE`, scoped `UPDATE`, scoped `INSERT ... SELECT`, etc.
- confirmation that no `DROP`, `TRUNCATE`, or broad `DELETE` was used
- verification query/results

## Repo mutation note rule

For repo changes, record:

- files changed
- reason
- runtime behavior changed
- tests or checks run
- GitHub Actions run id and final conclusion

## CI schema/docs change guard

CI runs `http-generic-api/scripts/schema-docs-change-guard.mjs` in the syntax job. The guard compares the PR or push diff and fails when guarded runtime authority files change without matching schema, tests, docs, or canonical guidance.

Guarded files include:

```text
http-generic-api/routes/**
http-generic-api/migrations/**
registry/tool/workflow/credential runtime files
src/services/execution/**
src/services/connectors/**
src/store/registries/**
```

Coverage files include:

```text
http-generic-api/openapi*.yaml
http-generic-api/test-*.mjs
tests/**
docs/**
canonicals/**
schemas/**
AI_Agent_Knowledge_Guide.md
GPT_Admin_Assistant_Knowledge_Guide.md
other canonical guide/checklist files
```

This CI gate is the enforcement layer; database rows such as `agent_supervision_policy` are advisory/operational policy unless a runtime gate explicitly reads and enforces them.

## Post-push verification

After every push:

1. Read latest GitHub workflow run through the governed GitHub Actions tools.
2. If in progress, inspect jobs until all complete.
3. If any job fails, read logs, classify the failure, repair, push again, and repeat.
4. Do not mark the change complete until the target run has `status=completed` and `conclusion=success`.

## Backup boundary

Do not start any backup or restore operation merely because documentation or repair scripts were updated. Backup operations require a separate plan covering:

- source database
- destination path
- retention policy
- encryption/access control
- restore test
- naming convention
- owner approval

Stop before backup planning if that policy is not yet approved.
