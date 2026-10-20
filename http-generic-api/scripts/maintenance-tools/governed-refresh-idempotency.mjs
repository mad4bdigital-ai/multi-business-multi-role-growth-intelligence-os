// Trusted dispatcher helper: inspect only GitHub's writer-run metadata, never candidate PR code.
// The PR number is bound to the unique exact head branch by the calling dispatcher.
import fs from "node:fs";

const SHA_RE = /^[0-9a-f]{40}$/u;
const RECIPE_RE = /^(auto|frontend_openapi_refresh|work_map_self_hosting_bootstrap|remote_mcp_write_scope_refresh|repository_inventory_refresh)$/u;
const REF_RE = /^(gpt|cert|fix|feat|chore|docs|release)\/[A-Za-z0-9._/-]+$/u;

export function idempotencyDecision({ prNumber, expectedHeadSha, targetRef, recipe, runs }) {
  if (!Number.isSafeInteger(prNumber) || prNumber < 1 ||
      !SHA_RE.test(expectedHeadSha || "") ||
      !REF_RE.test(targetRef || "") ||
      !RECIPE_RE.test(recipe || "") ||
      !Array.isArray(runs)) throw Error("invalid_exact_head_refresh_idempotency_input");
  const key = `pr:${prNumber}:sha:${expectedHeadSha}:recipe:${recipe}`;
  const title = `Governed Generated Artifact Refresh · ${recipe} · ${targetRef} · ${expectedHeadSha}`;
  const active = new Set(["queued", "pending", "waiting", "requested", "in_progress"]);
  const matches = runs
    .filter((run) => run && run.event === "workflow_dispatch" && run.display_title === title &&
      Number.isSafeInteger(run.id) && run.id > 0 &&
      (active.has(run.status) || (run.status === "completed" && run.conclusion === "success")))
    .sort((a, b) => a.id - b.id);
  return Object.freeze({
    contract: "mad4b.governed-refresh-idempotency.v1",
    key, pr_number: prNumber, expected_head_sha: expectedHeadSha, recipe,
    target_ref: targetRef, decision: matches.length ? "already_requested" : "dispatch",
    matched_run_id: matches[0]?.id ?? null,
    matched_run_url: matches[0]?.html_url ?? null,
    reason: matches.length ? "same_pr_sha_recipe_writer_running_or_succeeded" : null,
    dispatch_requested: false,
    secrets_included: false,
  });
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw Error(`missing argument ${name}`);
  return process.argv[index + 1];
}
if (process.argv[1]?.endsWith("/governed-refresh-idempotency.mjs")) {
  try {
    const runs = JSON.parse(fs.readFileSync(readArgument("--runs"), "utf8"));
    const report = idempotencyDecision({
      prNumber: Number(readArgument("--pr")),
      expectedHeadSha: readArgument("--head"),
      targetRef: readArgument("--ref"),
      recipe: readArgument("--recipe"),
      runs,
    });
    fs.writeFileSync(readArgument("--output"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error("governed_refresh_idempotency_preflight_failed:", error?.message || String(error));
    process.exitCode = 1; // fail closed: never dispatch after a failed lookup / malformed response
  }
}
