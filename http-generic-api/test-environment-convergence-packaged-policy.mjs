import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadActivationGatewayProfilePolicy,
  readEnvironmentConvergenceRegistry,
} from "./environmentConvergenceRegistry.js";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const registry = readEnvironmentConvergenceRegistry();
const canonicalPolicy = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, registry.profiles.staging.activation_gateway.policy_path),
  "utf8",
));
const filesystemRoot = path.parse(process.cwd()).root;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-packaged-policy-"));

function cloneRegistry() {
  return structuredClone(registry);
}

function writePolicy(name, policy) {
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
  return file;
}

try {
  {
    const fixture = cloneRegistry();
    fixture.profiles.staging.activation_gateway.policy_path = "__mad4b_missing_repo__/route-policy.staging.json";
    fixture.profiles.staging.activation_gateway.packaged_policy_path = writePolicy("valid-policy.json", canonicalPolicy);

    const loaded = loadActivationGatewayProfilePolicy("staging", {
      registry: fixture,
      repositoryRoot: filesystemRoot,
    });

    assert.equal(loaded.policy_source, "packaged_profile");
    assert.equal(loaded.policy.policy_key, "activation_gateway_staging");
    assert.equal(loaded.policy.public_host, "activation-dev.mad4b.com");
    assert.equal(
      loaded.policy.content_hash_sha256,
      fixture.profiles.staging.activation_gateway.expected_policy_hash,
    );
  }

  {
    const fixture = cloneRegistry();
    fixture.profiles.staging.activation_gateway.policy_path = "../outside.json";
    fixture.profiles.staging.activation_gateway.packaged_policy_path = writePolicy("traversal-fallback.json", canonicalPolicy);

    assert.throws(
      () => loadActivationGatewayProfilePolicy("staging", {
        registry: fixture,
        repositoryRoot: filesystemRoot,
      }),
      /activation_gateway_policy_path_outside_repository:staging/u,
    );
  }

  {
    const fixture = cloneRegistry();
    fixture.profiles.staging.activation_gateway.policy_path = "__mad4b_missing_repo__/route-policy.staging.json";
    fixture.profiles.staging.activation_gateway.packaged_policy_path = writePolicy("wrong-hash-policy.json", {
      ...canonicalPolicy,
      content_hash_sha256: "0".repeat(64),
    });

    assert.throws(
      () => loadActivationGatewayProfilePolicy("staging", {
        registry: fixture,
        repositoryRoot: filesystemRoot,
      }),
      /activation_gateway_profile_policy_invalid:staging:policy_hash/u,
    );
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("environment convergence packaged policy regression tests passed");
