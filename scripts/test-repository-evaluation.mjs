import assert from "node:assert/strict";
import { applyBaselineLifecycle, buildEvaluation, compareBaseline, dependencyPreflight, extractSecretMatches, isPlaceholderToken, stripBaselineLifecycle } from "./repository-evaluation.mjs";

const taskLike = extractSecretMatches("task-route-authority-resolver.mjs");
assert.equal(taskLike.length, 0, "task- paths must not be treated as sk- tokens");

const placeholder = extractSecretMatches("Authorization: Bearer github_pat_abcdefghijklmnopqrstuvwxyz123456");
assert.equal(placeholder.length, 1);
assert.equal(placeholder[0].placeholder, true);
assert.equal(isPlaceholderToken("ghp_should_never_be_accepted"), true);

const realistic = extractSecretMatches(["token=ghp_", "ZYXWVUTSRQPONMLKJIHGFEDCBA987654321"].join(""));
assert.equal(realistic.length, 1);
assert.equal(realistic[0].placeholder, false);

const first = buildEvaluation({ skipChecks: true });
const second = buildEvaluation({ skipChecks: true });
assert.equal(first.deterministic, true);
assert.equal(first.inputFingerprint, second.inputFingerprint, "evaluation fingerprint must be deterministic");
assert.equal(first.gaps.some((gap) => gap.gapId === "SEC-TRACKED-SECRET-SUSPECT"), false, "repository fixtures must not create a secret blocker");
assert.ok(["pass", "warn", "fail"].includes(first.gate.decision));
assert.ok(first.gaps.every((gap) => gap.lifecycle === "new"), "without a baseline, gaps must be marked new");
assert.ok(["contracted", "not-evaluated"].includes(first.signals.dotnet.status), "default evaluation must not depend on local .NET availability");
assert.equal(first.signals.workflow.unpinnedActions, 0, "all workflow action references must be pinned to full commit SHAs");
assert.ok(["within-budget", "near-limit", "exceeded"].includes(first.signals.maintainability.workflowBudgetStatus));
const missingDependencies = dependencyPreflight("/tmp/repository-evaluation-missing-dependencies");
assert.equal(missingDependencies.ready, false);
assert.deepEqual(missingDependencies.missing.sort(), ["root-tests", "typecheck"]);
const environmentProbe = buildEvaluation({ skipChecks: true, includeEnvironment: true });
assert.equal(environmentProbe.deterministic, false, "environment probes must be marked non-deterministic");
assert.ok(["passed", "failed", "not-available"].includes(environmentProbe.signals.dotnet.status));

const baseline = { gaps: [{ gapId: "OLD-001", status: "open" }, { gapId: "PERSIST-001", status: "open" }] };
const baselineAware = applyBaselineLifecycle(
  { gaps: [{ gapId: "PERSIST-001", status: "open" }, { gapId: "NEW-001", status: "open" }] },
  baseline,
);
assert.equal(baselineAware.baselineDiff.available, true);
assert.equal(baselineAware.gaps.find((gap) => gap.gapId === "PERSIST-001").lifecycle, "unchanged");
const committed = stripBaselineLifecycle(baselineAware);
assert.equal(committed.baselineDiff.available, false, "committed artifacts must not depend on PR-only baseline availability");
assert.ok(committed.gaps.every((gap) => gap.lifecycle === "new"), "committed artifact lifecycle must be baseline-independent");

const current = { gaps: [{ gapId: "PERSIST-001", status: "open" }, { gapId: "NEW-001", status: "open" }] };
assert.deepEqual(compareBaseline(current, baseline), {
  available: true,
  newGapIds: ["NEW-001"],
  persistingGapIds: [],
  unchangedGapIds: ["PERSIST-001"],
  resolvedGapIds: ["OLD-001"],
});

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.repository-evaluation-loop-regression.v1",
  deterministic: first.inputFingerprint,
  gap_count: first.gaps.length,
  gate: first.gate,
  secrets_fixture: "passed",
  baseline_fixture: "passed",
  action_pinning: first.signals.workflow.unpinnedActions === 0 ? "passed" : "failed",
  dependency_preflight: missingDependencies.ready ? "unexpected-ready" : "passed",
}, null, 2));
