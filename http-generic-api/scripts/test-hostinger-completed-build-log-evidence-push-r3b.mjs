import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../../.github/workflows/hostinger-nodejs-completed-build-log-evidence-push-r3b.yml", import.meta.url),
  "utf8",
);
const canonicalWorkflow = readFileSync(
  new URL("../../.github/workflows/hostinger-nodejs-completed-build-log-evidence.yml", import.meta.url),
  "utf8",
);
const reporter = readFileSync(
  new URL("./hostinger-nodejs-completed-build-log-evidence.mjs", import.meta.url),
  "utf8",
);
const reporterTest = readFileSync(
  new URL("./test-hostinger-nodejs-completed-build-log-evidence.mjs", import.meta.url),
  "utf8",
);

for (const required of [
  /name: Hostinger Completed Build Log Evidence R3C Push/,
  /push:/,
  /branches:\n\s+- main/,
  /completed-build-log-evidence-r3c-f5c1ae88\.txt/,
  /runs-on: ubuntu-24\.04-arm/,
  /cancel-in-progress: false/,
  /permissions:\n\s+contents: read\n\s+issues: write/,
  /RUN_HOSTINGER_COMPLETED_BUILD_LOG_EVIDENCE_R3C_PUSH_F5C1AE88_V2/,
  /ref: \$\{\{ github\.sha \}\}/,
  /fetch-depth: 0/,
  /test "\$\{EVENT_SHA\}" = "\$\{EVENT_CHECKOUT_SHA\}"/,
  /git fetch --no-tags origin "\$\{REMOTE_MAIN_SHA\}"/,
  /git merge-base --is-ancestor "\$\{EVENT_SHA\}" "\$\{REMOTE_MAIN_SHA\}"/,
  /test "\$\{CURRENT_PRODUCTION_SHA\}" = "\$\{EXPECTED_PRODUCTION_SHA\}"/,
  /test "\$\{CHANGED_FILES\}" = "\$\{MARKER_PATH\}"/,
  /git rev-parse "\$\{EVENT_SHA\}:\$\{TARGET_WORKFLOW_PATH\}"/,
  /git rev-parse "\$\{REMOTE_MAIN_SHA\}:\$\{TARGET_WORKFLOW_PATH\}"/,
  /git rev-parse "\$\{EVENT_SHA\}:\$\{REPORTER_PATH\}"/,
  /git rev-parse "\$\{REMOTE_MAIN_SHA\}:\$\{REPORTER_PATH\}"/,
  /git rev-parse "\$\{EVENT_SHA\}:\$\{TEST_PATH\}"/,
  /git rev-parse "\$\{REMOTE_MAIN_SHA\}:\$\{TEST_PATH\}"/,
  /TARGET_WORKFLOW_BLOB_SHA: 94321b273e70f96180c0f058adbb291b035fd237/,
  /REPORTER_BLOB_SHA: 27abdc637431a93f5d18de74ea2e9985b98756db/,
  /TEST_BLOB_SHA: d15d4b8d653359e1061a4004217133e271410a0a/,
  /HOSTINGER_COMPLETED_BUILD_LOG_EVIDENCE_R3C_PUSH status=claiming/,
  /HOSTINGER_COMPLETED_BUILD_LOG_EVIDENCE_R3C_PUSH status=completed/,
  /event_is_live_main_ancestor=true/,
  /HOSTINGER_API_TOKEN: \$\{\{ secrets\.HOSTINGER_API_TOKEN \}\}/,
  /node scripts\/test-hostinger-nodejs-completed-build-log-evidence\.mjs/,
  /node scripts\/hostinger-nodejs-completed-build-log-evidence\.mjs/,
  /Scrub exact provider token from persisted evidence/,
  /Upload structured completed-build log evidence/,
  /expected_sha_found/,
  /provider_method=GET/,
  /provider_mutation=false/,
  /build_creation=false/,
  /deployment=false/,
  /release_activation=false/,
  /restart=false/,
  /sql=false/,
  /migration_apply=false/,
  /database_mutation=false/,
  /external_send=false/,
  /secrets_included=false/,
]) assert.match(workflow, required);

for (const forbidden of [
  /workflow_dispatch:/,
  /issue_comment:/,
  /pull_request:/,
  /pull_request_target:/,
  /actions:\s*write/,
  /contents:\s*write/,
  /ref: main/,
  /test "\$\{CURRENT_MAIN_SHA\}" = "\$\{REMOTE_MAIN_SHA\}"/,
  /nodejs\/server\/restart/,
  /nodejs\/builds\/from-archive/,
  /provider_mutation=true/,
  /build_creation=true/,
  /deployment=true/,
  /release_activation=true/,
  /restart=true/,
  /git push\s+--force/,
  /force-with-lease/,
]) assert.doesNotMatch(workflow, forbidden);

const markerValidation = workflow.indexOf("Validate exact marker, refs, blobs, and one-time binding");
const ancestry = workflow.indexOf("git merge-base --is-ancestor");
const liveBlob = workflow.indexOf('git rev-parse "${REMOTE_MAIN_SHA}:${TARGET_WORKFLOW_PATH}"');
const claim = workflow.indexOf("status=claiming");
const contract = workflow.indexOf("Validate canonical completed-build reporter contract");
const live = workflow.indexOf("Generate authenticated GET-only completed-build log evidence");
const scrub = workflow.indexOf("Scrub exact provider token from persisted evidence");
const upload = workflow.indexOf("Upload structured completed-build log evidence");
const decision = workflow.indexOf("Validate and publish bounded evidence decision");
const enforce = workflow.indexOf("Enforce expected Production source provenance");
assert.ok(markerValidation >= 0 && ancestry > markerValidation, "ancestry proof must be inside immutable validation");
assert.ok(liveBlob > ancestry && claim > liveBlob, "live-main blob proof must precede the claim");
assert.ok(contract > claim, "canonical contract must run after durable claim");
assert.ok(live > contract, "provider GET must follow canonical contract");
assert.ok(scrub > live, "secret scrub must follow evidence generation");
assert.ok(upload > scrub, "artifact upload must follow exact-token scrub");
assert.ok(decision > upload, "decision must validate uploaded payload");
assert.ok(enforce > decision, "final enforcement must follow durable result comment");

assert.match(canonicalWorkflow, /name: Hostinger Node\.js Completed Build Log Evidence/);
assert.match(canonicalWorkflow, /HOSTINGER_API_TOKEN: \$\{\{ secrets\.HOSTINGER_API_TOKEN \}\}/);
assert.match(canonicalWorkflow, /method === "GET"/);
assert.doesNotMatch(canonicalWorkflow, /nodejs\/server\/restart/);
assert.doesNotMatch(canonicalWorkflow, /nodejs\/builds\/from-archive/);

assert.match(reporter, /mad4b\.hostinger-nodejs-completed-build-log-evidence\.v1/);
assert.match(reporter, /method: "GET"/);
assert.match(reporter, /redactKnownSecret/);
assert.match(reporter, /serialized\.includes\(configuration\.token\)/);
assert.match(reporter, /provider_mutation_performed: false/);
assert.match(reporter, /restart_performed: false/);
assert.doesNotMatch(reporter, /method: "POST"/);
assert.doesNotMatch(reporter, /nodejs\/server\/restart/);

assert.match(reporterTest, /Hostinger completed-build log evidence contract test passed/);
assert.match(reporterTest, /expected_sha_found/);
assert.match(reporterTest, /provider_mutation_performed/);
assert.match(reporterTest, /restart_performed/);

console.log("Hostinger completed-build log evidence R3C push fallback contract test passed");
