import fs from "node:fs";
import { buildStateEnvelope, buildSurfaceNames } from "./production-promotion-operation-state.mjs";

const SHA_RE = /^[0-9a-f]{40}$/u;
const BOOLEAN_RE = /^(true|false)$/u;

function requireSha(name, value) {
  if (!SHA_RE.test(String(value ?? ""))) throw new Error(`${name} must be an exact lowercase SHA`);
  return String(value);
}

function requireBoolean(name, value) {
  if (typeof value === "boolean") return value;
  if (!BOOLEAN_RE.test(String(value ?? ""))) throw new Error(`${name} must be boolean`);
  return String(value) === "true";
}

export function buildPromotionRehearsalReport({
  mainSha,
  productionSha,
  productionIsAncestorOfMain,
  protectedRefsStable = true,
  supportingGatesReadOnly = true,
}) {
  const releaseCutSha = requireSha("mainSha", mainSha);
  const pinnedProductionSha = requireSha("productionSha", productionSha);
  const productionContained = requireBoolean("productionIsAncestorOfMain", productionIsAncestorOfMain);
  const refsStable = requireBoolean("protectedRefsStable", protectedRefsStable);
  const gatesReadOnly = requireBoolean("supportingGatesReadOnly", supportingGatesReadOnly);
  const operation = buildStateEnvelope({
    releaseCutSha,
    productionSha: pinnedProductionSha,
    state: "CAS_LOCKED",
  });
  const surfaces = buildSurfaceNames({
    releaseBranchPrefix: "release/production-candidate",
    validationBranchPrefix: "gpt/validate-production-candidate",
    validationBaseBranchPrefix: "gpt/validate-production-base",
    releaseCutSha,
    productionSha: pinnedProductionSha,
  });

  let classification = "preflight_passed_no_mutation";
  let stage = "READY_FOR_CERTIFIED_CANDIDATE_REHEARSAL";
  let ok = true;
  if (!refsStable) {
    ok = false;
    stage = "BLOCKED_CAS_RECHECK_REQUIRED";
    classification = "protected_ref_moved_during_rehearsal";
  } else if (!productionContained) {
    ok = false;
    stage = "BLOCKED_PRODUCTION_HISTORY_NOT_CONTAINED_BY_MAIN";
    classification = "production_history_not_contained_by_main";
  } else if (!gatesReadOnly) {
    ok = false;
    stage = "BLOCKED_SUPPORTING_GATE_MUTATION_POLICY";
    classification = "supporting_gate_mutation_policy_not_read_only";
  }

  return {
    schema_version: "mad4b.production-promotion-rehearsal.v2",
    ok,
    mode: "read_only_dry_run",
    stage,
    classification,
    baseline: {
      main_sha: releaseCutSha,
      production_sha: pinnedProductionSha,
      production_is_ancestor_of_main: productionContained,
      protected_refs_stable: refsStable,
    },
    operation: {
      operation_id: operation.operation_id,
      idempotency_key: operation.idempotency_key,
      state: operation.state,
      surface_names: surfaces,
      retry_is_idempotent: true,
      cas_recheck_required_before_mutation: true,
    },
    fail_closed: {
      blocked_until_explicit_reauthorization: !ok,
      stale_authorization_reusable: false,
      required_next_action: ok
        ? "Run certified candidate validation only after an independent Owner Attestation and final CAS recheck."
        : classification === "production_history_not_contained_by_main"
          ? "Perform a separate governed ancestry reconciliation; do not relax the Production ancestry guard."
          : "Refresh protected refs and restart the same operation only after exact CAS readback succeeds.",
    },
    supporting_gates: {
      policy_expected_read_only: true,
      observed_read_only: gatesReadOnly,
    },
    mutation_summary: {
      production_merge: false,
      deployment: false,
      migration_apply: false,
      database_mutation: false,
      provider_mutation: false,
      external_write: false,
      secrets_included: false,
    },
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2).replaceAll("-", "_");
    args[key] = argv[index + 1];
    index += 1;
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input ? JSON.parse(fs.readFileSync(args.input, "utf8")) : args;
  const report = buildPromotionRehearsalReport(input);
  if (!args.output) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ output: args.output, ok: report.ok, classification: report.classification })}\n`);
  }
}
