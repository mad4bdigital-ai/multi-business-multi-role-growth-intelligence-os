import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateFeatureDirectory, validateRepository } from "./scripts/spec-kit-completion-gate.mjs";

const FIXTURE_HEAD_REF = "gpt/spec-closeout";

const policy = {
  schema_version: 1,
  policy_key: "spec_kit_completion_gate_v1",
  enforcement_mode: "changed_scope_fail_closed",
  spec_root: "specs",
  required_feature_files: ["spec.md", "plan.md", "tasks.md", "completion.json"],
  required_checklist_directory: "checklists",
  delivery_modes: ["single_pr", "multi_pr"],
  completion_statuses: ["in_progress", "complete"],
  single_pr_forbidden_requirements: ["migration", "production_verification", "post_merge_audit"],
  accepted_checkbox_states: { complete: ["x", "X"], not_applicable: ["~"] },
  current_pr_marker: "current",
};

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function validCompletion(overrides = {}) {
  return {
    schema_version: 1,
    feature_key: "001-example",
    status: "complete",
    delivery_mode: "multi_pr",
    requirements: { migration: true, production_verification: true, post_merge_audit: true },
    delivery: {
      implementation_prs: [{ number: 100, status: "merged", merge_sha: "a".repeat(40) }],
      closeout_pr: { number: "current", branch: "gpt/spec-closeout", role: "completion", status: "current_pr" },
    },
    evidence: {
      ci: { status: "pass", head_sha: "b".repeat(40) },
      release_readiness: { status: "pass" },
      migration: { status: "applied", checksum_sha256: "c".repeat(64), statement_count: 2, ledger_run_id: "migration-run" },
      production_verification: { status: "verified", run_id: "runtime-run", expected_commit_sha: "d".repeat(40), deployed_commit_sha: "d".repeat(40) },
      post_merge_audit: { status: "completed_with_backlog", run_id: "audit-run", backlog_refs: ["specs/001-example/backlog.md"] },
    },
    ...overrides,
  };
}

function fixture(completion = validCompletion(), tasks = "- [x] Done\n", checklist = "- [x] Reviewed\n") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spec-kit-gate-"));
  write(root, ".specify/spec-kit-governance.json", JSON.stringify(policy));
  write(root, "specs/001-example/spec.md", "# Spec\n");
  write(root, "specs/001-example/plan.md", "# Plan\n");
  write(root, "specs/001-example/tasks.md", tasks);
  write(root, "specs/001-example/checklists/requirements.md", checklist);
  if (completion) write(root, "specs/001-example/completion.json", JSON.stringify(completion));
  return root;
}

{
  const root = fixture();
  assert.deepEqual(validateFeatureDirectory("001-example", { root, policy, headRef: FIXTURE_HEAD_REF }), []);
}

{
  const root = fixture(validCompletion(), "- [ ] Pending\n");
  assert(validateFeatureDirectory("001-example", { root, policy, headRef: FIXTURE_HEAD_REF }).some((row) => row.type === "unresolved_completion_items"));
}

{
  const completion = validCompletion({ delivery_mode: "single_pr" });
  const root = fixture(completion);
  assert(validateFeatureDirectory("001-example", { root, policy }).some((row) => row.type === "single_pr_has_post_merge_obligations"));
}

{
  const completion = validCompletion({
    evidence: { ...validCompletion().evidence, post_merge_audit: { status: "completed_with_backlog", run_id: "audit-run", backlog_refs: [] } },
  });
  const root = fixture(completion);
  assert(validateFeatureDirectory("001-example", { root, policy }).some((row) => row.type === "audit_backlog_not_tracked"));
}

{
  const root = fixture(null);
  const result = validateRepository({ root, policy, changedFiles: ["specs/001-example/spec.md"] });
  assert(result.findings.some((row) => row.type === "changed_spec_kit_missing_completion_manifest"));
}

{
  const root = fixture(validCompletion({ status: "in_progress" }), "- [ ] Pending\n", "- [ ] Review pending\n");
  assert.deepEqual(validateFeatureDirectory("001-example", { root, policy }), []);
}

console.log("spec kit completion governance tests passed");
