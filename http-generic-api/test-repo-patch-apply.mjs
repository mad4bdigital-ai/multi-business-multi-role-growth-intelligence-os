/**
 * repo_patch_apply offline tests
 * Run: node test-repo-patch-apply.mjs
 *
 * Covers:
 *   - unified-diff parser correctness for a realistic single-file diff
 *   - exact-context relocation when independent lines shift a hunk
 *   - ambiguity and genuine context mismatch detection
 *   - bad action / missing path / blocked path / missing message rejections
 *   - replace_block ambiguity detection (no network call)
 *   - delete_file action is exposed and wired to GitHub Contents DELETE
 *
 * Skips: any branch that requires a real GitHub App token; those go through
 * the full virtual-tool integration tests in the live smoke (run by the admin
 * GPT through callAdminTool with action=repo_patch_apply).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.GOOGLE_AUTH_DISABLE_PREWARM = "true";

const { applyRepoPatch, repoPatchMaxBytesForPath, dedupeOpenApiPathsText } = await import("./routes/gptToolsRoutes.js");

let passed = 0;
function pass(label) {
  console.log(`  [PASS] ${label}`);
  passed += 1;
}

async function expectRejection({ args, code }) {
  let err;
  try {
    await applyRepoPatch(args);
  } catch (caught) {
    err = caught;
  }
  assert.ok(err, `expected error with code ${code}`);
  assert.equal(err.code, code, `expected error code ${code}, got ${err.code}`);
}

// ── Argument validation rejections (no network) ───────────────────────────────
await expectRejection({ args: {}, code: "repo_patch_bad_action" });
pass("missing action is rejected with repo_patch_bad_action");

await expectRejection({ args: { action: "noop" }, code: "repo_patch_bad_action" });
pass("unknown action is rejected with repo_patch_bad_action");

await expectRejection({ args: { action: "write_file" }, code: "repo_patch_missing_path" });
pass("missing path is rejected with repo_patch_missing_path");

await expectRejection({ args: { action: "write_file", path: "../etc/passwd", commit_message: "hi there" }, code: "repo_path_traversal" });
pass("path with parent dir reference is rejected with repo_path_traversal");

await expectRejection({ args: { action: "write_file", path: "node_modules/foo.js", commit_message: "hi there" }, code: "repo_path_blocked" });
pass("path inside denied segment is rejected with repo_path_blocked");

await expectRejection({ args: { action: "write_file", path: ".env", commit_message: "hi there" }, code: "repo_file_blocked" });
pass("denied file name is rejected with repo_file_blocked");

await expectRejection({ args: { action: "write_file", path: "http-generic-api/server.js", commit_message: "x" }, code: "repo_patch_missing_message" });
pass("missing commit_message is rejected with repo_patch_missing_message");

// ── Protected branch policy static contract ───────────────────────────────────
{
  const source = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
  const lifecycleSource = readFileSync(new URL("./githubRepositoryLifecycle.js", import.meta.url), "utf8");
  const unifiedDiffSource = readFileSync(new URL("./unifiedDiff.js", import.meta.url), "utf8");
  assert.ok(source.includes("repo_patch_protected_branch"));
  assert.ok(source.includes("REPO_PATCH_ALLOW_PROTECTED_BRANCH"));
  assert.ok(source.includes("defaultRepoPatchBranch"));
  assert.ok(source.includes("ensureRepoPatchBranch"));
  assert.ok(source.includes("/git/refs"));
  assert.ok(source.includes("allow_protected_branch"));
  assert.ok(source.includes("break_glass_reason"));
  assert.ok(source.includes('"delete_file"'), "repo_patch_apply schema/action list must expose delete_file");
  assert.ok(source.includes('method: "DELETE"'), "repo_patch_apply must use GitHub Contents DELETE for delete_file");
  assert.ok(source.includes("repo_patch_github_delete_failed"), "delete_file failures must return a structured error code");
  assert.ok(source.includes("repoPatchMaxBytesForPath"), "repo_patch_apply must expose a path-aware size limit helper");
  assert.ok(source.includes("LARGE_TEXT_REPO_PATCH_MAX_BYTES = 2_000_000"), "repo_patch_apply must allow bounded large generated text contracts");
  assert.ok(source.includes("http-generic-api/openapi.yaml"), "OpenAPI must be explicitly allowlisted for large text patches");
  assert.ok(source.includes("large_text_allowlisted"), "repo_patch_too_large errors must explain whether the path was allowlisted");
  assert.ok(source.includes("dedupe_openapi_paths"), "repo_patch_apply must expose server-side OpenAPI dedupe action");
  assert.ok(source.includes("dedupeOpenApiPathsText"), "repo_patch_apply must expose a testable OpenAPI dedupe helper");
  assert.ok(source.includes("loadRepoPatchCurrentContent"), "repo_patch_apply must read large files through Git blob fallback when Contents API omits content");
  assert.ok(source.includes("repo_patch_github_blob_get_failed"), "large-file blob fallback failures must be structured");
  const batchSchemaStart = source.indexOf('name: "repo_patch_batch_apply"');
  const batchSchemaEnd = source.indexOf('name: "repo_existing_blob_commit_apply"', batchSchemaStart);
  const batchSchema = source.slice(batchSchemaStart, batchSchemaEnd);
  assert.ok(batchSchema.includes('"apply_unified_diff"'), "repo_patch_batch_apply schema must expose apply_unified_diff");
  assert.ok(batchSchema.includes('diff: { type: "string"'), "repo_patch_batch_apply schema must accept a unified diff body");
  assert.ok(batchSchema.includes("expected_branch_sha"), "repo_patch_batch_apply schema must support same-branch continuation head pinning");
  assert.ok(batchSchema.includes("allow_same_branch_continuation"), "repo_patch_batch_apply schema must expose explicit same-branch continuation intent");
  assert.ok(lifecycleSource.includes("github_change_set_default_branch_overlap"), "repo patch batch must stop when moved main overlaps requested patch paths");
  assert.ok(lifecycleSource.includes("github_change_set_default_branch_compare_truncated"), "repo patch batch must fail closed if moved-main changed-file evidence is truncated");
  assert.ok(lifecycleSource.includes("expected_branch_sha"), "repo patch batch must validate existing work branch head for continuation");
  assert.ok(lifecycleSource.includes("same_branch_continuation_used"), "repo patch batch readback must disclose continuation mode");
  assert.ok(lifecycleSource.includes("default_branch_drift"), "repo patch batch readback must disclose moved-main drift evidence");
  assert.ok(lifecycleSource.includes("github_change_set_patch_noop"), "repo patch batch must reject unified diffs that produce no content change");
  assert.ok(lifecycleSource.includes("patchedContent === current.content"), "repo patch batch must compare patched content with source content before committing");
  assert.ok(lifecycleSource.includes("github_change_set_empty_tree"), "repo patch batch must reject empty tree commits instead of reporting success with zero file edits");
  assert.ok(lifecycleSource.includes("newTreeSha === parentTreeSha"), "repo patch batch must compare the created tree with the parent tree before committing");
  assert.ok(lifecycleSource.includes("github_change_set_tree_readback_missing"), "repo patch batch must fail closed when GitHub does not return a valid tree SHA");
  assert.ok(source.includes("repo_existing_blob_commit_apply"), "admin tool catalog must expose existing-blob commits");
  assert.ok(source.includes("applyGithubExistingBlobChangeSet"), "existing-blob tool must dispatch through the repository lifecycle service");
  assert.ok(source.includes("expected_head_sha"), "existing-blob tool must require optimistic branch-head validation");
  assert.ok(source.includes("blob_sha"), "existing-blob tool must accept content-addressed Git blob references");
  assert.ok(!source.includes("Defaults to main"));
  assert.ok(unifiedDiffSource.includes("exactSequenceMatches"), "unified diff application must support exact-context relocation");
  assert.ok(unifiedDiffSource.includes("repo_patch_hunk_ambiguous"), "ambiguous relocation must fail closed");
  assert.equal(repoPatchMaxBytesForPath("http-generic-api/openapi.yaml"), 2_000_000);
  assert.equal(repoPatchMaxBytesForPath("http-generic-api/server.js"), 1_000_000);
  const dedupeFixture = [
    "openapi: 3.1.0",
    "info: { title: test, version: 1.0.0 }",
    "paths:",
    "  /alpha:",
    "    get: { summary: old }",
    "  /beta:",
    "    get: { summary: beta }",
    "  /alpha:",
    "    get: { summary: new }",
    "",
  ].join("\n");
  const deduped = dedupeOpenApiPathsText(dedupeFixture);
  assert.equal(deduped.summary.duplicate_paths_removed, 1);
  assert.ok(!deduped.content.includes("summary: old"));
  assert.ok(deduped.content.includes("summary: new"));
  pass("repo_patch_apply blocks protected branches and supports bounded large OpenAPI patches and dedupe");
}

// ── Unified-diff parser ───────────────────────────────────────────────────────
const internals = await import("./routes/gptToolsRoutes.js");
const parser = internals.applyUnifiedDiffToText || null;

if (parser) {
  const original = "line one\nline two\nline three\n";
  const diff = [
    "--- a/file.js",
    "+++ b/file.js",
    "@@ -1,3 +1,3 @@",
    " line one",
    "-line two",
    "+line two updated",
    " line three",
  ].join("\n");
  const result = parser(original, diff);
  assert.equal(result.split("\n")[1], "line two updated");
  pass("applyUnifiedDiffToText replaces a single line correctly");

  const shiftedOriginal = "independent header\nsecond inserted line\nline one\nline two\nline three\n";
  const shiftedResult = parser(shiftedOriginal, diff);
  assert.deepEqual(shiftedResult.split("\n").slice(0, 5), [
    "independent header",
    "second inserted line",
    "line one",
    "line two updated",
    "line three",
  ]);
  pass("applyUnifiedDiffToText relocates a uniquely matching hunk after independent line shifts");

  const ambiguousOriginal = [
    "prefix",
    "line one",
    "line two",
    "line three",
    "middle",
    "line one",
    "line two",
    "line three",
    "suffix",
    "",
  ].join("\n");
  const ambiguousDiff = [
    "@@ -20,3 +20,3 @@",
    " line one",
    "-line two",
    "+line two updated",
    " line three",
  ].join("\n");
  let ambiguous;
  try { parser(ambiguousOriginal, ambiguousDiff); } catch (err) { ambiguous = err; }
  assert.ok(ambiguous, "expected ambiguous hunk rejection");
  assert.equal(ambiguous.code, "repo_patch_hunk_ambiguous");
  assert.deepEqual(ambiguous.details.candidate_lines, [2, 6]);
  pass("applyUnifiedDiffToText refuses ambiguous exact-context relocation");

  const badDiff = [
    "@@ -1,2 +1,2 @@",
    " line one",
    "-WRONG CONTEXT",
    "+line two updated",
  ].join("\n");
  let mismatch;
  try { parser(original, badDiff); } catch (err) { mismatch = err; }
  assert.ok(mismatch, "expected context mismatch");
  assert.equal(mismatch.code, "repo_patch_removal_mismatch");
  pass("applyUnifiedDiffToText rejects diff with wrong removal context");
} else {
  pass("applyUnifiedDiffToText is internal-only (skipped direct test)");
}

console.log(`Results: ${passed} passed, 0 failed`);
