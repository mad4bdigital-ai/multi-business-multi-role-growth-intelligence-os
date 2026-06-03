import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runbook = readFileSync("docs/hostinger-runtime-sync-runbook.md", "utf8");

assert(runbook.includes("Hostinger Runtime Sync Guard"), "runbook must define Hostinger runtime sync guard");
assert(runbook.includes("release_readiness") && runbook.includes("overall: pass"), "runbook must require release readiness pass");
assert(runbook.includes("repo_inspect"), "runbook must require live-code readback");
assert(runbook.includes("remote_database"), "runbook must guard remote database intake readiness");
assert(runbook.includes("DB_HOST") && runbook.includes("DB_PASSWORD"), "runbook must list remote DB credential fields");
assert(runbook.includes("ssh_private_key") && !runbook.match(/SSH credential intake fields[\s\S]{0,300}DB_NAME/), "runbook must keep DB_NAME out of SSH intake");
assert(runbook.includes("Do not paste SSH, DB, API, or Hostinger credentials into chat"), "runbook must forbid secrets in chat");
assert(runbook.includes("Do not set `remote_runtime_targets.validation_status = 'valid'` without a real probe"), "runbook must forbid manual valid status shortcuts");
assert(runbook.includes("maybeAutoPromotePlatformSecrets"), "runbook must require auto-promotion code readback before issuing intake");

console.log("Hostinger runtime sync runbook guard passed");
