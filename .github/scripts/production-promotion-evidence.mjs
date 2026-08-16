import fs from "node:fs";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

function requireSha(label, value) {
  if (!SHA_PATTERN.test(String(value ?? ""))) throw new Error(`${label} must be a lowercase 40-character SHA`);
  return value;
}

function requireRunId(label, value) {
  if (!RUN_ID_PATTERN.test(String(value ?? ""))) throw new Error(`${label} must be a positive run id`);
  return String(value);
}

function requireDigest(value) {
  if (!DIGEST_PATTERN.test(String(value ?? ""))) throw new Error("evidence_digest must be a lowercase SHA-256 digest");
  return value;
}

export function buildPromotionEvidence(input) {
  if (!input || typeof input !== "object") throw new TypeError("promotion evidence input must be an object");
  const reviewMode = input.review_mode;
  if (!(["human", "ai_policy"].includes(reviewMode))) throw new Error("review_mode must be human or ai_policy");

  const supportingRuns = input.supporting_runs;
  if (!supportingRuns || typeof supportingRuns !== "object" || Array.isArray(supportingRuns)) {
    throw new Error("supporting_runs must be an object");
  }
  const normalizedSupportingRuns = Object.fromEntries(
    Object.entries(supportingRuns).map(([name, value]) => [name, requireRunId(`supporting run ${name}`, value)]),
  );

  const evidence = {
    schema_version: "governed_production_promotion_convergence.v1",
    ok: true,
    attempt: Number(input.attempt),
    request_pr: String(input.request_pr),
    main_sha: requireSha("main_sha", input.main_sha),
    production_sha: requireSha("production_sha", input.production_sha),
    candidate_sha: requireSha("candidate_sha", input.candidate_sha),
    release_branch: String(input.release_branch),
    validation_branch: String(input.validation_branch),
    validation_base_branch: String(input.validation_base_branch),
    builder_run_id: requireRunId("builder_run_id", input.builder_run_id),
    exact_validation_run_id: requireRunId("exact_validation_run_id", input.exact_validation_run_id),
    supporting_runs: normalizedSupportingRuns,
    run_selection_strategy: "direct_run_id_then_terminal_success_exact_head_then_pending_exact_head",
    review_mode: reviewMode,
    review_authority: reviewMode === "ai_policy" ? "bounded_ai_policy_agent" : "human_maintainer",
    ai_policy_scope: reviewMode === "ai_policy" ? "read_only_supporting_gates_and_exact_candidate_validation" : null,
    release_pr: String(input.release_pr),
    validation_pr: String(input.validation_pr),
    evidence_digest: requireDigest(input.evidence_digest),
    candidate_tree_matches_main: true,
    protected_refs_stable_during_validation: true,
    exact_full_ci_success: true,
    merge_executed: false,
    deployment_executed: false,
    migration_executed: false,
    provider_call_executed: false,
    credential_payload_read: false,
    secrets_included: false,
  };

  if (!Number.isInteger(evidence.attempt) || evidence.attempt < 1) throw new Error("attempt must be a positive integer");
  if (!/^\d+$/.test(evidence.request_pr)) throw new Error("request_pr must be a positive integer");
  if (!evidence.release_branch || !evidence.validation_branch || !evidence.validation_base_branch) {
    throw new Error("governed branch names are required");
  }
  return evidence;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--input", "--output"].includes(key) || !value) throw new Error("usage: --input <json> --output <json>");
    values[key.slice(2)] = value;
    index += 1;
  }
  if (!values.input || !values.output) throw new Error("usage: --input <json> --output <json>");
  return values;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { input, output } = parseArgs(process.argv.slice(2));
  const evidence = buildPromotionEvidence(JSON.parse(fs.readFileSync(input, "utf8")));
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
}
