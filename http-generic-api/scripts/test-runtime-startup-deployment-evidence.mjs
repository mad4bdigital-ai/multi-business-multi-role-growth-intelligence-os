#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RUNTIME_STARTUP_EVIDENCE_CONTRACT,
  boundedDiagnosticTail,
  runRuntimeStartupDeploymentEvidence
} from "./runtime-startup-deployment-evidence.mjs";
import {
  RUNTIME_STARTUP_TEST_ENV_CONTRACT,
  RUNTIME_STARTUP_TEST_ENVIRONMENT_VARIABLES,
  assertRuntimeStartupTestEnvironment,
  buildRuntimeStartupTestEnvironment,
  describeRuntimeStartupTestEnvironment,
} from "./runtime-startup-test-environment.mjs";

const SHA = "a".repeat(40);
const SOURCE_SHA = "b".repeat(40);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-startup-evidence-"));

try {
  const inherited = {
    JWT_SECRET: "inherited-value-must-not-be-used",
    TENANT_GPT_SSO_SIGNING_SECRET: "another-inherited-value-must-not-be-used",
    BACKEND_API_KEY: "inherited-backend-key-must-not-be-used",
    REDIS_URL: "redis://production-like.example.invalid:6379",
    DB_PASSWORD: "database-password-must-not-cross-boundary",
    GOVERNANCE_DB_PASSWORD: "governance-password-must-not-cross-boundary",
    RUNTIME_PERSISTENCE_DB_PASSWORD: "persistence-password-must-not-cross-boundary",
    GITHUB_TOKEN: "github-token-must-not-cross-boundary",
    HOSTINGER_API_TOKEN: "provider-token-must-not-cross-boundary",
    CLOUDFLARE_API_TOKEN: "cloudflare-token-must-not-cross-boundary",
    DEPLOYMENT_MANIFEST_AUTHORITATIVE_BRANCH: "untrusted-inherited-production-lock",
    NODE_OPTIONS: "--require ./must-not-be-inherited.cjs",
    PATH: "/usr/bin:/bin",
    GITHUB_WORKFLOW: "CI",
  };
  const hermeticEnv = buildRuntimeStartupTestEnvironment(inherited);
  assertRuntimeStartupTestEnvironment(hermeticEnv);
  assert.notEqual(hermeticEnv.JWT_SECRET, inherited.JWT_SECRET);
  assert.notEqual(hermeticEnv.TENANT_GPT_SSO_SIGNING_SECRET, inherited.TENANT_GPT_SSO_SIGNING_SECRET);
  assert.notEqual(hermeticEnv.BACKEND_API_KEY, inherited.BACKEND_API_KEY);
  assert.notEqual(hermeticEnv.REDIS_URL, inherited.REDIS_URL);
  for (const blockedName of [
    "DB_PASSWORD",
    "GOVERNANCE_DB_PASSWORD",
    "RUNTIME_PERSISTENCE_DB_PASSWORD",
    "GITHUB_TOKEN",
    "HOSTINGER_API_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "DEPLOYMENT_MANIFEST_AUTHORITATIVE_BRANCH",
    "NODE_OPTIONS",
  ]) {
    assert.equal(Object.hasOwn(hermeticEnv, blockedName), false, `${blockedName} must not cross the startup-test environment boundary`);
  }
  assert.equal(hermeticEnv.PATH, inherited.PATH, "required process execution context remains allowlisted");
  assert.equal(hermeticEnv.GITHUB_WORKFLOW, inherited.GITHUB_WORKFLOW, "non-secret evidence identity remains allowlisted");
  assert.equal(hermeticEnv.RUNTIME_STARTUP_TEST_ENV_CONTRACT, RUNTIME_STARTUP_TEST_ENV_CONTRACT);
  const descriptor = describeRuntimeStartupTestEnvironment();
  assert.deepEqual(descriptor.variable_names, [...RUNTIME_STARTUP_TEST_ENVIRONMENT_VARIABLES]);
  assert.equal(descriptor.inherited_variable_policy, "explicit_allowlist");
  assert.equal(descriptor.inherited_values_overridden, true);
  assert.equal(descriptor.unrelated_environment_inherited, false);
  assert.equal(descriptor.credential_payload_read, false);
  assert.equal(descriptor.production_secret_source_used, false);
  assert.equal(descriptor.production_mutation_executed, false);
  assert.equal(descriptor.secrets_included, false);

  const stages = [
    { id: "one", label: "First stage", command: process.execPath, args: ["one.mjs"] },
    { id: "two", label: "Second stage", command: process.execPath, args: ["two.mjs"] },
    { id: "three", label: "Third stage", command: process.execPath, args: ["three.mjs"] }
  ];
  const calls = [];
  const observedEnvironments = [];
  const timestamps = [100, 110, 200, 225];
  const failed = runRuntimeStartupDeploymentEvidence({
    outputDir: path.join(root, "failed"),
    stages,
    env: {
      CI_CANDIDATE_KIND: "merge_candidate",
      CI_CANDIDATE_SHA: SHA,
      CI_SOURCE_HEAD_SHA: SOURCE_SHA,
      GITHUB_WORKFLOW: "CI",
      GITHUB_RUN_ID: "123",
      GITHUB_HEAD_REF: "feature/runtime-evidence",
      GITHUB_BASE_REF: "main",
      ...inherited,
    },
    now: () => timestamps.shift(),
    spawnSync(command, args, options) {
      calls.push([command, ...args]);
      observedEnvironments.push(options.env);
      if (calls.length === 1) return { status: 0, signal: null, stdout: "ok", stderr: "" };
      return {
        status: 1,
        signal: null,
        stdout: "authorization: Bearer visible-token\naccess_token=top-secret",
        stderr: "AssertionError: deployment identity mismatch\nclient_secret=swordfish"
      };
    }
  });

  assert.equal(calls.length, 2, "execution must stop after the first failed stage");
  assert.equal(observedEnvironments.length, 2);
  for (const stageEnv of observedEnvironments) {
    assertRuntimeStartupTestEnvironment(stageEnv);
    assert.notEqual(stageEnv.JWT_SECRET, inherited.JWT_SECRET);
    assert.notEqual(stageEnv.TENANT_GPT_SSO_SIGNING_SECRET, inherited.TENANT_GPT_SSO_SIGNING_SECRET);
    assert.equal(Object.hasOwn(stageEnv, "DB_PASSWORD"), false);
    assert.equal(Object.hasOwn(stageEnv, "GITHUB_TOKEN"), false);
    assert.equal(Object.hasOwn(stageEnv, "HOSTINGER_API_TOKEN"), false);
    assert.equal(Object.hasOwn(stageEnv, "DEPLOYMENT_MANIFEST_AUTHORITATIVE_BRANCH"), false);
  }
  assert.equal(failed.report.contract, RUNTIME_STARTUP_EVIDENCE_CONTRACT);
  assert.equal(failed.report.outcome, "failed");
  assert.equal(failed.report.identity.candidate_kind, "merge_candidate");
  assert.equal(failed.report.identity.candidate_sha, SHA);
  assert.equal(failed.report.identity.source_head_sha, SOURCE_SHA);
  assert.equal(failed.report.startup_environment.contract, RUNTIME_STARTUP_TEST_ENV_CONTRACT);
  assert.equal(failed.report.startup_environment.inherited_variable_policy, "explicit_allowlist");
  assert.equal(failed.report.startup_environment.inherited_values_overridden, true);
  assert.equal(failed.report.startup_environment.unrelated_environment_inherited, false);
  assert.equal(failed.report.startup_environment.credential_payload_read, false);
  assert.equal(failed.report.stages[0].status, "passed");
  assert.equal(failed.report.stages[0].duration_ms, 10);
  assert.equal(failed.report.stages[1].status, "failed");
  assert.equal(failed.report.stages[1].duration_ms, 25);
  assert.equal(failed.report.first_failure.stage_id, "two");
  assert.equal(failed.report.first_failure.failure_class, "runtime_evidence_stage_failure");
  assert.equal(failed.report.routing.consult_job_logs, false);
  assert.equal(failed.report.secrets_included, false);
  assert.doesNotMatch(JSON.stringify(failed.report), /visible-token|top-secret|swordfish|inherited-value-must-not-be-used|another-inherited-value-must-not-be-used|database-password-must-not-cross-boundary|provider-token-must-not-cross-boundary/u);
  assert.match(failed.report.first_failure.diagnostic.stderr.tail, /deployment identity mismatch/u);
  assert.ok(fs.existsSync(failed.jsonPath));
  assert.ok(fs.existsSync(failed.markdownPath));

  const persisted = JSON.parse(fs.readFileSync(failed.jsonPath, "utf8"));
  assert.equal(persisted.outcome, "failed");
  assert.equal(persisted.first_failure.stage_id, "two");
  assert.doesNotMatch(fs.readFileSync(failed.markdownPath, "utf8"), /visible-token|top-secret|swordfish|database-password-must-not-cross-boundary|provider-token-must-not-cross-boundary/u);

  const passed = runRuntimeStartupDeploymentEvidence({
    outputDir: path.join(root, "passed"),
    stages: stages.slice(0, 2),
    env: {
      CI_CANDIDATE_KIND: "head",
      CI_CANDIDATE_SHA: SHA,
      CI_SOURCE_HEAD_SHA: SHA,
      GITHUB_WORKFLOW: "CI"
    },
    now: (() => {
      let value = 0;
      return () => {
        value += 5;
        return value;
      };
    })(),
    spawnSync(_command, _args, options) {
      assertRuntimeStartupTestEnvironment(options.env);
      return { status: 0, signal: null, stdout: "ok", stderr: "" };
    }
  });
  assert.equal(passed.report.outcome, "passed");
  assert.equal(passed.report.first_failure, null);
  assert.equal(passed.report.stages.length, 2);
  assert.equal(passed.report.startup_environment.contract, RUNTIME_STARTUP_TEST_ENV_CONTRACT);
  assert.equal(passed.report.routing.consult_job_logs, false);

  const contractFailure = runRuntimeStartupDeploymentEvidence({
    outputDir: path.join(root, "contract-failure"),
    stages,
    env: {
      CI_CANDIDATE_KIND: "head",
      CI_CANDIDATE_SHA: SHA,
      CI_SOURCE_HEAD_SHA: SHA,
      GITHUB_WORKFLOW: "Certified Production Release Cut Validation"
    },
    buildStartupTestEnvironment() {
      throw new Error("runtime_startup_test_environment_contract_invalid:JWT_SECRET");
    }
  });
  assert.equal(contractFailure.report.outcome, "failed");
  assert.equal(contractFailure.report.stages.length, 0);
  assert.equal(contractFailure.report.first_failure.stage_id, "startup_test_environment_contract");
  assert.equal(contractFailure.report.first_failure.failure_class, "certification_contract_error");
  assert.match(contractFailure.report.first_failure.diagnostic.stderr.tail, /runtime_startup_test_environment_contract_invalid:JWT_SECRET/u);
  assert.equal(contractFailure.report.startup_environment.credential_payload_read, false);
  assert.equal(contractFailure.report.secrets_included, false);

  assert.equal(boundedDiagnosticTail("line-1\nline-2\nline-3", { maxLines: 2, maxChars: 100 }), "line-2\nline-3");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  tests: 4,
  gate: "runtime_startup_deployment_structured_evidence",
  contract: RUNTIME_STARTUP_EVIDENCE_CONTRACT,
  startup_environment_contract: RUNTIME_STARTUP_TEST_ENV_CONTRACT,
  inherited_variable_policy: "explicit_allowlist",
  unrelated_environment_inherited: false,
  credential_payload_read: false,
  secrets_included: false
}));
