import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/production-recovery-baseline-rebuild-governed.yml"), "utf8");
const runner = fs.readFileSync(path.join(ROOT, ".github/ops/production-recovery-baseline-rebuild-governed.mjs"), "utf8");

assert.match(workflow, /issue_comment:[\s\S]*types:\s*\[created\]/u);
assert.match(workflow, /github\.event\.issue\.number == 6813/u);
assert.match(workflow, /startsWith\(github\.event\.comment\.body, 'APPLY_HOSTINGER_RUNTIME_BASELINE_REBUILD:'\)/u);
assert.match(workflow, /startsWith\(github\.event\.comment\.body, 'APPROVE PRODUCTION RECOVERY '\)/u);
assert.match(workflow, /contents:\s*read/u);
assert.match(workflow, /issues:\s*write/u);
assert.match(workflow, /BACKEND_API_KEY:\s*\$\{\{\s*secrets\.BACKEND_API_KEY\s*\}\}/u);
assert.match(workflow, /cancel-in-progress:\s*false/u);

assert.match(runner, /APPLY_HOSTINGER_RUNTIME_BASELINE_REBUILD:\(\[0-9a-f\]\{40\}\):production-runtime:governance,runtime_persistence/u);
assert.match(runner, /APPROVE PRODUCTION RECOVERY/u);
assert.match(runner, /capability_key:\s*"database_full_inspection"/u);
assert.match(runner, /inspection_durable !== true/u);
assert.match(runner, /mutation_grade_durable !== true/u);
assert.match(runner, /capability_key:\s*"remediation_plan_create"/u);
assert.match(runner, /\/admin\/recovery\/kernel\/approval-challenge/u);
assert.match(runner, /\/admin\/recovery\/kernel\/execute-approved/u);
assert.match(runner, /server_issued_execution_ticket !== true/u);
assert.match(runner, /execution_ticket_returned !== false/u);
assert.match(runner, /approval_token_returned !== false/u);
assert.match(runner, /automatic_rerun_allowed:\s*false/u);
assert.match(runner, /\/admin\/recovery\/kernel\/runs\//u);

assert.ok(
  runner.indexOf('capability_key: "database_full_inspection"')
    < runner.indexOf('capability_key: "remediation_plan_create"'),
  "fresh inspection must precede plan creation",
);
assert.ok(
  runner.indexOf("/admin/recovery/kernel/approval-challenge")
    < runner.indexOf("/admin/recovery/kernel/execute-approved"),
  "server-side approval challenge must precede consequential execution",
);

assert.doesNotMatch(runner, /execute_sql_capsule|execute_shell_capsule|raw_sql|ssh_command|GRANT ALL/iu);
assert.doesNotMatch(runner, /execution_ticket_id\s*:/u);
assert.doesNotMatch(runner, /approval_token\s*:/u);

console.log("production_recovery_baseline_rebuild_governed=PASS");
