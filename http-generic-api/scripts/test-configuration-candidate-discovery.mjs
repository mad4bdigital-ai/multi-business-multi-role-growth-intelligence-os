import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractCandidates, isReviewedImmutableSourceMirror, registryMatches } from "./maintenance-tools/configuration-candidate-discovery.mjs";

const fixture = `
const DEFAULT_TIMEOUT_MS = 30000;
const WRITE_ROUTE_APPROVAL_REQUIRED = true;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const OPENAPI_GENERATED_PATH = "http-generic-api/openapi/runtime.generated.yaml";
`;

const candidates = extractCandidates("http-generic-api/runtime/example.js", fixture);
assert.equal(candidates.length, 4);
assert.equal(candidates[0].candidate_class, "runtime_setting");
assert.equal(candidates[0].suggested_config_key, "timeout.ms");
assert.equal(candidates[1].candidate_class, "policy_candidate");
assert.equal(candidates[2].candidate_class, "secret_candidate");
assert.equal(candidates[2].secrets_included, false);
assert.match(candidates[2].value_preview, /REDACTED/u);
assert.equal(candidates[3].candidate_class, "generated_artifact");
assert.equal(new Set(candidates.map((item) => item.candidate_id)).size, candidates.length);
assert.ok(candidates.every((item) => !/CLIENT_SECRET=[^\s]+/iu.test(JSON.stringify(item))));

const generated = extractCandidates("docs/repository-inventory.generated.json", "const DEFAULT_LIMIT = 10;");
assert.equal(generated[0].candidate_class, "generated_artifact");
assert.equal(generated[0].migration_action, "exclude_from_migration");

assert.deepEqual(
  registryMatches({
    path: "http-generic-api/runtime/example.js",
    content: "const DEFAULT_TIMEOUT_MS = 30000;",
    suggestedConfigKey: "timeout.ms",
    registryKeys: new Set(["timeout.ms"]),
  }),
  ["known_config_key"],
);
assert.deepEqual(
  registryMatches({
    path: "http-generic-api/runtime/example.js",
    content: "const DEFAULT_TIMEOUT_MS = 30000;",
    suggestedConfigKey: "cache.key",
    registryKeys: new Set(),
  }),
  [],
);

const reviewedMirrorPath = "http-generic-api/scripts/e2e-parallel-pr-gate-legacy.mjs";
const reviewedMirrorContent = readFileSync(new URL("./e2e-parallel-pr-gate-legacy.mjs", import.meta.url), "utf8");
assert.equal(isReviewedImmutableSourceMirror(reviewedMirrorPath, reviewedMirrorContent), true);
assert.equal(isReviewedImmutableSourceMirror(reviewedMirrorPath, `${reviewedMirrorContent}\n// drift`), false);
assert.equal(isReviewedImmutableSourceMirror("http-generic-api/scripts/unreviewed-legacy.mjs", reviewedMirrorContent), false);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.configuration-candidate-discovery-regression.v1",
  fixture_candidates: candidates.length,
  immutable_mirror_hash_bound: true,
  secrets_included: false,
}));
