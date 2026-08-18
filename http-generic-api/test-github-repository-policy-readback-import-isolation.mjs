import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sourceFiles = {
  controller: "githubRepositoryPolicyController.js",
  facade: "capabilityResolutionEnvelopeGuard.js",
  runtime: "capabilityResolutionEnvelopeGuardRuntime.js",
  bootstrap: "activationBootstrapConfig.js",
};

const source = Object.fromEntries(
  Object.entries(sourceFiles).map(([key, relativePath]) => [key, readFileSync(new URL(`./${relativePath}`, import.meta.url), "utf8")]),
);

assert.doesNotMatch(source.controller, /from ["']\.\/db\.js["']/);
assert.doesNotMatch(source.facade, /from ["']\.\/governanceDb\.js["']/);
assert.doesNotMatch(source.runtime, /from ["']\.\/db\.js["']/);
assert.doesNotMatch(source.runtime, /from ["']\.\/scripts\/capability-resolution-dry-run\.mjs["']/);
assert.doesNotMatch(source.bootstrap, /from ["']\.\/db\.js["']/);

assert.match(source.controller, /await import\(["']\.\/db\.js["']\)/);
assert.match(source.facade, /await import\(["']\.\/governanceDb\.js["']\)/);
assert.match(source.runtime, /await import\(["']\.\/db\.js["']\)/);
assert.match(source.runtime, /await import\(["']\.\/scripts\/capability-resolution-dry-run\.mjs["']\)/);
assert.match(source.bootstrap, /await import\(["']\.\/db\.js["']\)/);

console.log(JSON.stringify({
  ok: true,
  contract: "github-repository-policy-readback-import-isolation.v1",
  readback_imports_db_lazily: true,
  lifecycle_governance_imports_lazily: true,
  capability_dry_run_imports_lazily: true,
  secrets_included: false,
}));
