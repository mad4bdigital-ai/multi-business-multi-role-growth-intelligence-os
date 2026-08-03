import assert from "node:assert/strict";
import {
  DEFAULT_CLOCK_SKEW_MS,
  MAX_CLOCK_SKEW_MS,
  TENANT_GPT_AUDIENCE_COMPATIBILITY_METRIC,
  classifyTenantGptAudienceCompatibility,
  recordTenantGptAudienceCompatibilityEvidence,
  rejectTenantGptAudienceCompatibilityForResourceMismatch,
} from "./tenantGptAudienceCompatibilityPolicy.js";

const RESOURCE = "https://activation.mad4b.com";
const LEGACY = "mad4b-tenant-gpt";
const CUTOFF_MS = Date.parse("2026-10-31T23:59:59.000Z");
const NOW_MS = Date.parse("2026-08-04T00:00:00.000Z");
const IAT_SECONDS = Math.floor(NOW_MS / 1000);

function classify(overrides = {}) {
  return classifyTenantGptAudienceCompatibility({
    audience: RESOURCE,
    expectedResource: RESOURCE,
    legacyAudience: LEGACY,
    allowLegacyAudience: true,
    cutoffMs: CUTOFF_MS,
    nowMs: NOW_MS,
    issuedAtSeconds: IAT_SECONDS,
    ...overrides,
  });
}

assert.equal(DEFAULT_CLOCK_SKEW_MS, 5 * 60 * 1000);
assert.equal(MAX_CLOCK_SKEW_MS, DEFAULT_CLOCK_SKEW_MS);

const strict = classify();
assert.equal(strict.accepted, true);
assert.equal(strict.classification, "strict_resource_audience_accepted");
assert.equal(strict.audience_mode, "strict");
assert.equal(strict.legacy_audience_accepted, false);
assert.equal(strict.metric.name, TENANT_GPT_AUDIENCE_COMPATIBILITY_METRIC);
assert.equal(strict.metric.value, 1);
assert.deepEqual(Object.keys(strict.metric.labels).sort(), [
  "audience_mode", "classification", "cutoff_state", "outcome",
]);
assert.equal(strict.secrets_included, false);

const legacy = classify({ audience: LEGACY });
assert.equal(legacy.accepted, true);
assert.equal(legacy.classification, "legacy_audience_accepted_before_cutoff");
assert.equal(legacy.audience_mode, "legacy");
assert.equal(legacy.legacy_audience_present, true);
assert.equal(legacy.legacy_audience_accepted, true);
assert.equal(legacy.cutoff_state, "active");
assert.equal(legacy.cutoff_at, "2026-10-31T23:59:59.000Z");

assert.equal(classify({
  audience: LEGACY,
  allowLegacyAudience: false,
}).classification, "legacy_audience_rejected_disabled");
assert.equal(classify({
  audience: LEGACY,
  cutoffMs: 0,
}).classification, "legacy_audience_rejected_cutoff_unconfigured");
assert.equal(classify({
  audience: LEGACY,
  nowMs: CUTOFF_MS + 1,
}).classification, "legacy_audience_rejected_cutoff_elapsed");
assert.equal(classify({
  audience: LEGACY,
  issuedAtSeconds: null,
}).classification, "legacy_audience_rejected_iat_invalid");
assert.equal(classify({
  audience: LEGACY,
  issuedAtSeconds: Math.floor((NOW_MS + DEFAULT_CLOCK_SKEW_MS + 1000) / 1000),
}).classification, "legacy_audience_rejected_iat_future");
assert.equal(classify({
  audience: LEGACY,
  nowMs: CUTOFF_MS,
  issuedAtSeconds: Math.floor((CUTOFF_MS + 1000) / 1000),
  clockSkewMs: 2000,
}).classification, "legacy_audience_rejected_issued_after_cutoff");
assert.equal(classify({
  audience: LEGACY,
  issuedAtSeconds: Math.floor((NOW_MS + MAX_CLOCK_SKEW_MS + 1000) / 1000),
  clockSkewMs: Number.MAX_SAFE_INTEGER,
}).classification, "legacy_audience_rejected_iat_future",
"caller-provided clock skew must be capped at the governed maximum");

const exactBoundary = classify({
  audience: LEGACY,
  nowMs: CUTOFF_MS,
  issuedAtSeconds: Math.floor(CUTOFF_MS / 1000),
});
assert.equal(exactBoundary.accepted, true);
assert.equal(exactBoundary.classification, "legacy_audience_accepted_before_cutoff");

const multi = classify({ audience: [LEGACY, RESOURCE] });
assert.equal(multi.accepted, false);
assert.equal(multi.classification, "multi_audience_rejected");
assert.equal(multi.audience_mode, "legacy_mixed");
assert.equal(multi.legacy_audience_present, true);

const emptyMulti = classify({ audience: [] });
assert.equal(emptyMulti.accepted, false);
assert.equal(emptyMulti.classification, "multi_audience_rejected");

const mismatch = classify({ audience: "https://auth.mad4b.com" });
assert.equal(mismatch.accepted, false);
assert.equal(mismatch.classification, "audience_mismatch_rejected");
assert.equal(mismatch.legacy_audience_present, false);

const resourceMismatch = rejectTenantGptAudienceCompatibilityForResourceMismatch(legacy);
assert.equal(resourceMismatch.accepted, false);
assert.equal(resourceMismatch.classification, "token_resource_mismatch_rejected");
assert.equal(resourceMismatch.audience_mode, "legacy");
assert.equal(resourceMismatch.legacy_audience_present, true);
assert.equal(resourceMismatch.metric.labels.outcome, "rejected");

const loggerEvents = [];
const logger = {
  info(message, evidence) {
    loggerEvents.push({ level: "info", message, evidence });
  },
  warn(message, evidence) {
    loggerEvents.push({ level: "warn", message, evidence });
  },
};
assert.equal(recordTenantGptAudienceCompatibilityEvidence(strict, { logger }), true);
assert.equal(loggerEvents.length, 0, "strict acceptance must not create default log volume");
assert.equal(recordTenantGptAudienceCompatibilityEvidence(legacy, { logger }), true);
assert.equal(recordTenantGptAudienceCompatibilityEvidence(multi, { logger }), true);
assert.equal(loggerEvents.length, 2);
assert.equal(loggerEvents[0].level, "info");
assert.equal(loggerEvents[1].level, "warn");
for (const entry of loggerEvents) {
  const serialized = JSON.stringify(entry);
  assert.equal(serialized.includes("Bearer "), false);
  assert.equal(serialized.includes("access_token"), false);
  assert.equal(serialized.includes("user_id"), false);
  assert.equal(serialized.includes("tenant_id"), false);
  assert.equal(entry.evidence.secrets_included, false);
  assert.equal(entry.evidence.metric_name, TENANT_GPT_AUDIENCE_COMPATIBILITY_METRIC);
}

console.log("PASS tenant-gpt-audience-compatibility-policy");
