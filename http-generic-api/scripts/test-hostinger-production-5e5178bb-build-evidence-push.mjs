#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../../.github/workflows/hostinger-production-5e5178bb-build-evidence-push.yml", import.meta.url),
  "utf8",
);
const phase = JSON.parse(readFileSync(
  new URL("../../.changes/e2e/hostinger-production-5e5178bb-build-evidence-push.json", import.meta.url),
  "utf8",
));

for (const required of [
  /name: Hostinger Current Production Build Evidence Push/,
  /runs-on: ubuntu-latest/,
  /ref: \$\{\{ github\.sha \}\}/,
  /fetch-depth: 0/,
  /persist-credentials: false/,
  /git merge-base --is-ancestor "\$\{EVENT_SHA\}" "\$\{REMOTE_MAIN_SHA\}"/,
  /EXPECTED_PRODUCTION_SHA: 5e5178bb7d5b86fe42a5eb97e647a5d65edaaceb/,
  /PRODUCTION_MERGED_AT: "2026-08-03T06:16:38Z"/,
  /REPORTER_BLOB_SHA: 6134c0f8a454a5f8f1533f3f2a29ed6af77aa020/,
  /REPORTER_TEST_BLOB_SHA: 6e37c838129d38d6aee0ffe77d522dcf1d00d0cc/,
  /RUN_HOSTINGER_PRODUCTION_5E5178BB_BUILD_EVIDENCE_PUSH_V1/,
  /provider_method=GET/,
  /provider_mutation=false/,
  /build_creation=false/,
  /deployment=false/,
  /release_activation=false/,
  /restart=false/,
  /secrets_included=false/,
  /node scripts\/test-hostinger-nodejs-build-evidence\.mjs/,
  /node scripts\/hostinger-nodejs-build-evidence\.mjs/,
  /HOSTINGER_API_TOKEN: \$\{\{ secrets\.HOSTINGER_API_TOKEN \}\}/,
  /continue-on-error: true/,
  /Upload structured build evidence/,
  /Validate and publish bounded build decision/,
  /HOSTINGER_CURRENT_PRODUCTION_BUILD_EVIDENCE status=claiming/,
  /HOSTINGER_CURRENT_PRODUCTION_BUILD_EVIDENCE status=completed/,
]) assert.match(workflow, required);

for (const forbidden of [
  /actions:\s*write/,
  /pull_request:/,
  /workflow_dispatch:/,
  /nodejs\/server\/restart/,
  /nodejs\/builds\/from-archive/,
  /provider_mutation=true/,
  /build_creation=true/,
  /deployment=true/,
  /release_activation=true/,
  /restart=true/,
  /git push\s+--force/,
  /force-with-lease/,
  /refs\/heads\/Production.*update/,
]) assert.doesNotMatch(workflow, forbidden);

const bindingIndex = workflow.indexOf("Validate queue-stable marker and immutable bindings");
const claimIndex = workflow.indexOf("HOSTINGER_CURRENT_PRODUCTION_BUILD_EVIDENCE status=claiming");
const credentialIndex = workflow.indexOf("HOSTINGER_API_TOKEN: ${{ secrets.HOSTINGER_API_TOKEN }}");
const collectIndex = workflow.indexOf("Generate authenticated GET-only build evidence");
const scrubIndex = workflow.indexOf("Scrub exact provider token from persisted evidence");
const uploadIndex = workflow.indexOf("Upload structured build evidence");
const decisionIndex = workflow.indexOf("Validate and publish bounded build decision");
assert.ok(bindingIndex >= 0, "binding validation must exist");
assert.ok(claimIndex > bindingIndex, "claim must follow immutable validation");
assert.ok(credentialIndex > claimIndex, "provider credential must not be referenced before the durable claim");
assert.ok(collectIndex > claimIndex, "provider read must follow the durable claim");
assert.ok(scrubIndex > collectIndex, "exact-token scrub must follow collection");
assert.ok(uploadIndex > scrubIndex, "artifact upload must follow token scrub");
assert.ok(decisionIndex > uploadIndex, "decision must validate persisted evidence after upload");

assert.equal(phase.feature_key, "hostinger-production-5e5178bb-build-evidence-push");
assert.equal(phase.current_phase, "mvp");
assert.equal(phase.secrets_included, false);
assert.deepEqual(phase.scope.include, [
  ".changes/e2e/hostinger-production-5e5178bb-build-evidence-push.json",
  ".github/workflows/hostinger-production-5e5178bb-build-evidence-push.yml",
  "http-generic-api/scripts/test-hostinger-production-5e5178bb-build-evidence-push.mjs",
]);
const journey = phase.phases[0].e2e_journeys[0];
assert.equal(journey.end_to_end, true);
assert.equal(journey.level, "synthetic_runtime");
assert.ok(journey.assertions.some((value) => value.includes("queue-stable")));
assert.ok(journey.assertions.some((value) => value.includes("GET only")));
assert.ok(journey.assertions.some((value) => value.includes("do not authorize restart")));

console.log("Hostinger current Production build evidence push contract passed");
