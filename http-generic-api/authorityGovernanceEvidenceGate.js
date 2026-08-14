import crypto from "node:crypto";

export const AUTHORITY_GOVERNANCE_EVIDENCE_GATE_CONTRACT = "mad4b.ueacp.authority-governance-evidence-gate.v1";

function text(value) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function hasForbiddenSideEffects(value) {
  return value?.provider_calls === true
    || value?.credential_payload_read === true
    || value?.external_writes === true
    || value?.secrets_included === true
    || value?.database_mutated === true
    || value?.migration_applied === true;
}

export function evaluateAuthorityGovernanceEvidence({
  path_inventory = null,
  catalog_census = null,
  expected_source_keys = [],
  observed_at = "",
} = {}) {
  const blockers = [];
  const inventory = path_inventory && typeof path_inventory === "object" ? path_inventory : null;
  const census = catalog_census && typeof catalog_census === "object" ? catalog_census : null;

  if (!inventory) blockers.push("T001_PATH_INVENTORY_MISSING");
  if (!census) blockers.push("T002_CATALOG_CENSUS_MISSING");
  if (inventory && inventory.contract !== "mad4b.ueacp.authority-path-inventory.v1") blockers.push("T001_CONTRACT_MISMATCH");
  if (census && census.mode !== "read_only_authority_catalog_census") blockers.push("T002_MODE_NOT_READ_ONLY");
  if (inventory && inventory.status !== "ready_for_human_closure_review") blockers.push("T001_MACHINE_INVENTORY_INCOMPLETE");
  if (census && census.ok !== true) blockers.push("T002_CENSUS_NOT_OK");
  if (inventory?.closure_state?.t001_complete === true) blockers.push("T001_CLAIMED_COMPLETE_WITHOUT_HUMAN_REVIEW");
  if (census?.closure_state?.t002_complete === true) blockers.push("T002_CLAIMED_COMPLETE_WITHOUT_GOVERNED_READBACK");
  if (inventory && expected_source_keys.length > 0) {
    const observed = new Set(Array.isArray(inventory.sources) ? inventory.sources.map((source) => source.source_key) : []);
    for (const sourceKey of expected_source_keys) if (!observed.has(sourceKey)) blockers.push(`T001_EXPECTED_SOURCE_MISSING:${text(sourceKey)}`);
  }
  if (hasForbiddenSideEffects(inventory)) blockers.push("T001_FORBIDDEN_SIDE_EFFECT_OBSERVED");
  if (hasForbiddenSideEffects(census)) blockers.push("T002_FORBIDDEN_SIDE_EFFECT_OBSERVED");
  if (!text(observed_at)) blockers.push("AUTHORITY_EVIDENCE_OBSERVED_AT_REQUIRED");

  const evidence = {
    contract: AUTHORITY_GOVERNANCE_EVIDENCE_GATE_CONTRACT,
    observed_at: text(observed_at),
    inventory_contract: text(inventory?.contract),
    census_mode: text(census?.mode),
    inventory_sha256: text(inventory?.inventory_sha256),
    census_schema_name: text(census?.schema_name),
    inventory_source_count: Number(inventory?.summary?.source_count || 0),
    inventory_path_count: Number(inventory?.summary?.canonical_path_count || 0),
    census_object_count: Number(census?.summary?.object_count || 0),
    census_revision_gap_count: Number(census?.summary?.absent_revision_table_count || 0),
    blockers: [...new Set(blockers)].sort(),
  };
  evidence.evidence_sha256 = sha256(JSON.stringify(evidence));

  return Object.freeze({
    ...evidence,
    status: blockers.length === 0 ? "ready_for_human_and_live_readback_review" : "blocked",
    t001_machine_ready: blockers.length === 0,
    t001_complete: false,
    t002_machine_ready: blockers.length === 0,
    t002_complete: false,
    human_review_required: true,
    live_catalog_readback_required: true,
    migration_authorized: false,
    runtime_enforcement_enabled: false,
    provider_calls: false,
    external_writes: false,
    database_mutated: false,
    secrets_included: false,
  });
}
