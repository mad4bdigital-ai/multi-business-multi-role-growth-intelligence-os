import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const registryMigration = readFileSync("migrations/285_sprint68_governed_migration_authorization_registry.sql", "utf8");
const completionMigration = readFileSync("migrations/286_sprint68_platform_schema_contract_completion_registry.sql", "utf8");

assert(runner.includes("governed_migration_authorization_registry"), "runner must consult DB-backed migration authorization registry");
assert(runner.includes("getMigrationAuthorization"), "runner must centralize migration authorization lookup");
assert(runner.includes("LEGACY_BOOTSTRAP_ALLOWED_MIGRATIONS"), "legacy allowlist must be renamed as bootstrap fallback, not the primary authority");
assert(!runner.includes("const ALLOWED_MIGRATIONS"), "runner must not expose hardcoded ALLOWED_MIGRATIONS as the primary authority");
assert(runner.includes("legacy_bootstrap_fallback"), "runner must retain a safe bootstrap fallback while registry table is absent");
assert(runner.includes("migration_not_authorized_in_db_registry"), "runner must fail closed when DB registry exists and migration is missing");
assert(runner.includes("authorization"), "runner output must include authorization evidence for diagnostics");

assert(registryMigration.includes("CREATE TABLE IF NOT EXISTS governed_migration_authorization_registry"), "migration must create authorization registry idempotently");
assert(registryMigration.includes("FROM governed_migration_ledger"), "migration must seed existing governed history dynamically from ledger");
assert(registryMigration.includes("285_sprint68_governed_migration_authorization_registry.sql"), "migration must self-authorize bootstrap migration");
assert(registryMigration.includes("286_sprint68_platform_schema_contract_completion_registry.sql"), "migration must authorize follow-on schema completion migration");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(registryMigration), "authorization registry migration must not be destructive");

assert(completionMigration.includes("crm.contact.list"), "completion migration must persist CRM synthetic endpoint contract");
assert(completionMigration.includes("wordpress_blog_publish_recovery"), "completion migration must persist WordPress recovery synthetic endpoint contract");
assert(completionMigration.includes("not_ready_inactive_missing_schema"), "completion migration must clear readiness from inactive missing-schema endpoints");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(completionMigration), "schema completion migration must not be destructive");

console.log("governed migration runner dynamic authorization tests passed");
