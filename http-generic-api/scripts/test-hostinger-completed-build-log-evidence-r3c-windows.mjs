import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../../.github/workflows/hostinger-nodejs-completed-build-log-evidence-r3c-windows.yml", import.meta.url),
  "utf8",
);
const reporter = readFileSync(
  new URL("./hostinger-nodejs-completed-build-log-evidence.mjs", import.meta.url),
  "utf8",
);

for (const required of [
  /name: Hostinger Completed Build Log Evidence R3C Windows/,
  /push:/,
  /completed-build-log-evidence-r3c-windows-f5c1ae88\.txt/,
  /runs-on: windows-latest/,
  /shell: bash/,
  /shell: pwsh/,
  /cancel-in-progress: false/,
  /permissions:\n\s+contents: read\n\s+issues: write/,
  /ref: \$\{\{ github\.sha \}\}/,
  /RUN_HOSTINGER_COMPLETED_BUILD_LOG_EVIDENCE_R3C_WINDOWS_F5C1AE88_V1/,
  /test "\$\{EVENT_SHA\}" = "\$\{REMOTE_MAIN_SHA\}"/,
  /test "\$\{CURRENT_PRODUCTION_SHA\}" = "\$\{EXPECTED_PRODUCTION_SHA\}"/,
  /TARGET_WORKFLOW_BLOB_SHA: 94321b273e70f96180c0f058adbb291b035fd237/,
  /REPORTER_BLOB_SHA: 27abdc637431a93f5d18de74ea2e9985b98756db/,
  /TEST_BLOB_SHA: d15d4b8d653359e1061a4004217133e271410a0a/,
  /HOSTINGER_COMPLETED_BUILD_LOG_EVIDENCE_R3C_WINDOWS status=claiming/,
  /HOSTINGER_COMPLETED_BUILD_LOG_EVIDENCE_R3C_WINDOWS status=completed/,
  /node scripts\/test-hostinger-nodejs-completed-build-log-evidence\.mjs/,
  /node scripts\/hostinger-nodejs-completed-build-log-evidence\.mjs/,
  /Scrub exact provider token from persisted evidence/,
  /Upload structured completed-build log evidence/,
  /expected_sha_found/,
  /runner_pool=windows-latest/,
  /provider_method=GET/,
  /provider_mutation=false/,
  /restart=false/,
  /secrets_included=false/,
]) assert.match(workflow, required);

for (const forbidden of [
  /workflow_dispatch:/,
  /issue_comment:/,
  /pull_request:/,
  /pull_request_target:/,
  /actions:\s*write/,
  /contents:\s*write/,
  /nodejs\/server\/restart/,
  /nodejs\/builds\/from-archive/,
  /provider_mutation=true/,
  /restart=true/,
  /git push\s+--force/,
  /force-with-lease/,
]) assert.doesNotMatch(workflow, forbidden);

const validate = workflow.indexOf("Validate exact marker, refs, blobs, and one-time binding");
const claim = workflow.indexOf("status=claiming");
const contract = workflow.indexOf("Validate canonical completed-build reporter contract");
const live = workflow.indexOf("Generate authenticated GET-only completed-build log evidence");
const scrub = workflow.indexOf("Scrub exact provider token from persisted evidence");
const upload = workflow.indexOf("Upload structured completed-build log evidence");
const result = workflow.indexOf("Validate and publish bounded evidence decision");
const enforce = workflow.indexOf("Enforce expected Production source provenance");
assert.ok(validate >= 0 && claim > validate);
assert.ok(contract > claim && live > contract);
assert.ok(scrub > live && upload > scrub);
assert.ok(result > upload && enforce > result);

assert.match(reporter, /mad4b\.hostinger-nodejs-completed-build-log-evidence\.v1/);
assert.match(reporter, /method: "GET"/);
assert.match(reporter, /serialized\.includes\(configuration\.token\)/);
assert.match(reporter, /provider_mutation_performed: false/);
assert.match(reporter, /restart_performed: false/);
assert.doesNotMatch(reporter, /method: "POST"/);

console.log("Hostinger completed-build log evidence R3C Windows contract test passed");
