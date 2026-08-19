import assert from "node:assert/strict";
import test from "node:test";
import {
  globRegex,
  evaluateSemanticCoverage,
  evaluateTestAuthority,
  powershellParserInvocation,
  validateRegistryContracts,
} from "../../scripts/repository-governance-fixed-point.mjs";

test("glob matcher keeps * segment-local and ** recursive", () => {
  assert.equal(globRegex("http-generic-api/test-*.mjs").test("http-generic-api/test-a.mjs"), true);
  assert.equal(globRegex("http-generic-api/test-*.mjs").test("http-generic-api/nested/test-a.mjs"), false);
  assert.equal(globRegex("**/*.test.ts").test("tests/a/b.test.ts"), true);
});

test("semantic facets require registered verifier bindings", () => {
  const report = { semantic_graph: { changed_nodes: [{ path: "x.js", facets: ["route", "unknown"] }] } };
  const bindings = { bindings: [{ facet: "route", required_verifiers: ["frontend_openapi_currentness"] }] };
  const verifierRegistry = { verifiers: [{ id: "frontend_openapi_currentness" }] };
  const result = evaluateSemanticCoverage(report, bindings, verifierRegistry);
  assert.deepEqual(result.uncovered, [{ path: "x.js", facet: "unknown" }]);
  assert.equal(result.missing_verifiers.length, 0);
});

test("semantic verifier references fail closed when unregistered", () => {
  const report = { semantic_graph: { changed_nodes: [{ path: "x.js", facets: ["route"] }] } };
  const bindings = { bindings: [{ facet: "route", required_verifiers: ["missing"] }] };
  const result = evaluateSemanticCoverage(report, bindings, { verifiers: [] });
  assert.equal(result.uncovered.length, 0);
  assert.equal(result.missing_verifiers.length, 1);
});

test("test authority detects unknown tests and removed last invariant test", () => {
  const registry = {
    discovery: { test_path_patterns: ["**/*.test.mjs"] },
    registered_test_patterns: [".github/tests/*.test.mjs"],
    governed_exclusions: [],
    invariants: [{ invariant_id: "important", protected_by_tests: [".github/tests/required.test.mjs"], protected_by_verifiers: ["fixed_point:test_authority"] }],
  };
  const result = evaluateTestAuthority(["other/example.test.mjs"], registry, { verifiers: [] });
  assert.deepEqual(result.unregistered, ["other/example.test.mjs"]);
  assert.equal(result.missing_invariant_tests.length, 1);
  assert.equal(result.missing_invariant_verifiers.length, 0);
});

test("PowerShell parser transports the target path through a bounded environment variable", () => {
  const target = "/workspace/repository/autopilot-portable-staging/Start-AutoPilot.ps1";
  const invocation = powershellParserInvocation(target);
  assert.equal(invocation.command, "pwsh");
  assert.equal(invocation.args.at(-1).startsWith("$p=$env:MAD4B_VALIDATE_PATH;"), true);
  assert.equal(invocation.args.includes(target), false);
  assert.equal(invocation.options.env.MAD4B_VALIDATE_PATH, target);
});

test("registry contracts reject malformed authorities", () => {
  const errors = validateRegistryContracts({
    semanticBindings: { contract: "bad", bindings: [] },
    executableRegistry: { contract: "bad", validators: [] },
    testAuthority: { contract: "bad", invariants: [] },
    verifierRegistry: { contract: "bad", verifiers: [] },
  });
  assert.ok(errors.length >= 4);
});
