import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyStagingEmptyRoleCensus } from "./scripts/classify-staging-empty-role-census.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const classifier = path.join(root, "http-generic-api/scripts/classify-staging-empty-role-census.mjs");
const roles = ["runtime", "governance", "runtime_persistence"];
const empty = roles.map((role) => ({ role, object_count: 0 }));
assert.equal(classifyStagingEmptyRoleCensus(empty).ready_for_rebuild_empty, true);
assert.deepEqual(classifyStagingEmptyRoleCensus(empty).roles.map((row) => row.role), ["governance", "runtime", "runtime_persistence"]);
for (const i of [0, 1, 2]) {
  const partial = empty.map((row, index) => ({ ...row, object_count: index === i ? 1 : 0 }));
  const result = classifyStagingEmptyRoleCensus(partial);
  assert.equal(result.ready_for_rebuild_empty, false);
  assert.equal(result.roles.find((row) => row.role === roles[i]).classification, "non_empty_requires_separate_diagnosis");
  assert.equal(spawnSync(process.execPath, [classifier, "--census-json", JSON.stringify(partial)], { encoding: "utf8" }).status, 2);
}
for (const invalid of [empty.slice(1), [...empty, empty[0]], [{ ...empty[0], object_count: -1 }, ...empty.slice(1)],
  [{ ...empty[0], role: "production" }, ...empty.slice(1)], [{ ...empty[0], object_count: 0.5 }, ...empty.slice(1)]]) {
  assert.throws(() => classifyStagingEmptyRoleCensus(invalid));
}
assert.equal(spawnSync(process.execPath, [classifier, "--census-json", JSON.stringify(empty)], { encoding: "utf8" }).status, 0);

const importer = fs.readFileSync(path.join(root, "autopilot-portable-staging/Clone-StagingDatabases.Legacy.ps1"), "utf8");
const replay = fs.readFileSync(path.join(root, "http-generic-api/scripts/prepare-staging-role-schema-replay.mjs"), "utf8");
const entry = fs.readFileSync(path.join(root, "autopilot-portable-staging/Rebuild-EmptyStagingRoleDatabases.ps1"), "utf8");
const seed = fs.readFileSync(path.join(root, "http-generic-api/config/staging-empty-governance-certification-seed.sql"), "utf8");
assert.match(importer, /function Assert-EmptyRoleDatabases/u);
for (const surface of ["information_schema.TABLES", "information_schema.ROUTINES", "information_schema.TRIGGERS", "information_schema.EVENTS"]) {
  assert.ok(importer.includes(surface) && entry.includes(surface), `${surface} must be included in both root censuses`);
}
assert.ok(importer.indexOf("$preImportCensus = Assert-EmptyRoleDatabases") < importer.indexOf("$state = [ordered]@{"));
assert.ok(importer.indexOf("$preImportCensus = Assert-EmptyRoleDatabases") < importer.indexOf("$item.Service bash -o pipefail -c"));
assert.match(importer, /bash -o pipefail -c/u);
assert.match(replay, /views: plan\.roles\[role\]\.views/u);
assert.match(importer, /Assert-SetEqual \$item\.ExpectedViews \$observedViews/u);
assert.match(entry, /classify-staging-empty-role-census\.mjs/u);
assert.ok(entry.indexOf("$classification = $classificationJson") < entry.indexOf("& node $builder --expected-commit $ExpectedCommit --confirm"));
assert.ok(entry.indexOf("-Mode schema_only -Apply") < entry.indexOf("$seedSql \| & docker compose"));
assert.match(entry, /grants=not_applied runtime_certification=not_asserted gateway_apply_certification=pending next_action=database\.access_repair/u);
assert.doesNotMatch(entry, /Repair-StagingDatabaseReadiness|GrantConfirmation|RepairConfirmation/u);
assert.match(seed, /'staging_activation_gateway_apply_v1'/u);
assert.match(seed, /'pending'/u);
assert.doesNotMatch(seed, /^\s*(?:DROP|DELETE|UPDATE|GRANT|REVOKE)\b/imu);
console.log("Staging empty-role census and fail-closed bootstrap contracts passed");
