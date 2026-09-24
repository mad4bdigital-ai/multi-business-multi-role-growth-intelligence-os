import { fileURLToPath } from "node:url";
import path from "node:path";

const EXPECTED_ROLES = ["governance", "runtime", "runtime_persistence"];

export function classifyStagingEmptyRoleCensus(rows) {
  if (!Array.isArray(rows) || rows.length !== EXPECTED_ROLES.length) throw new Error("exactly three role censuses are required");
  const sorted = [...rows].sort((a, b) => String(a?.role).localeCompare(String(b?.role), "en"));
  if (sorted.map((row) => row?.role).join(",") !== EXPECTED_ROLES.join(",")) throw new Error("role census identity is missing, duplicated, or unexpected");
  if (sorted.some((row) => !Number.isSafeInteger(row.object_count) || row.object_count < 0)) throw new Error("role object count is invalid");
  const selectedZeroObjectRoles = sorted.filter((row) => row.object_count === 0).map((row) => row.role);
  const preservedNonemptyRoles = sorted.filter((row) => row.object_count > 0).map((row) => row.role);
  const candidateForGovernedRebuild = selectedZeroObjectRoles.length > 0;
  return {
    contract: "mad4b.staging.empty-role-database-census.v2",
    ready_for_rebuild_empty: candidateForGovernedRebuild,
    candidate_for_governed_rebuild_empty: candidateForGovernedRebuild,
    ready_for_local_mutation: false,
    selected_zero_object_roles: selectedZeroObjectRoles,
    preserved_nonempty_roles: preservedNonemptyRoles,
    role_selection_authoritative: false,
    mutation_requires_durable_inspection_proof: true,
    roles: sorted.map(({ role, object_count }) => ({ role, object_count,
      classification: object_count === 0 ? "rebuild_empty_candidate" : "preserve_nonempty" })),
    next_authority: candidateForGovernedRebuild ? "staging_durable_full_inspection" : null,
    production_accessed: false, provider_accessed: false, database_mutation: false, secrets_included: false,
  };
}

function parseCliCensus(flag, value) {
  if (flag === "--census-json") return JSON.parse(String(value ?? ""));
  if (flag !== "--census-json-base64") throw new Error("expected --census-json or --census-json-base64 argument");
  const encoded = String(value ?? "").trim();
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new Error("invalid --census-json-base64 payload");
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const canonical = Buffer.from(decoded, "utf8").toString("base64");
  if (canonical.replace(/=+$/u, "") !== encoded.replace(/=+$/u, "")) throw new Error("non-canonical --census-json-base64 payload");
  return JSON.parse(decoded);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    if (process.argv.length !== 4) throw new Error("expected one census payload argument");
    const result = classifyStagingEmptyRoleCensus(parseCliCensus(process.argv[2], process.argv[3]));
    console.log(JSON.stringify(result));
    if (!result.candidate_for_governed_rebuild_empty) process.exitCode = 2;
  } catch (error) { console.error(`STAGING_EMPTY_CENSUS_BLOCKED: ${error.message}`); process.exitCode = 1; }
}
