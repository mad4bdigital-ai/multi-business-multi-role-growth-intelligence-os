import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// Inspect each authenticated GitHub job, not just the top-level workflow event.
// Repo BACKEND_API_KEY is the pre-existing Windows Staging credential.
// Only jobs explicitly bound to GitHub Environment Production may use that
// secret name for Hostinger Production. GitHub secret presence must be checked live.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflows = join(root, ".github", "workflows");
const prodSecret = "secrets.BACKEND_API_KEY";
const stagingFiles = new Set(["staging-post-deploy-verification.yml"]);
const productionEnv = "    environment:\n      name: Production\n";
const productionShortEnv = "    environment: Production";
const records = [];
for (const filename of readdirSync(workflows).filter((s) => /\.ya?ml$/u.test(s)).sort()) {
  const source = readFileSync(join(workflows, filename), "utf8");
  const lines = source.split(/\r?\n/u);
  const jobsAt = lines.findIndex((line) => line === "jobs:");
  if (jobsAt < 0) continue;
  assert(!lines.some((line) => /^jobs:\s+\S/u.test(line)), `${filename}: malformed top-level jobs mapping`);
  const indexes = [];
  for (let i = jobsAt + 1; i < lines.length; i++) {
    const match = /^  ([A-Za-z0-9_-]+):\s*$/u.exec(lines[i]);
    if (match) indexes.push({ i, name: match[1] });
  }
  assert(indexes.length > 0, `${filename}: no jobs detected`);
  for (let i = 0; i < indexes.length; i++) {
    const job = indexes[i];
    const end = indexes[i + 1]?.i ?? lines.length;
    const text = lines.slice(job.i + 1, end).join("\n");
    if (!text.includes(prodSecret)) continue;
    const isStaging = stagingFiles.has(filename) || (filename === "verify-runtime.yml" && job.name === "verify-staging");
    if (isStaging) {
      if (filename === "verify-runtime.yml") {
        assert(!text.includes("    environment:"), "Windows Staging verifier must retain Repository Secret");
        assert(text.includes("needs: validate-target"), "Windows Staging verifier requires credential-free URL validation");
      }
      records.push({ filename, job: job.name, scope: "Windows Staging" });
      continue;
    }
    const protectedProduction = text.includes(productionEnv) || text.includes(productionShortEnv);
    assert(protectedProduction, `${filename}/${job.name}: Production backend key cannot fall back to Windows Staging Repository Secret`);
    if (filename === "verify-runtime.yml") {
      assert(text.includes("needs: validate-target"), "Production verifier must wait for allowlisted endpoint validation");
      assert(text.includes("deployment: false"), "Production verifier must not create a deployment");
    }
    if (filename.startsWith("ueacp-")) {
      assert(text.includes("needs: [contract, authorize-ueacp]"), "UEACP Production key must wait for independent reviewer");
      assert(text.includes("needs.authorize-ueacp.result == 'success'"), "UEACP reviewer denial must prevent Production job");
    }
    records.push({ filename, job: job.name, scope: "Production" });
  }
}
const vr = readFileSync(join(workflows, "verify-runtime.yml"), "utf8");
assert(vr.includes("runtime_target_secret_scope_mismatch"), "dynamic URL must fail closed before resolving any secret");
assert(vr.includes("staging\\|https://dev.mad4b.com"), "Staging origin must be exact");
assert(vr.includes("production\\|https://auth.mad4b.com"), "Production origin must be exact");
const runtime = readFileSync(join(root, "http-generic-api", "verify-runtime.mjs"), "utf8");
assert.equal(runtime.split('redirect: "manual"').length - 1, 2, "authenticated GET and POST must not follow redirects");
assert(records.some((entry) => entry.scope === "Windows Staging"), "Staging secret consumers missing from audit");
assert(records.some((entry) => entry.scope === "Production"), "Production secret consumers missing from audit");
assert(records.length >= 20, "unexpectedly small authenticated backend job inventory");
console.log(JSON.stringify({ contract: "mad4b.backend-key-environment-isolation.v1", passed: true, job_count: records.length, staging_jobs: records.filter((r) => r.scope === "Windows Staging").length, production_jobs: records.filter((r) => r.scope === "Production").length, secrets_included: false }));
