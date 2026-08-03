#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../../.github/workflows/hostinger-current-production-build-evidence-r4.yml", import.meta.url),
  "utf8",
);
const phase = JSON.parse(readFileSync(
  new URL("../../.changes/e2e/hostinger-current-production-build-evidence-r4.json", import.meta.url),
  "utf8",
));

for (const required of [
  /name: Hostinger Current Production Build Evidence R4/,
  /workflow_dispatch:/,
  /expected_head_sha:/,
  /issue_comment:/,
  /runs-on: ubuntu-latest/,
  /AUTHORIZATION_COMMENT_ID: '5164305233'/,
  /AUTHORIZATION_USER_ID: '271942579'/,
  /AUTHORIZE_HOSTINGER_CURRENT_PRODUCTION_BUILD_EVIDENCE_5E5178BB_6134C0F8_R4/,
  /RUN_HOSTINGER_CURRENT_PRODUCTION_BUILD_EVIDENCE_5E5178BB_6134C0F8_R4/,
  /EXPECTED_PRODUCTION_SHA: 5e5178bb7d5b86fe42a5eb97e647a5d65edaaceb/,
  /PRODUCTION_MERGED_AT: '2026-08-03T06:16:38Z'/,
  /REPORTER_BLOB_SHA: 6134c0f8a454a5f8f1533f3f2a29ed6af77aa020/,
  /REPORTER_TEST_BLOB_SHA: 6e37c838129d38d6aee0ffe77d522dcf1d00d0cc/,
  /MUTATION_TARGET_BRANCH: issue-metadata-only/,
  /MUTATION_TARGET_BRANCH.*main/s,
  /MUTATION_TARGET_BRANCH.*Production/s,
  /exit 1/,
  /CURRENT_HEAD_SHA=.*git\/ref\/heads\/main/s,
  /test "\$\{CURRENT_HEAD_SHA\}" = "\$\{EXPECTED_HEAD_SHA\}"/,
  /ref: \$\{\{ steps\.expected\.outputs\.expected_head_sha \}\}/,
  /persist-credentials: false/,
  /HOSTINGER_API_TOKEN: \$\{\{ secrets\.HOSTINGER_API_TOKEN \}\}/,
  /node scripts\/test-hostinger-nodejs-build-evidence\.mjs/,
  /node scripts\/hostinger-nodejs-build-evidence\.mjs/,
  /continue-on-error: true/,
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
  /HOSTINGER_CURRENT_PRODUCTION_BUILD_EVIDENCE_R4 status=claiming/,
  /HOSTINGER_CURRENT_PRODUCTION_BUILD_EVIDENCE_R4 status=completed/,
  /Upload structured build evidence/,
  /Validate and publish bounded build decision/,
]) assert.match(workflow, required);

for (const forbidden of [
  /pull_request:/,
  /(?:^|\n)\s*push\s*:/,
  /actions:\s*write/,
  /contents:\s*write/,
  /nodejs\/server\/restart/,
  /nodejs\/builds\/from-archive/,
  /provider_mutation=true/,
  /build_creation=true/,
  /deployment=true/,
  /release_activation=true/,
  /restart=true/,
  /git push/,
  /force-with-lease/,
  /--force/,
  /refs\/heads\/Production.*update/,
]) assert.doesNotMatch(workflow, forbidden);

const expectedIndex = workflow.indexOf("Resolve explicit expected head SHA");
const checkoutIndex = workflow.indexOf("Checkout exact authorized main head");
const bindingIndex = workflow.indexOf("Verify authorization and immutable bindings");
const claimIndex = workflow.indexOf("HOSTINGER_CURRENT_PRODUCTION_BUILD_EVIDENCE_R4 status=claiming");
const credentialIndex = workflow.indexOf("HOSTINGER_API_TOKEN: ${{ secrets.HOSTINGER_API_TOKEN }}");
const collectIndex = workflow.indexOf("Generate authenticated GET-only build evidence");
const scrubIndex = workflow.indexOf("Scrub token and guarantee diagnostic packet");
const uploadIndex = workflow.indexOf("Upload structured build evidence");
const decisionIndex = workflow.indexOf("Validate and publish bounded build decision");
assert.ok(expectedIndex >= 0, "expected-head resolution must exist");
assert.ok(checkoutIndex > expectedIndex, "checkout must follow expected-head resolution");
assert.ok(bindingIndex > checkoutIndex, "binding validation must follow exact checkout");
assert.ok(claimIndex > bindingIndex, "claim must follow immutable validation");
assert.ok(credentialIndex > claimIndex, "provider credential must not be referenced before the durable claim");
assert.ok(collectIndex > claimIndex, "provider read must follow the durable claim");
assert.ok(scrubIndex > collectIndex, "token scrub must follow collection");
assert.ok(uploadIndex > scrubIndex, "artifact upload must follow token scrub");
assert.ok(decisionIndex > uploadIndex, "decision must validate persisted evidence after upload");

assert.equal(phase.feature_key, "hostinger-current-production-build-evidence-r4");
assert.equal(phase.current_phase, "mvp");
assert.equal(phase.secrets_included, false);
assert.deepEqual(phase.scope.include, [
  ".changes/e2e/hostinger-current-production-build-evidence-r4.json",
  ".github/workflows/hostinger-current-production-build-evidence-r4.yml",
  "http-generic-api/scripts/test-hostinger-current-production-build-evidence-r4.mjs",
]);
const journey = phase.phases[0].e2e_journeys[0];
assert.equal(journey.end_to_end, true);
assert.equal(journey.level, "synthetic_runtime");
assert.ok(journey.assertions.some((value) => value.includes("expected_head_sha")));
assert.ok(journey.assertions.some((value) => value.includes("GET only")));
assert.ok(journey.assertions.some((value) => value.includes("do not authorize restart")));

console.log("Hostinger current Production build evidence R4 contract passed");
