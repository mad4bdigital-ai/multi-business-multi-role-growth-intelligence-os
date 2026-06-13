export const SENSITIVE_SURFACE_TESTS = Object.freeze({
  "http-generic-api/agentLoopRunner.js": ["node test-governed-agent-execution-context.mjs"],
  "http-generic-api/modelAdapter.js": [
    "node test-agent-runtime-provider-selection.mjs",
    "node test-agent-runtime-ledger-wiring.mjs",
  ],
  "http-generic-api/routes/index.js": ["node test-connect-routes.mjs"],
  "http-generic-api/openapi.yaml": [
    "node test-openapi-route-coverage.mjs",
    "node test-openapi-split-governance.mjs",
  ],
  "http-generic-api/scripts/test-manifest.mjs": ["node test-test-manifest-runner.mjs"],
  ".github/workflows/ci.yml": ["node test-interruption-readiness.mjs"],
});

export const VERIFICATION_PLAN_RULES = Object.freeze([
  { prefix: "docs/", tests: ["node test-docs-impact-classifier.mjs", "node test-platform-recomposition-docs.mjs"] },
  { prefix: "http-generic-api/migrations/", tests: ["node test-release-readiness-migration-drift.mjs"] },
  { prefix: "http-generic-api/routes/", tests: ["node test-connect-routes.mjs"] },
  { prefix: "http-generic-api/scripts/", tests: ["node test-test-manifest-runner.mjs"] },
  { exact: "memory_schema.json", tests: ["node ../validate-memory-schema.mjs"] },
  { exact: "system_bootstrap.md", tests: ["node ../validate-canonical-sources.mjs", "node ../build-canonicals.mjs --check"] },
]);

export function parseNodeEngineMajorRange(engine = "") {
  const minimum = engine.match(/>=\s*(\d+)/)?.[1];
  const maximum = engine.match(/<\s*(\d+)/)?.[1];
  return {
    minimumMajor: minimum ? Number(minimum) : null,
    maximumMajorExclusive: maximum ? Number(maximum) : null,
  };
}

export function nodeVersionSatisfiesEngine(version, engine) {
  const major = Number(String(version).replace(/^v/, "").split(".")[0]);
  const range = parseNodeEngineMajorRange(engine);
  if (!Number.isInteger(major)) return false;
  if (range.minimumMajor !== null && major < range.minimumMajor) return false;
  if (range.maximumMajorExclusive !== null && major >= range.maximumMajorExclusive) return false;
  return true;
}

export function classifySensitiveChanges(branchFiles = [], targetFiles = []) {
  const branchSet = new Set(branchFiles);
  const targetSet = new Set(targetFiles);
  const sensitiveFiles = Object.keys(SENSITIVE_SURFACE_TESTS);
  const touched = sensitiveFiles.filter((file) => branchSet.has(file));
  const overlapping = touched.filter((file) => targetSet.has(file));
  const tests = [...new Set(touched.flatMap((file) => SENSITIVE_SURFACE_TESTS[file]))];
  return { touched, overlapping, tests };
}

export function buildVerificationPlan(changedFiles = []) {
  const tests = ["node test-interruption-readiness.mjs"];
  const matchedRules = [];
  for (const rule of VERIFICATION_PLAN_RULES) {
    const matchedFiles = changedFiles.filter((file) => rule.exact ? file === rule.exact : file.startsWith(rule.prefix));
    if (!matchedFiles.length) continue;
    matchedRules.push({ ...rule, matchedFiles });
    tests.push(...rule.tests);
  }
  const sensitive = classifySensitiveChanges(changedFiles, []);
  tests.push(...sensitive.tests);
  return {
    changed_files: [...new Set(changedFiles)].sort(),
    matched_rules: matchedRules,
    commands: [...new Set(tests)],
  };
}

export function compareContinuitySnapshots(baseline = {}, current = {}, { maxAgeMinutes = 360, now = Date.now() } = {}) {
  const reasons = [];
  if (!baseline.target_sha) reasons.push("baseline_target_missing");
  if (!current.target_sha) reasons.push("current_target_missing");
  for (const key of ["head_sha", "target_sha", "merge_base", "package_lock_sha256", "direct_dependencies_sha256", "worktree_sha256"]) {
    if ((baseline[key] || null) !== (current[key] || null)) reasons.push(`${key}_changed`);
  }
  const generatedAt = Date.parse(baseline.generated_at || "");
  if (!Number.isFinite(generatedAt)) reasons.push("baseline_timestamp_invalid");
  else if (now - generatedAt > maxAgeMinutes * 60_000) reasons.push("baseline_expired");
  return { fresh: reasons.length === 0, reasons };
}

export function compareDirectDependencyVersions(expected = {}, installed = {}) {
  const missing = [];
  const mismatched = [];
  const unlocked = [];
  for (const [name, expectedVersion] of Object.entries(expected)) {
    const installedVersion = installed[name] || null;
    if (!expectedVersion) unlocked.push(name);
    if (!installedVersion) missing.push(name);
    else if (expectedVersion && installedVersion !== expectedVersion) {
      mismatched.push({ name, expected: expectedVersion, installed: installedVersion });
    }
  }
  return { ready: missing.length === 0 && mismatched.length === 0 && unlocked.length === 0, missing, mismatched, unlocked };
}

export function planCommandsSha256(commands = []) {
  return createStableSha256(commands);
}

export function evidenceIdentitySha256(evidence = {}) {
  return createStableSha256({
    schema_version: evidence.schema_version || null,
    mode: evidence.mode || null,
    coverage: evidence.coverage || null,
    status: evidence.status || null,
    summary: evidence.summary || null,
    checks: evidence.checks || null,
    continuity_snapshot: evidence.continuity_snapshot || null,
    verification_plan: evidence.verification_plan || null,
  });
}

export function validateReadinessEvidence(evidence = {}) {
  const errors = [];
  if (evidence.schema_version !== "interruption_readiness.v1") errors.push("readiness_evidence_schema_invalid");
  if (evidence.status === "blocked") errors.push("readiness_evidence_blocked");
  if (!Array.isArray(evidence.checks)) errors.push("readiness_evidence_checks_missing");
  if (!evidence.summary || typeof evidence.summary !== "object") errors.push("readiness_evidence_summary_missing");
  if (!evidence.coverage || typeof evidence.coverage !== "object") errors.push("readiness_evidence_coverage_missing");
  if (Array.isArray(evidence.checks) && evidence.checks.some((check) => !["blocker", "warning", "info"].includes(check?.level))) {
    errors.push("readiness_evidence_check_level_invalid");
  }
  if (evidence.summary && ["blocker", "warning", "info"].some((level) => !Number.isInteger(evidence.summary[level]) || evidence.summary[level] < 0)) {
    errors.push("readiness_evidence_summary_invalid");
  }
  if (evidence.coverage && ["engine", "dependencies", "merge", "worktree"].some((key) => typeof evidence.coverage[key] !== "boolean")) {
    errors.push("readiness_evidence_coverage_invalid");
  }
  if (Array.isArray(evidence.checks) && evidence.summary && typeof evidence.summary === "object") {
    const calculated = summarizeReadiness(evidence.checks);
    for (const level of ["blocker", "warning", "info"]) {
      if (Number(evidence.summary[level] || 0) !== calculated[level]) errors.push(`readiness_evidence_summary_mismatch:${level}`);
    }
    const calculatedStatus = calculated.blocker ? "blocked" : calculated.warning ? "warning" : "ready";
    if (evidence.status !== calculatedStatus) errors.push("readiness_evidence_status_mismatch");
  }
  if (!evidence.continuity_snapshot?.head_sha) errors.push("readiness_evidence_head_missing");
  if (!evidence.continuity_snapshot?.target_sha) errors.push("readiness_evidence_target_missing");
  if (!Array.isArray(evidence.verification_plan?.commands)) errors.push("readiness_evidence_plan_missing");
  return { valid: errors.length === 0, errors };
}

export function resumablePassedCommands(previous = {}, { evidenceFile, evidenceSha256, planSha256, commands = [] } = {}) {
  if (!previous
    || previous.evidence_file !== evidenceFile
    || previous.evidence_sha256 !== evidenceSha256
    || previous.plan_sha256 !== planSha256) return [];
  const previousSteps = Array.isArray(previous.steps) ? previous.steps : [];
  const resumable = [];
  for (let index = 0; index < commands.length; index += 1) {
    const step = previousSteps[index];
    if (!step || step.command !== commands[index] || step.status !== "passed") break;
    resumable.push(step.command);
  }
  return resumable;
}

export function classifyExecutionLease(lease = {}, { now = Date.now(), leaseTimeoutMinutes = 120, maxClockSkewMinutes = 5 } = {}) {
  const updatedAt = Date.parse(lease.updated_at || lease.acquired_at || "");
  if (!Number.isFinite(updatedAt)) return { state: "invalid", recoverable: false };
  const ageMs = now - updatedAt;
  if (ageMs < -maxClockSkewMinutes * 60_000) return { state: "clock_skew", recoverable: false, age_ms: ageMs };
  const stale = ageMs > leaseTimeoutMinutes * 60_000;
  return { state: stale ? "stale" : "active", recoverable: stale, age_ms: ageMs };
}

export function validateCheckpoint(previous = {}, { evidenceFile, evidenceSha256, planSha256, commands = [] } = {}) {
  const errors = [];
  if (!previous || typeof previous !== "object") errors.push("checkpoint_invalid");
  if (previous?.evidence_file !== evidenceFile) errors.push("checkpoint_evidence_mismatch");
  if (previous?.evidence_sha256 !== evidenceSha256) errors.push("checkpoint_evidence_identity_mismatch");
  if (previous?.plan_sha256 !== planSha256) errors.push("checkpoint_plan_mismatch");
  const steps = Array.isArray(previous?.steps) ? previous.steps : [];
  if (steps.length !== commands.length) errors.push("checkpoint_step_count_mismatch");
  commands.forEach((command, index) => {
    if (steps[index]?.command !== command) errors.push(`checkpoint_step_command_mismatch:${index}`);
    if (!["pending", "running", "passed", "failed", "planned"].includes(steps[index]?.status)) errors.push(`checkpoint_step_status_invalid:${index}`);
  });
  let nonPassedSeen = false;
  steps.forEach((step, index) => {
    if (step.status !== "passed") nonPassedSeen = true;
    else if (nonPassedSeen) errors.push(`checkpoint_non_contiguous_passed_step:${index}`);
  });
  if (!verifyVerificationEventChain(previous?.events || [], previous?.event_chain_head_sha256 || null).valid) {
    errors.push("checkpoint_event_chain_invalid");
  }
  return { valid: errors.length === 0, errors };
}

export function leaseOwnedBy(lease = {}, ownerToken = "") {
  return Boolean(ownerToken) && lease.owner_token === ownerToken;
}

export function canRecoverExecutionLease({ requested = false, classification = {}, ownerPidValid = false, ownerAlive = true } = {}) {
  if (!requested || !ownerPidValid || ownerAlive) return false;
  return classification.state === "active" || classification.recoverable === true;
}

export function hashVerificationEvent(event = {}) {
  const { event_sha256: _ignored, ...hashable } = event;
  return createHash("sha256").update(JSON.stringify(hashable)).digest("hex");
}

export function verifyVerificationEventChain(events = [], expectedHead = null) {
  let previous = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (index > 0 && event.previous_event_sha256 !== previous) return { valid: false, reason: `event_link_mismatch:${index}` };
    const calculated = hashVerificationEvent(event);
    if (calculated !== event.event_sha256) return { valid: false, reason: `event_hash_mismatch:${index}` };
    previous = event.event_sha256;
  }
  if ((previous || null) !== (expectedHead || null)) return { valid: false, reason: "event_head_mismatch" };
  return { valid: true, reason: null };
}

export function classifyLineEndingDrift({ changed = false, equalIgnoringEol = false } = {}) {
  if (!changed) return "clean";
  return equalIgnoringEol ? "eol_or_trailing_whitespace_only" : "content_change";
}

export function parseGitPorcelainZ(value = "") {
  return value
    .split("\0")
    .filter(Boolean)
    .map((entry) => ({ status: entry.slice(0, 2), file: entry.slice(3) }));
}

export function summarizeReadiness(checks = []) {
  return checks.reduce(
    (summary, check) => {
      summary[check.level] = (summary[check.level] || 0) + 1;
      return summary;
    },
    { blocker: 0, warning: 0, info: 0 },
  );
}

export function shouldFailReadiness(checks = []) {
  return checks.some((check) => check.level === "blocker");
}

function createStableSha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
import { createHash } from "node:crypto";
