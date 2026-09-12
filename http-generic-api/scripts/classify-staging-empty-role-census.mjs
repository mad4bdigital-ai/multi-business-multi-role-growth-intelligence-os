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
  return {
    contract: "mad4b.staging.empty-role-database-census.v1",
    ready_for_rebuild_empty: preservedNonemptyRoles.length === 0,
    selected_zero_object_roles: selectedZeroObjectRoles,
    preserved_nonempty_roles: preservedNonemptyRoles,
    role_selection_authoritative: false,
    mutation_requires_durable_inspection_proof: true,
    roles: sorted.map(({ role, object_count }) => ({ role, object_count,
      classification: object_count === 0 ? "rebuild_empty" : "non_empty_requires_separate_diagnosis" })),
    production_accessed: false, provider_accessed: false, database_mutation: false, secrets_included: false,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--census-json") throw new Error("expected --census-json argument");
    const result = classifyStagingEmptyRoleCensus(JSON.parse(process.argv[3]));
    console.log(JSON.stringify(result));
    if (!result.ready_for_rebuild_empty) process.exitCode = 2;
  } catch (error) { console.error(`STAGING_EMPTY_CENSUS_BLOCKED: ${error.message}`); process.exitCode = 1; }
}
