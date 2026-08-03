import assert from "node:assert/strict";
import {
  CLOSEOUT_CONFIRMATION,
  SPEC011_EVIDENCE_AUTO_CLOSEOUT_VERSION,
  collectAuthoritativeEvidence,
  createGovernedCloseoutPullRequest,
  executeEvidenceAutoCloseout,
  generateCloseoutChangeSet,
  validateCloseoutChangeSet,
} from "./spec011EvidenceAutoCloseout.js";

const SUBJECT = "spec011:phase7";
const BASE_SHA = "a".repeat(40);
const COMMIT_SHA = "b".repeat(40);
const BLOB_MANIFEST = "1".repeat(40);
const BLOB_COMPLETION = "2".repeat(40);
const BLOB_CHECKLIST = "3".repeat(40);
const BLOB_TASKS = "4".repeat(40);
const BLOB_DELIVERY = "5".repeat(40);
const NOW = new Date("2026-08-03T09:30:00.000Z");

function digest(seed) {
  return String(seed).repeat(64).slice(0, 64);
}

function observation(family, id, overrides = {}) {
  const prefixes = {
    pull_request: "github://pull/5207",
    workflow_run: "github://actions/run/30800375275",
    workflow_artifact: "github://actions/artifact/8850702200",
    main_readback: "git://blob/feff990361c069fc1b1cd8ce3dd0295202a987f9",
    migration_ledger: "migration://ledger/spec011",
    production_parity: "production://parity/spec011",
    post_merge_audit: "audit://post-merge/spec011",
  };
  return {
    evidence_id: id,
    family,
    subject: SUBJECT,
    source_ref: prefixes[family],
    digest_sha256: digest(id.length.toString(16)),
    observed_at: "2026-08-03T09:00:00.000Z",
    status: family === "pull_request" ? "merged" : "pass",
    authoritative: true,
    immutable: true,
    payload: { family, proof: true },
    secrets_included: false,
    ...overrides,
  };
}

function readers(extra = {}) {
  return {
    pull_request: async () => observation("pull_request", "ev-pr"),
    workflow_run: async () => observation("workflow_run", "ev-run"),
    workflow_artifact: async () => observation("workflow_artifact", "ev-artifact"),
    main_readback: async () => observation("main_readback", "ev-main"),
    ...extra,
  };
}

function documents() {
  return [
    {
      kind: "manifest_json",
      path: "specs/011-example/manifest.json",
      blob_sha: BLOB_MANIFEST,
      content: `${JSON.stringify({ spec_key: "011-example", status: "in_progress", phases: {} }, null, 2)}\n`,
    },
    {
      kind: "completion_json",
      path: "specs/011-example/completion.json",
      blob_sha: BLOB_COMPLETION,
      content: `${JSON.stringify({ schema_version: 1, feature_key: "011-example", status: "in_progress", delivery: {}, evidence: {} }, null, 2)}\n`,
    },
    {
      kind: "checklist_markdown",
      path: "specs/011-example/checklists/requirements.md",
      blob_sha: BLOB_CHECKLIST,
      content: "# Requirements\n\n- [ ] Authoritative evidence collector passes.\n- [ ] Production parity is recorded.\n",
    },
    {
      kind: "tasks_markdown",
      path: "specs/011-example/tasks.md",
      blob_sha: BLOB_TASKS,
      content: "# Tasks\n\n- [ ] T220 Add authoritative evidence collector.\n- [ ] T221 Add schemas.\n- [ ] T222 Generate semantic changes.\n",
    },
    {
      kind: "delivery_state_json",
      path: "specs/011-example/delivery-state.json",
      blob_sha: BLOB_DELIVERY,
      content: `${JSON.stringify({ schema_version: 1, status: "in_progress", phases: {} }, null, 2)}\n`,
    },
  ];
}

function intent() {
  return {
    manifest_updates: [{ pointer: "/phases/phase7", value: { status: "certified" }, evidence_ids: ["ev-pr", "ev-run"] }],
    completion_updates: [{ pointer: "/delivery/phase7", value: { status: "merged" }, evidence_ids: ["ev-pr", "ev-artifact"] }],
    checklist_closures: [{ item: "Authoritative evidence collector passes.", evidence_ids: ["ev-run"] }],
    task_closures: [{ task_id: "T220", evidence_ids: ["ev-pr", "ev-run", "ev-main"] }],
    delivery_state_updates: [{ pointer: "/phases/phase7", value: { status: "complete_on_main" }, evidence_ids: ["ev-main"] }],
  };
}

const packet = await collectAuthoritativeEvidence({
  subject: SUBJECT,
  now: NOW,
}, { readers: readers() });
assert.equal(packet.version, SPEC011_EVIDENCE_AUTO_CLOSEOUT_VERSION);
assert.equal(packet.observations.length, 4);
assert.deepEqual(packet.required_families, ["main_readback", "pull_request", "workflow_artifact", "workflow_run"]);
assert.match(packet.evidence_fingerprint_sha256, /^[0-9a-f]{64}$/);
assert.equal(packet.secrets_included, false);

await assert.rejects(
  () => collectAuthoritativeEvidence({ subject: SUBJECT, now: NOW }, {
    readers: readers({ workflow_run: async () => [] }),
  }),
  (error) => error?.code === "CLOSEOUT_EVIDENCE_CARDINALITY_INVALID",
);
await assert.rejects(
  () => collectAuthoritativeEvidence({ subject: SUBJECT, now: NOW }, {
    readers: readers({
      workflow_run: async () => observation("workflow_run", "ev-run", { observed_at: "2026-01-01T00:00:00.000Z" }),
    }),
  }),
  (error) => error?.code === "CLOSEOUT_EVIDENCE_STALE",
);
await assert.rejects(
  () => collectAuthoritativeEvidence({ subject: SUBJECT, now: NOW }, {
    readers: readers({
      workflow_run: async () => observation("workflow_run", "ev-run", { payload: { access_token: "not-allowed" } }),
    }),
  }),
  (error) => error?.code === "CLOSEOUT_SECRET_FIELD_REJECTED",
);
await assert.rejects(
  () => collectAuthoritativeEvidence({ subject: SUBJECT, now: NOW }, {
    readers: readers({
      workflow_run: async () => observation("workflow_run", "ev-pr"),
    }),
  }),
  (error) => error?.code === "CLOSEOUT_EVIDENCE_ID_DUPLICATE",
);

const changeSet = generateCloseoutChangeSet({ documents: documents(), intent: intent(), evidence_packet: packet });
assert.equal(changeSet.changes.length, 5);
assert.deepEqual(changeSet.changes.map((change) => change.kind), [
  "checklist_markdown",
  "completion_json",
  "delivery_state_json",
  "manifest_json",
  "tasks_markdown",
]);
assert(changeSet.changes.find((change) => change.kind === "tasks_markdown").after_content.includes("- [x] T220"));
assert(changeSet.changes.find((change) => change.kind === "checklist_markdown").after_content.includes("- [x] Authoritative evidence collector passes."));
assert.equal(changeSet.force_push_allowed, false);
assert.match(changeSet.change_set_sha256, /^[0-9a-f]{64}$/);

const validation = validateCloseoutChangeSet(changeSet);
assert.equal(validation.ok, true);
assert.equal(validation.status, "pass");
assert.equal(validation.diagnosis.status, "pass");

const tampered = {
  ...changeSet,
  changes: changeSet.changes.map((change, index) => index === 0 ? { ...change, after_content: `${change.after_content}\ntampered` } : change),
};
const tamperedValidation = validateCloseoutChangeSet(tampered);
assert.equal(tamperedValidation.ok, false);
assert(tamperedValidation.blockers.some((blocker) => blocker.startsWith("CLOSEOUT_AFTER_DIGEST_MISMATCH")));

assert.throws(
  () => generateCloseoutChangeSet({
    documents: documents(),
    evidence_packet: packet,
    intent: {
      ...intent(),
      completion_updates: [{ pointer: "/status", value: "complete", evidence_ids: ["ev-pr", "ev-run", "ev-main"] }],
    },
  }),
  (error) => error?.code === "CLOSEOUT_TERMINAL_COMPLETION_NOT_PROVEN",
);

const completePacket = await collectAuthoritativeEvidence({
  subject: SUBJECT,
  now: NOW,
  required_families: [
    "pull_request",
    "workflow_run",
    "workflow_artifact",
    "main_readback",
    "migration_ledger",
    "production_parity",
    "post_merge_audit",
  ],
}, {
  readers: readers({
    migration_ledger: async () => observation("migration_ledger", "ev-migration"),
    production_parity: async () => observation("production_parity", "ev-production"),
    post_merge_audit: async () => observation("post_merge_audit", "ev-audit"),
  }),
});
const terminalIntent = {
  manifest_updates: [{ pointer: "/status", value: "complete", evidence_ids: ["ev-production", "ev-audit"] }],
  completion_updates: [{ pointer: "/status", value: "complete", evidence_ids: ["ev-migration", "ev-production", "ev-audit"] }],
  checklist_closures: [
    { item: "Authoritative evidence collector passes.", evidence_ids: ["ev-run"] },
    { item: "Production parity is recorded.", evidence_ids: ["ev-production"] },
  ],
  task_closures: [
    { task_id: "T220", evidence_ids: ["ev-pr"] },
    { task_id: "T221", evidence_ids: ["ev-run"] },
    { task_id: "T222", evidence_ids: ["ev-artifact"] },
  ],
  delivery_state_updates: [{ pointer: "/status", value: "complete", evidence_ids: ["ev-production", "ev-audit"] }],
};
const terminalChangeSet = generateCloseoutChangeSet({ documents: documents(), intent: terminalIntent, evidence_packet: completePacket });
assert.equal(validateCloseoutChangeSet(terminalChangeSet).ok, true);

const awaiting = await createGovernedCloseoutPullRequest({
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  closeout_branch: "gpt/spec011-closeout-test",
  expected_base_sha: BASE_SHA,
  title: "docs: close evidence",
  body: "Evidence closeout",
  commit_message: "docs: close evidence",
  idempotency_key: "closeout-test",
  change_set: changeSet,
}, {});
assert.equal(awaiting.status, "awaiting_approval");
assert.equal(awaiting.required_confirmation, CLOSEOUT_CONFIRMATION);

function successfulDispatchRecorder({ unknownCreate = false, recoverRows = null, patchUnknown = false } = {}) {
  const calls = [];
  const dispatch = async (toolKey, args) => {
    calls.push({ toolKey, args });
    if (toolKey === "repo_patch_batch_apply") {
      if (patchUnknown) return { status: "unknown_outcome", unknown_outcome: true };
      return {
        ok: true,
        commit_sha: COMMIT_SHA,
        changed_files: changeSet.changes.map((change) => change.path),
        readback_verified: true,
        force_push_used: false,
        secrets_included: false,
      };
    }
    assert.equal(toolKey, "github_rest_endpoint_dispatch");
    const endpoint = args.tool_args.endpoint_key;
    if (endpoint === "github_create_pull_request") {
      if (unknownCreate) return { status: "unknown_outcome", unknown_outcome: true };
      return { number: 7001, state: "open", head: { ref: "gpt/spec011-closeout-test", sha: COMMIT_SHA }, base: { ref: "main" } };
    }
    if (endpoint === "github_list_pull_requests") return recoverRows ?? [];
    if (endpoint === "github_get_pull_request") {
      return {
        number: 7001,
        state: "open",
        head: { ref: "gpt/spec011-closeout-test", sha: COMMIT_SHA },
        base: { ref: "main" },
        html_url: "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pull/7001",
      };
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  };
  return { calls, dispatch };
}

const successRecorder = successfulDispatchRecorder();
const created = await createGovernedCloseoutPullRequest({
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  closeout_branch: "gpt/spec011-closeout-test",
  expected_base_sha: BASE_SHA,
  title: "docs: close evidence",
  body: "Evidence closeout",
  commit_message: "docs: close evidence",
  idempotency_key: "closeout-test",
  confirmation: CLOSEOUT_CONFIRMATION,
  mutation_approval: { approved_by: "phase7-reviewer", reason: "certification", secrets_included: false },
  change_set: changeSet,
}, {
  dispatch: successRecorder.dispatch,
  previewOperation: async (input) => ({ ok: true, operation_key: input.operation_key, mutations_executed: false, secrets_included: false }),
});
assert.equal(created.ok, true);
assert.equal(created.status, "created");
assert.equal(created.pull_request.number, 7001);
assert.equal(created.pull_request.head_sha, COMMIT_SHA);
assert.equal(created.readback_verified, true);
assert.equal(created.force_push_used, false);
assert.deepEqual(successRecorder.calls.map((call) => call.toolKey), [
  "repo_patch_batch_apply",
  "github_rest_endpoint_dispatch",
  "github_rest_endpoint_dispatch",
]);
assert.equal(successRecorder.calls[1].args.tool_args.endpoint_key, "github_create_pull_request");
assert.equal(successRecorder.calls[2].args.tool_args.endpoint_key, "github_get_pull_request");
assert.equal(successRecorder.calls[0].args.force, false);
assert.equal(successRecorder.calls[0].args.force_push, false);

const recoveredRow = {
  number: 7001,
  state: "open",
  head: { ref: "gpt/spec011-closeout-test", sha: COMMIT_SHA },
  base: { ref: "main" },
};
const recoveryRecorder = successfulDispatchRecorder({ unknownCreate: true, recoverRows: [recoveredRow] });
const recovered = await createGovernedCloseoutPullRequest({
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  closeout_branch: "gpt/spec011-closeout-test",
  expected_base_sha: BASE_SHA,
  title: "docs: close evidence",
  body: "Evidence closeout",
  commit_message: "docs: close evidence",
  idempotency_key: "closeout-recovery",
  confirmation: CLOSEOUT_CONFIRMATION,
  mutation_approval: { approved_by: "phase7-reviewer", reason: "certification", secrets_included: false },
  change_set: changeSet,
}, {
  dispatch: recoveryRecorder.dispatch,
  previewOperation: async () => ({ ok: true, mutations_executed: false, secrets_included: false }),
});
assert.equal(recovered.status, "created");
assert.equal(recoveryRecorder.calls.filter((call) => call.args?.tool_args?.endpoint_key === "github_create_pull_request").length, 1);
assert.equal(recoveryRecorder.calls.filter((call) => call.args?.tool_args?.endpoint_key === "github_list_pull_requests").length, 1);

const unresolvedRecorder = successfulDispatchRecorder({ unknownCreate: true, recoverRows: [] });
const unresolved = await createGovernedCloseoutPullRequest({
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  closeout_branch: "gpt/spec011-closeout-test",
  expected_base_sha: BASE_SHA,
  title: "docs: close evidence",
  body: "Evidence closeout",
  commit_message: "docs: close evidence",
  idempotency_key: "closeout-unknown",
  confirmation: CLOSEOUT_CONFIRMATION,
  mutation_approval: { approved_by: "phase7-reviewer", reason: "certification", secrets_included: false },
  change_set: changeSet,
}, {
  dispatch: unresolvedRecorder.dispatch,
  previewOperation: async () => ({ ok: true, mutations_executed: false, secrets_included: false }),
});
assert.equal(unresolved.status, "reconciliation_required");
assert.equal(unresolved.automatic_retry_allowed, false);
assert.equal(unresolvedRecorder.calls.filter((call) => call.args?.tool_args?.endpoint_key === "github_create_pull_request").length, 1);

const patchUnknownRecorder = successfulDispatchRecorder({ patchUnknown: true });
const patchUnknown = await createGovernedCloseoutPullRequest({
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  closeout_branch: "gpt/spec011-closeout-test",
  expected_base_sha: BASE_SHA,
  title: "docs: close evidence",
  body: "Evidence closeout",
  commit_message: "docs: close evidence",
  idempotency_key: "closeout-patch-unknown",
  confirmation: CLOSEOUT_CONFIRMATION,
  mutation_approval: { approved_by: "phase7-reviewer", reason: "certification", secrets_included: false },
  change_set: changeSet,
}, {
  dispatch: patchUnknownRecorder.dispatch,
  previewOperation: async () => ({ ok: true, mutations_executed: false, secrets_included: false }),
});
assert.equal(patchUnknown.status, "reconciliation_required");
assert.equal(patchUnknown.stage, "repository_patch");
assert.equal(patchUnknownRecorder.calls.length, 1);

const executeRecorder = successfulDispatchRecorder();
const executed = await executeEvidenceAutoCloseout({
  evidence_request: { subject: SUBJECT, now: NOW },
  documents: documents(),
  intent: intent(),
  pull_request: {
    owner: "mad4bdigital-ai",
    repo: "multi-business-multi-role-growth-intelligence-os",
    closeout_branch: "gpt/spec011-closeout-test",
    expected_base_sha: BASE_SHA,
    title: "docs: close evidence",
    body: "Evidence closeout",
    commit_message: "docs: close evidence",
    idempotency_key: "closeout-e2e",
    confirmation: CLOSEOUT_CONFIRMATION,
    mutation_approval: { approved_by: "phase7-reviewer", reason: "certification", secrets_included: false },
  },
}, {
  evidenceReaders: readers(),
  dispatch: executeRecorder.dispatch,
  previewOperation: async () => ({ ok: true, mutations_executed: false, secrets_included: false }),
});
assert.equal(executed.ok, true);
assert.equal(executed.status, "created");
assert.equal(executed.validation.status, "pass");
assert.equal(executed.pull_request.pull_request.number, 7001);

console.log("Spec 011 evidence auto-closeout tests passed");
