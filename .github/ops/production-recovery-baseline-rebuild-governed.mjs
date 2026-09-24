import fs from "node:fs";
import path from "node:path";

const BASE = String(process.env.RUNTIME_BASE_URL || "https://auth.mad4b.com").replace(/\/+$/u, "");
const KEY = String(process.env.BACKEND_API_KEY || "");
const GH = String(process.env.GH_TOKEN || "");
const REPO = String(process.env.REPOSITORY || "");
const ISSUE = Number(process.env.CONTROL_ISSUE || 6813);
const PHASE = String(process.env.RECOVERY_BRIDGE_PHASE || "");
const COMMENT = String(process.env.COMMENT_BODY || "").trim();
const EVIDENCE_DIR = String(process.env.EVIDENCE_DIR || ".artifacts/production-recovery-baseline-rebuild");
const WORKFLOW_RUN_ID = String(process.env.GITHUB_RUN_ID || "");
const WORKFLOW_RUN_ATTEMPT = String(process.env.GITHUB_RUN_ATTEMPT || "1");

const REBUILD = /^APPLY_HOSTINGER_RUNTIME_BASELINE_REBUILD:([0-9a-f]{40}):production-runtime:governance,runtime_persistence$/u;
const APPROVE = /^APPROVE PRODUCTION RECOVERY (approval:[0-9a-f]{16,64}) (step:[0-9a-f]{16,64}) ([0-9a-f]{40})$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const PLAN = /^plan:[0-9a-f]{16,64}$/u;
const STEP = /^step:[0-9a-f]{16,64}$/u;
const APPROVAL = /^approval:[0-9a-f]{16,64}$/u;
const FINDING = /^finding:[0-9a-f]{16,64}$/u;
const RUN = /^run:[A-Za-z0-9._:-]{8,160}$/u;
const ROLES = Object.freeze(["governance", "runtime_persistence"]);
const MARKER = "mad4b-production-recovery-approval-v1:";

function safe(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), {
    code,
    details: { ...details, secrets_included: false },
  });
}

function writeEvidence(name, value) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, name),
    JSON.stringify({ ...value, secrets_included: false }, null, 2) + "\n",
    "utf8",
  );
}

function requireBase() {
  if (!KEY) fail("RECOVERY_BRIDGE_BACKEND_KEY_MISSING", "BACKEND_API_KEY is unavailable.");
  if (!GH) fail("RECOVERY_BRIDGE_GITHUB_TOKEN_MISSING", "GitHub token is unavailable.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(REPO)) {
    fail("RECOVERY_BRIDGE_REPOSITORY_INVALID", "Repository identity is invalid.");
  }
  if (!["prepare", "execute"].includes(PHASE)) {
    fail("RECOVERY_BRIDGE_PHASE_INVALID", "Bridge phase is invalid.");
  }
}

async function parseResponse(response, label) {
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    fail("RECOVERY_BRIDGE_INVALID_JSON", label + " returned invalid JSON.", { status: response.status });
  }
  if (!response.ok || payload?.ok === false) {
    fail(
      safe(payload?.error?.code || label + "_failed", 128),
      safe(payload?.error?.message || label + " failed.", 320),
      { status: response.status, runtime_details: payload?.error?.details || null },
    );
  }
  return payload;
}

async function runtime(method, route, body, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), method === "POST" ? 120000 : 60000);
  try {
    const response = await fetch(BASE + route, {
      method,
      headers: {
        authorization: "Bearer " + KEY,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    return await parseResponse(response, label);
  } finally {
    clearTimeout(timer);
  }
}

async function github(route, options = {}) {
  const response = await fetch("https://api.github.com" + route, {
    method: options.method || "GET",
    headers: {
      authorization: "Bearer " + GH,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "mad4b-production-recovery-governed-bridge",
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    fail("RECOVERY_BRIDGE_GITHUB_REQUEST_FAILED", "GitHub request failed.", { status: response.status });
  }
  return response.status === 204 ? null : response.json();
}

async function currentProductionSha() {
  const [owner, repo] = REPO.split("/");
  const ref = await github("/repos/" + owner + "/" + repo + "/git/ref/heads/Production");
  const sha = safe(ref?.object?.sha, 64).toLowerCase();
  if (!SHA40.test(sha)) fail("RECOVERY_BRIDGE_PRODUCTION_SHA_INVALID", "Production ref is invalid.");
  return sha;
}

async function postIssueComment(body) {
  const [owner, repo] = REPO.split("/");
  return github("/repos/" + owner + "/" + repo + "/issues/" + ISSUE + "/comments", {
    method: "POST",
    body: { body },
  });
}

function encodeMarker(state) {
  return "<!-- " + MARKER + Buffer.from(JSON.stringify(state), "utf8").toString("base64url") + " -->";
}

function decodeMarker(body) {
  const text = String(body || "");
  const prefix = "<!-- " + MARKER;
  const begin = text.indexOf(prefix);
  if (begin < 0) return null;
  const start = begin + prefix.length;
  const end = text.indexOf(" -->", start);
  if (end < 0) return null;
  const encoded = text.slice(start, end).trim();
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function normalizePlan(plan, expectedSha) {
  if (plan?.contract !== "mad4b.recovery-remediation-plan.v1") {
    fail("RECOVERY_BRIDGE_PLAN_CONTRACT_INVALID", "Canonical Recovery plan was not returned.");
  }
  if (!PLAN.test(safe(plan.plan_id)) || !SHA256.test(safe(plan.plan_hash).toLowerCase())) {
    fail("RECOVERY_BRIDGE_PLAN_IDENTITY_INVALID", "Recovery plan identity is invalid.");
  }
  if (safe(plan.expected_sha).toLowerCase() !== expectedSha || plan.target_key !== "production-runtime") {
    fail("RECOVERY_BRIDGE_PLAN_BINDING_MISMATCH", "Plan is not bound to exact Production.");
  }
  const selected = [...new Set((plan.selected_rebuild_roles || []).map((value) => safe(value, 64)))].sort();
  if (JSON.stringify(selected) !== JSON.stringify([...ROLES].sort())) {
    fail("RECOVERY_BRIDGE_ROLE_SET_MISMATCH", "Server-derived rebuild roles differ from the authorized role set.", { selected });
  }
  const rebuildSteps = (plan.steps || []).filter(
    (step) => step?.consequential === true && String(step?.capability_key || "").endsWith(".baseline.rebuild_empty"),
  );
  const byRole = new Map(rebuildSteps.map((step) => [
    safe(step.target_role, 64),
    {
      step_id: safe(step.step_id, 160),
      step_hash: safe(step.step_hash, 128).toLowerCase(),
      target_role: safe(step.target_role, 64),
      capability_key: safe(step.capability_key, 160),
    },
  ]));
  const steps = ROLES.map((role) => byRole.get(role));
  if (rebuildSteps.length !== 2 || steps.some((step) => !step || !STEP.test(step.step_id) || !SHA256.test(step.step_hash))) {
    fail("RECOVERY_BRIDGE_STEP_SET_INVALID", "Recovery plan must contain exactly two canonical rebuild steps.");
  }
  return { plan_id: plan.plan_id, plan_hash: plan.plan_hash, steps };
}

async function createChallenge(plan, step, expectedSha) {
  const response = await runtime("POST", "/admin/recovery/kernel/approval-challenge", {
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    step_id: step.step_id,
  }, "recovery_approval_challenge");
  const result = response?.result;
  const approvalId = safe(result?.approval_id, 160);
  const phrase = safe(result?.confirmation_requirements?.confirmation_phrase, 640);
  const expected = "APPROVE PRODUCTION RECOVERY " + approvalId + " " + step.step_id + " " + expectedSha;
  if (!APPROVAL.test(approvalId) || phrase !== expected) {
    fail("RECOVERY_BRIDGE_CONFIRMATION_BINDING_INVALID", "Approval challenge binding is invalid.");
  }
  if (
    response?.approval_token_not_returned !== true
    || response?.execution_ticket_not_returned !== true
    || response?.secrets_included !== false
  ) {
    fail("RECOVERY_BRIDGE_CHALLENGE_SAFETY_INVALID", "Approval challenge exposed forbidden authority material.");
  }
  return { approval_id: approvalId, confirmation_phrase: phrase };
}

async function prepare() {
  const parsed = COMMENT.match(REBUILD);
  if (!parsed) fail("RECOVERY_BRIDGE_REBUILD_CONFIRMATION_INVALID", "Baseline rebuild command is invalid.");
  const expectedSha = parsed[1];
  const observed = await currentProductionSha();
  if (observed !== expectedSha) {
    fail("RECOVERY_BRIDGE_PRODUCTION_SHA_MOVED", "Production moved after authorization.", {
      expected_sha: expectedSha,
      observed_sha: observed,
    });
  }

  const inspected = await runtime("POST", "/admin/recovery/kernel/call", {
    capability_key: "database_full_inspection",
    input: { expected_sha: expectedSha, target_key: "production-runtime" },
  }, "recovery_full_inspection");
  const inspection = inspected?.result;
  if (inspection?.ok !== true || inspection?.read_only !== true || inspection?.database_mutation_performed === true) {
    fail("RECOVERY_BRIDGE_INSPECTION_UNSAFE", "Fresh inspection is not a successful read-only proof.");
  }
  if (inspection?.durability?.inspection_durable !== true || inspection?.durability?.mutation_grade_durable !== true) {
    fail("RECOVERY_MUTATION_STORE_NOT_READY", "Fresh inspection is not backed by a ready mutation-grade Recovery store.", {
      durability: inspection?.durability || null,
    });
  }

  const findings = (inspection.findings || []).filter((finding) => {
    const role = safe(finding?.subject?.target_role, 64);
    const capability = safe(finding?.candidate_capability || finding?.capability_key, 160);
    return ROLES.includes(role) && capability === role + ".baseline.rebuild_empty";
  });
  const findingRoles = [...new Set(findings.map((finding) => safe(finding?.subject?.target_role, 64)))].sort();
  if (
    JSON.stringify(findingRoles) !== JSON.stringify([...ROLES].sort())
    || findings.some((finding) => !FINDING.test(safe(finding.finding_id)))
  ) {
    fail("RECOVERY_BRIDGE_INSPECTION_ROLE_SET_MISMATCH", "Fresh server inspection did not derive exactly governance,runtime_persistence.", {
      finding_roles: findingRoles,
    });
  }

  const namespace = "prod-recovery:" + expectedSha.slice(0, 12) + ":" + WORKFLOW_RUN_ID + ":" + WORKFLOW_RUN_ATTEMPT;
  const planned = await runtime("POST", "/admin/recovery/kernel/call", {
    capability_key: "remediation_plan_create",
    input: {
      expected_sha: expectedSha,
      target_key: "production-runtime",
      finding_ids: findings.map((finding) => finding.finding_id),
      idempotency_key: namespace,
    },
  }, "recovery_plan_create");
  const plan = normalizePlan(planned?.result, expectedSha);
  const first = await createChallenge(plan, plan.steps[0], expectedSha);
  const state = {
    contract: "mad4b.production-recovery-governed-approval-marker.v1",
    expected_sha: expectedSha,
    target_key: "production-runtime",
    inspection_run_id: inspection.run_id,
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    steps: plan.steps,
    current_step_index: 0,
    approval_id: first.approval_id,
    idempotency_namespace: namespace,
    created_by_run_id: WORKFLOW_RUN_ID,
    secrets_included: false,
  };

  const comment = await postIssueComment([
    "## Production Recovery baseline rebuild - single-step approval required",
    "",
    "Exact Production: " + expectedSha,
    "Fresh durable inspection: " + inspection.run_id,
    "Server-derived roles: governance,runtime_persistence",
    "Current role: " + plan.steps[0].target_role,
    "",
    "Preparation performed no target-database mutation.",
    "Submit the exact next confirmation:",
    "",
    first.confirmation_phrase,
    "",
    "Approval material and execution tickets remain server-side.",
    encodeMarker(state),
  ].join("\n"));

  writeEvidence("prepare.json", {
    contract: "mad4b.production-recovery-governed-bridge-prepare.v1",
    status: "approval_required",
    expected_sha: expectedSha,
    inspection_run_id: inspection.run_id,
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    current_role: plan.steps[0].target_role,
    approval_id: first.approval_id,
    evidence_comment_id: comment?.id || null,
    database_mutation_performed: false,
    provider_mutation_performed: false,
  });
}

async function lookupMarker(approvalId, stepId, expectedSha) {
  const [owner, repo] = REPO.split("/");
  const comments = await github(
    "/repos/" + owner + "/" + repo + "/issues/" + ISSUE + "/comments?per_page=100&sort=created&direction=desc",
  );
  for (const comment of comments || []) {
    if (comment?.user?.login !== "github-actions[bot]") continue;
    const state = decodeMarker(comment.body);
    if (state?.contract !== "mad4b.production-recovery-governed-approval-marker.v1") continue;
    const step = state?.steps?.[state.current_step_index];
    if (state.approval_id === approvalId && state.expected_sha === expectedSha && step?.step_id === stepId) {
      return state;
    }
  }
  fail("RECOVERY_BRIDGE_APPROVAL_MARKER_NOT_FOUND", "No workflow-authored approval marker matches this confirmation.");
}

async function execute() {
  const parsed = COMMENT.match(APPROVE);
  if (!parsed) fail("RECOVERY_BRIDGE_TYPED_CONFIRMATION_INVALID", "Typed Production Recovery confirmation is invalid.");
  const [, approvalId, stepId, expectedSha] = parsed;
  const observed = await currentProductionSha();
  if (observed !== expectedSha) {
    fail("RECOVERY_BRIDGE_PRODUCTION_SHA_MOVED", "Production moved before execution.", {
      expected_sha: expectedSha,
      observed_sha: observed,
    });
  }

  const state = await lookupMarker(approvalId, stepId, expectedSha);
  if (!PLAN.test(state.plan_id) || !SHA256.test(String(state.plan_hash || "")) || !Array.isArray(state.steps)) {
    fail("RECOVERY_BRIDGE_APPROVAL_MARKER_INVALID", "Approval marker is malformed.");
  }
  const current = state.steps[state.current_step_index];
  if (current?.step_id !== stepId || !ROLES.includes(current?.target_role)) {
    fail("RECOVERY_BRIDGE_STEP_BINDING_MISMATCH", "Approval marker does not bind this role step.");
  }

  const executed = await runtime("POST", "/admin/recovery/kernel/execute-approved", {
    plan_id: state.plan_id,
    plan_hash: state.plan_hash,
    step_id: stepId,
    approval_id: approvalId,
    expected_sha: expectedSha,
    typed_confirmation: COMMENT,
    idempotency_key: state.idempotency_namespace + ":execute:" + current.target_role,
  }, "recovery_execute_approved");

  const bridge = executed?.result;
  if (
    !bridge
    || bridge.server_issued_execution_ticket !== true
    || bridge.execution_ticket_forwarded_internally !== true
    || bridge.execution_ticket_returned !== false
    || bridge.approval_token_returned !== false
    || bridge.secrets_included !== false
  ) {
    fail("RECOVERY_BRIDGE_EXECUTION_SAFETY_INVALID", "Execution bridge violated the server-issued-ticket/no-token contract.");
  }

  const recoveryRunId = safe(bridge.run_id, 160);
  if (!RUN.test(recoveryRunId)) {
    fail("RECOVERY_BRIDGE_RUN_ID_MISSING", "Execution did not return a durable Recovery run reference.");
  }

  const readback = await runtime(
    "GET",
    "/admin/recovery/kernel/runs/" + encodeURIComponent(recoveryRunId),
    null,
    "recovery_run_readback",
  );
  const status = safe(readback?.status || readback?.result?.status, 80);
  const phase = safe(readback?.phase || readback?.result?.phase, 80);
  const proof = readback?.evidence || readback?.result?.evidence || {};
  const verified = status === "completed"
    && (phase === "verified" || proof.verification_state === "verified" || proof.execution_outcome === "verified");

  if (!verified) {
    writeEvidence("execute-reconciliation.json", {
      contract: "mad4b.production-recovery-governed-bridge-execute.v1",
      status: "reconciliation_required",
      expected_sha: expectedSha,
      plan_id: state.plan_id,
      step_id: stepId,
      target_role: current.target_role,
      recovery_run_id: recoveryRunId,
      run_status: status,
      run_phase: phase,
      automatic_rerun_allowed: false,
      database_mutation_performed: bridge.database_mutation_performed === true,
    });
    fail(
      "RECOVERY_BRIDGE_READBACK_NOT_VERIFIED",
      "Provider returned but durable same-cycle readback is not verified; automatic replay is forbidden.",
      { recovery_run_id: recoveryRunId, run_status: status, run_phase: phase },
    );
  }

  const nextIndex = state.current_step_index + 1;
  if (nextIndex < state.steps.length) {
    const nextStep = state.steps[nextIndex];
    const next = await createChallenge(
      { plan_id: state.plan_id, plan_hash: state.plan_hash },
      nextStep,
      expectedSha,
    );
    const nextState = {
      ...state,
      current_step_index: nextIndex,
      approval_id: next.approval_id,
      previous_recovery_run_id: recoveryRunId,
      previous_role: current.target_role,
      secrets_included: false,
    };
    await postIssueComment([
      "## Production Recovery role verified: " + current.target_role,
      "",
      "Durable run: " + recoveryRunId,
      "Same-cycle readback: verified",
      "Next role: " + nextStep.target_role,
      "",
      "A separate single-step approval is required:",
      "",
      next.confirmation_phrase,
      "",
      "No caller-visible execution ticket or approval token was emitted.",
      encodeMarker(nextState),
    ].join("\n"));

    writeEvidence("execute.json", {
      contract: "mad4b.production-recovery-governed-bridge-execute.v1",
      status: "next_approval_required",
      expected_sha: expectedSha,
      target_role: current.target_role,
      recovery_run_id: recoveryRunId,
      next_role: nextStep.target_role,
      next_approval_id: next.approval_id,
      same_cycle_readback_verified: true,
      database_mutation_performed: bridge.database_mutation_performed === true,
    });
    return;
  }

  await postIssueComment([
    "## Production Recovery baseline rebuild completed",
    "",
    "Exact Production: " + expectedSha,
    "Final durable run: " + recoveryRunId,
    "Completed roles: governance,runtime_persistence",
    "Same-cycle readback: verified",
    "",
    "Grants/access repair and Migration 1051 remain separate governed operations.",
  ].join("\n"));

  writeEvidence("execute.json", {
    contract: "mad4b.production-recovery-governed-bridge-execute.v1",
    status: "baseline_rebuild_verified",
    expected_sha: expectedSha,
    target_role: current.target_role,
    recovery_run_id: recoveryRunId,
    completed_roles: ROLES,
    same_cycle_readback_verified: true,
    database_mutation_performed: bridge.database_mutation_performed === true,
  });
}

async function main() {
  requireBase();
  if (PHASE === "prepare") await prepare();
  else await execute();
}

main().catch((error) => {
  const failure = {
    contract: "mad4b.production-recovery-governed-bridge-failure.v1",
    ok: false,
    phase: PHASE || null,
    code: safe(error?.code || "RECOVERY_BRIDGE_FAILED", 128),
    message: safe(error?.message || "Production Recovery governed bridge failed.", 320),
    details: error?.details && typeof error.details === "object" ? error.details : null,
    automatic_rerun_allowed: false,
    secrets_included: false,
  };
  try { writeEvidence("failure.json", failure); } catch {}
  process.stderr.write(JSON.stringify(failure) + "\n");
  process.exitCode = 1;
});
