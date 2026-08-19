import fs from "node:fs";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

function requireSha(label, value) {
  if (!SHA_PATTERN.test(value ?? "")) {
    throw new Error(`${label} must be an exact lowercase 40-character SHA`);
  }
}

function requireBoolean(label, value) {
  if (value !== true && value !== false) {
    throw new Error(`${label} must be boolean`);
  }
}

export function buildReleaseCutReconciliationReport(input) {
  const {
    mainSha,
    productionSha,
    reconciliationSha,
    mainTreeSha,
    reconciliationTreeSha,
    parents,
    currentMainSha = mainSha,
    currentProductionSha = productionSha,
    mainParentIsAncestorOfCurrentMain = true,
    protectedRefsStable = true,
  } = input ?? {};

  requireSha("mainSha", mainSha);
  requireSha("productionSha", productionSha);
  requireSha("reconciliationSha", reconciliationSha);
  requireSha("mainTreeSha", mainTreeSha);
  requireSha("reconciliationTreeSha", reconciliationTreeSha);
  requireSha("currentMainSha", currentMainSha);
  requireSha("currentProductionSha", currentProductionSha);
  requireBoolean("mainParentIsAncestorOfCurrentMain", mainParentIsAncestorOfCurrentMain);
  requireBoolean("protectedRefsStable", protectedRefsStable);
  if (!Array.isArray(parents) || parents.length !== 2 || !parents.every((parent) => SHA_PATTERN.test(parent))) {
    throw new Error("parents must contain exactly two exact SHAs");
  }

  const firstParentExact = parents[0] === mainSha;
  const secondParentExact = parents[1] === productionSha;
  const treeExact = reconciliationTreeSha === mainTreeSha;
  const productionReadbackExact = currentProductionSha === productionSha;
  const ok = firstParentExact && secondParentExact && treeExact && mainParentIsAncestorOfCurrentMain && productionReadbackExact && protectedRefsStable;

  return {
    schema_version: "governed_production_release_cut_reconciliation.v1",
    ok,
    reconciliation_sha: reconciliationSha,
    main_sha: mainSha,
    production_sha: productionSha,
    current_main_sha: currentMainSha,
    current_production_sha: currentProductionSha,
    parents,
    first_parent_is_main: firstParentExact,
    second_parent_is_production: secondParentExact,
    main_tree_sha: mainTreeSha,
    reconciliation_tree_sha: reconciliationTreeSha,
    tree_matches_main: treeExact,
    main_parent_is_ancestor_of_current_main: mainParentIsAncestorOfCurrentMain,
    protected_refs_stable: protectedRefsStable,
    merge_method_required: "merge_commit_only",
    main_merge_required: true,
    production_merge: false,
    merge_executed: false,
    deployment_executed: false,
    migration_executed: false,
    grant_apply: false,
    provider_mutation: false,
    credential_payload_read: false,
    secrets_included: false,
    fail_closed: {
      stale_authorization_reusable: false,
      mutation_allowed: false,
      required_next_action: ok
        ? "Merge this reconciliation PR with a merge commit only, then issue a new exact-head Owner authorization before Production Promotion."
        : "Stop. Re-read main and Production, repair the exact topology on a new governed branch, and obtain new authorization.",
    },
  };
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inputPath = readArg("--input");
  const outputPath = readArg("--output");
  if (!inputPath || !outputPath) {
    throw new Error("usage: node production-release-cut-reconciliation.mjs --input <json> --output <json>");
  }
  const report = buildReleaseCutReconciliationReport(JSON.parse(fs.readFileSync(inputPath, "utf8")));
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
