import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const docs = fs.readFileSync(new URL("../docs/database-lifecycle-reporting-views.md", import.meta.url), "utf8");
const manifest = fs.readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");

const aliases = [
  "database_lifecycle_scheduler_approval_proof_dry_run",
  "database_lifecycle_scheduler_approval_proof_apply",
  "database_lifecycle_scheduler_snapshot_dry_run",
  "database_lifecycle_scheduler_snapshot_apply",
];

for (const alias of aliases) {
  assert(routes.includes(`${alias}: {`), `admin shell allowlist must expose ${alias}`);
  assert(docs.includes(alias), `lifecycle docs must mention ${alias}`);
}

assert(routes.includes("database-lifecycle-scheduler-approval-proof.mjs"));
assert(routes.includes("database-lifecycle-scheduler-snapshot-runner.mjs"));
assert(routes.includes("DRY_RUN_ONLY_SHELL_ALIASES"));
assert(routes.includes("APPLY_ONLY_SHELL_ALIASES"));
assert(routes.includes("extraArgs.includes(\"--apply\")"));
assert(routes.includes("extraArgs.includes(\"--dry-run\")"));

for (const dryRunAlias of [
  "database_lifecycle_scheduler_approval_proof_dry_run",
  "database_lifecycle_scheduler_snapshot_dry_run",
]) {
  assert(
    routes.includes(`"${dryRunAlias}"`) && routes.includes("must not receive --apply"),
    `${dryRunAlias} must reject conflicting --apply extra args`
  );
}

for (const applyAlias of [
  "database_lifecycle_scheduler_approval_proof_apply",
  "database_lifecycle_scheduler_snapshot_apply",
]) {
  assert(
    routes.includes(`"${applyAlias}"`) && routes.includes("must not receive --dry-run"),
    `${applyAlias} must reject conflicting --dry-run extra args`
  );
}

assert(docs.includes("admin_control shell database_lifecycle_scheduler_approval_proof_dry_run"));
assert(docs.includes("admin_control shell database_lifecycle_scheduler_snapshot_apply"));
assert(
  manifest.includes("node test-database-lifecycle-scheduler-admin-aliases.mjs"),
  "test manifest must include scheduler admin alias contract test"
);

console.log("database lifecycle scheduler admin aliases tests passed");
