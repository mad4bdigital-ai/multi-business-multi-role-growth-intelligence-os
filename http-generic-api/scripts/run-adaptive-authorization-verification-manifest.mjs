import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(
  root,
  "..",
  "specs",
  "006-adaptive-authorization-execution-governance",
  "verification-test-manifest.json",
);
const raw = fs.readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(raw);
const requiredCategories = new Set([
  "unit",
  "integration",
  "tenant_isolation",
  "replay",
  "stale_revision",
  "ambiguity",
  "redaction",
]);
const coveredCategories = new Set(
  manifest.tests.flatMap((entry) => entry.categories ?? []),
);

for (const category of requiredCategories) {
  if (!coveredCategories.has(category)) {
    throw new Error(`T050 verification category is not registered: ${category}`);
  }
}

const forbiddenOutputPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bBearer\s+eyJ[A-Za-z0-9._-]+\b/i,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
];

const seenIds = new Set();
const results = [];
for (const entry of manifest.tests) {
  if (!entry.id || seenIds.has(entry.id)) {
    throw new Error(`T050 verification test id is missing or duplicated: ${entry.id}`);
  }
  seenIds.add(entry.id);
  if (!/^[A-Za-z0-9._-]+\.mjs$/.test(entry.script)) {
    throw new Error(`T050 verification script is not a bounded local .mjs file: ${entry.script}`);
  }

  const scriptPath = path.join(root, entry.script);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`T050 verification script is missing: ${entry.script}`);
  }

  const requestShapeHash = createHash("sha256")
    .update(JSON.stringify({ id: entry.id, script: entry.script, categories: entry.categories }))
    .digest("hex");
  const completed = spawnSync(process.execPath, [entry.script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, T050_VERIFICATION_RUN: "1" },
    timeout: 120_000,
  });
  const output = `${completed.stdout ?? ""}\n${completed.stderr ?? ""}`;

  if (forbiddenOutputPatterns.some((pattern) => pattern.test(output))) {
    throw new Error(`Sensitive-data scan failed for T050 test: ${entry.id}`);
  }

  results.push({
    id: entry.id,
    requestShapeHash,
    status: completed.status === 0 ? "passed" : "failed",
  });
  if (completed.status !== 0) {
    process.stderr.write(output);
    throw new Error(`T050 verification test failed: ${entry.id}`);
  }
}

const counts = {
  executed: results.length,
  passed: results.filter((result) => result.status === "passed").length,
  failed: results.filter((result) => result.status === "failed").length,
  skipped: 0,
};
if (counts.failed !== 0 || counts.skipped !== 0 || counts.passed !== counts.executed) {
  throw new Error("T050 verification evidence is incomplete.");
}

const evidence = {
  task: manifest.task,
  featureKey: manifest.feature_key,
  manifestHash: createHash("sha256").update(raw).digest("hex"),
  revisionVectorHash: createHash("sha256")
    .update(results.map((result) => result.requestShapeHash).join(":"))
    .digest("hex"),
  counts,
  sensitiveDataScan: "passed",
  providerExecutionAllowed: false,
  externalWriteAllowed: false,
  migrationExecutionAlowed: false,
  canaryActivationAllowed: false,
  routeRemovalAllowed: false,
  enforcementCutoverAllowed: false,
};
console.log(JSON.stringify(evidence));
