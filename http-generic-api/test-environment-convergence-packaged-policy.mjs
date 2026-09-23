import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyEnvironmentCertification,
  loadActivationGatewayProfilePolicy,
  readEnvironmentConvergenceRegistry,
} from "./environmentConvergenceRegistry.js";
import { runEnvironmentConvergence } from "./environmentConvergenceEngine.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

  {
    const desiredCommit = "a".repeat(40);
    const observedCommit = "b".repeat(40);
    const profile = registry.profiles.staging.activation_gateway;
    const liveDegradedReport = {
      outcome: "degraded",
      expected: { commit_sha: desiredCommit },
      gateway: {
        health: {
          sourceCommit: observedCommit,
          policyKey: profile.policy_key,
          policyHash: profile.expected_policy_hash,
        },
        profile_validation: {
          observed_public_host: profile.public_host,
        },
      },
      integrity_checks: [],
      readiness_checks: [
        {
          key: "gateway_recovery_trusted_ingress",
          ok: false,
          severity: "readiness",
          detail: { ready: false },
        },
        {
          key: "gateway_exact_commit",
          ok: false,
          severity: "readiness",
          detail: { expected: desiredCommit, observed: observedCommit },
        },
        {
          key: "gateway_upstream_ready",
          ok: false,
          severity: "readiness",
          detail: { status: 503, upstream_ready: false },
        },
      ],
    };

    const classification = classifyEnvironmentCertification(liveDegradedReport, {
      environment: "staging",
      registry,
    });
    assert.equal(classification.status, "reconciliation_required");
    assert.deepEqual(
      classification.classified_failures.map((entry) => entry.check_key),
      ["gateway_recovery_trusted_ingress", "gateway_exact_commit", "gateway_upstream_ready"],
    );
    assert.equal(classification.next_governed_handoff.execution_ready, true);

    const convergence = runEnvironmentConvergence({
      environment: "staging",
      releaseSpec: {
        repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
        source_branch: "main",
        commit_sha: desiredCommit,
      },
      certificationReport: liveDegradedReport,
      registry,
    });
    assert.equal(convergence.status, "approval_required");
    assert.match(convergence.plan.plan_sha256, /^[0-9a-f]{64}$/u);
    assert.deepEqual(
      convergence.plan.drift.map((entry) => entry.check_key),
      ["gateway_recovery_trusted_ingress", "gateway_exact_commit"],
      "manual upstream readiness is verified after governed apply and is not part of the provider mutation plan",
    );

    const dependencyUnavailableReport = structuredClone(liveDegradedReport);
    dependencyUnavailableReport.readiness_checks.push({
      key: "gateway_health_reachable",
      ok: false,
      severity: "readiness",
      detail: { status: 0, error: "fetch_failed" },
    });
    const unavailableClassification = classifyEnvironmentCertification(dependencyUnavailableReport, {
      environment: "staging",
      registry,
    });
    assert.equal(unavailableClassification.status, "blocked");
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("environment convergence packaged policy regression tests passed");
