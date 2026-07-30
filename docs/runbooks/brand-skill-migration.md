# Brand Skill Migration Runbook

## Scope

This runbook governs `http-generic-api/migrations/20260728_brand_scoped_user_skill_activation.sql`.

Repository merge, documentation, preflight, or CI success does not authorize migration apply. Applying the migration requires a separate typed approval bound to the final reviewed commit SHA, the exact UTF-8/LF SHA-256 checksum, and statement count `3`.

The migration creates only:

- `brand_skill_policies`
- `user_brand_skill_grants`
- `v_effective_user_brand_skill_grants`

It seeds no policies, creates no grants, activates no skills, performs no provider call, reads no credential payload, returns no raw secret, sends nothing externally, and performs no external write.

## Read-only compatibility preflight

Run from `http-generic-api` against the intended database environment:

```bash
node scripts/brand-skill-migration-preflight.mjs
```

The command is read-only and must report:

- `ready=true`
- `status=pass`
- `applies_sql=false`
- MariaDB server identity
- availability of `utf8mb4_uca1400_ai_ci`
- a valid 64-character `SHA2(..., 256)` probe
- absence of all three target objects
- compatible `agent_skills.skill_id` collation and prerequisite columns
- presence of the baseline `agent_skill_grants` table
- presence of `v_effective_agent_skill_grants` as a view
- runtime-required baseline view columns `grant_id`, `agent_id`, `skill_id`, `tenant_id`, and `brand_key` with compatible collations
- `runtime_baseline_required=true`
- `runtime_baseline_checked=true`
- `provider_calls=false`
- `external_writes=false`
- `secrets_included=false`

If any target object already exists, stop. Do not rely on `CREATE TABLE IF NOT EXISTS` to reconcile a partial or incompatible schema. Perform exact `SHOW CREATE` and information-schema readback, then prepare a separately reviewed corrective migration if necessary.

If the baseline agent-skill table or effective view is missing or incompatible, stop before migration apply. Repair the baseline authority through its own reviewed migration; do not weaken the Brand Skills runtime requirement.

## Final artifact binding

Before approval, record from the final reviewed branch head:

```bash
sha256sum http-generic-api/migrations/20260728_brand_scoped_user_skill_activation.sql
```

Also verify the governed SQL parser reports exactly three statements. The approval must expire if the commit SHA, checksum, statement count, target environment, or preflight evidence changes.

## Automated certification

Workflow:

```text
.github/workflows/brand-skill-mariadb-certification.yml
```

Every matching pull request runs `disposable-mariadb-certification` against a MariaDB 11.4 service container. This job may apply the migration only to that disposable CI database. It validates:

- static preflight status and exactly three SQL statements;
- live compatibility preflight before migration apply;
- creation of the three target objects;
- `suspended` lifecycle support;
- stored, delimiter-safe active-scope hashing;
- unique active-scope index presence;
- empty policy/grant/effective state immediately after schema creation;
- two scopes that collide under raw delimiter concatenation remain distinct under the HEX-based hash;
- suspended grants receive no active-scope hash;
- the effective view returns active grants only;
- fixture data is rolled back and the database returns to empty state.

The uploaded artifact is:

```text
brand-skill-mariadb-certification
```

It must state:

- `applies_to_disposable_only=true`
- `production_authorized=false`
- `staging_apply_authorized=false`
- `applies_sql_to_external_environment=false`
- `secrets_included=false`

### Staging read-only mode

Run the same workflow manually with:

```text
run_mode=staging_read_only
expected_commit_sha=<full reviewed 40-character SHA>
expected_migration_sha256=<exact migration SHA-256>
```

The job is bound to the GitHub environment named `staging` and requires these environment secrets:

- `STAGING_DB_HOST`
- `STAGING_DB_NAME`
- `STAGING_DB_USER`
- `STAGING_DB_PASSWORD`
- `STAGING_DB_PORT` — optional; defaults to `3306`

The job checks out the exact typed commit, rejects a checkout mismatch, verifies the exact migration checksum and statement count, then executes only the read-only compatibility preflight. It does not invoke the governed migration runner, pass `--apply`, write the migration ledger, create schema objects, seed policies, or create grants.

The uploaded artifact is:

```text
brand-skill-staging-read-only-preflight
```

A successful artifact must state:

- `target_environment=staging`
- `ready=true`
- `applies_sql=false`
- `records_ledger=false`
- `migration_apply_authorized=false`
- `production_authorized=false`
- `requires_separate_apply_authorization=true`
- `secrets_included=false`

Missing secrets, a non-Staging target, an incorrect commit, an incorrect checksum, incompatible baseline objects, existing target objects, or any failed compatibility check must fail closed.

## Staging apply sequence

1. Confirm a current backup or environment-appropriate snapshot.
2. Run the checksum-bound Staging read-only workflow and retain its artifact.
3. Confirm the target object set is absent.
4. Confirm baseline agent-skill table/view authority passes readback.
5. Create a fresh governed migration authorization bound to the final SHA-256 and statement count.
6. Run governed dry-run and require zero destructive statements.
7. Apply once through the governed migration executor.
8. Perform same-cycle schema and data readback.
9. Do not seed a policy or grant during the schema migration run.

## Same-cycle schema readback

```sql
SELECT VERSION() AS database_version, @@version_comment AS version_comment;
SELECT SHA2('brand-skill-preflight', 256) AS sha2_probe;

SHOW TABLES LIKE 'agent_skill_grants';
SHOW FULL TABLES LIKE 'v_effective_agent_skill_grants';
SHOW TABLES LIKE 'brand_skill_policies';
SHOW TABLES LIKE 'user_brand_skill_grants';
SHOW FULL TABLES LIKE 'v_effective_user_brand_skill_grants';

SHOW CREATE TABLE agent_skill_grants;
SHOW CREATE VIEW v_effective_agent_skill_grants;
SHOW CREATE TABLE brand_skill_policies;
SHOW CREATE TABLE user_brand_skill_grants;
SHOW CREATE VIEW v_effective_user_brand_skill_grants;
```

Confirm:

- `user_brand_skill_grants.status` supports `active`, `pending`, `suspended`, `revoked`, and `expired`.
- `active_scope_hash` is a stored generated column.
- every scope component is encoded with `HEX(...)` before delimiter concatenation.
- `uq_user_brand_skill_grant_active_scope` exists and is unique.
- `utf8mb4_uca1400_ai_ci` is used for identity and scope columns.
- the user-brand effective view filters to active, unexpired grants and active policies/skills.
- the baseline effective view still exposes the runtime-required grant, agent, skill, tenant, and brand columns.

## Empty-state readback

Immediately after schema apply and before any separate seeding operation:

```sql
SELECT COUNT(*) AS policy_count FROM brand_skill_policies;
SELECT COUNT(*) AS grant_count FROM user_brand_skill_grants;
SELECT COUNT(*) AS effective_grant_count FROM v_effective_user_brand_skill_grants;
SELECT COUNT(*) AS baseline_agent_grant_count FROM agent_skill_grants;
```

Expected results:

- `policy_count = 0`
- `grant_count = 0`
- `effective_grant_count = 0`
- the baseline `agent_skill_grants` count is unchanged from pre-apply evidence

## Runtime staging validation

Policy and grant test data must be created only in a separate staging operation. Validate:

1. no-policy legacy Gate behavior;
2. explicit-enforcement failure without a policy;
3. self-service activation with valid membership, agent grant, resource authority, and policy;
4. repeated activation returns the existing scope and does not create a duplicate;
5. requested operations may expand only inside the current policy;
6. configured TTL clamps a broader existing grant;
7. expired grants are transitioned once and the scope can be reactivated;
8. `disabled`, `approval_required`, wrong user, wrong brand, wrong resource, and denied operation fail closed;
9. no provider call or external write occurs.

Remove or revoke staging test data after verification.

## Rollback decision

Rollback is never automatic.

### Before migration apply

Do not apply. No database rollback is needed.

### After schema apply with zero policies and zero grants

A destructive rollback may be considered only through a separate reviewed and authorized migration after confirming no runtime dependency. The order would be view first, then grants table, then policies table. Do not execute these drops from this runbook.

### After policies or grants exist

Do not drop objects directly. First:

1. disable or bypass the feature through an independently reviewed runtime change;
2. export and archive policy/grant data;
3. verify no workflow, route, or authorization decision depends on the objects;
4. revoke active grants;
5. execute a separately reviewed rollback migration with same-cycle absence and runtime readback.

## Safety markers

- no_provider_call
- no_credential_payload_read
- no_raw_secrets
- no_external_send
- no_external_write
- secrets_included_false
