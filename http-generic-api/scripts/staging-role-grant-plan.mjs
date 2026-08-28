import { BOOTSTRAP_ROLE_GRANT_POLICIES } from "../databasePrivilegeContracts.js";

const args = process.argv.slice(2);
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? "" : String(args[index + 1] || "").trim();
};

const role = valueOf("--role");
const allowedRoles = new Set(["runtime", "governance", "runtime_persistence"]);
if (!allowedRoles.has(role)) {
  throw new Error("--role must be one of runtime, governance, runtime_persistence");
}

const spec = BOOTSTRAP_ROLE_GRANT_POLICIES[role];
if (!spec) throw new Error(`Missing repository-owned grant policy for role: ${role}`);

const requiredTables = Array.isArray(spec.required_tables) ? [...spec.required_tables] : [];
const sharedOperations = Array.isArray(spec.required_operations)
  ? [...new Set(spec.required_operations.map((operation) => String(operation).toUpperCase()))]
  : [];
const perTable = spec.required_operations_by_table && typeof spec.required_operations_by_table === "object"
  ? spec.required_operations_by_table
  : null;

const grants = requiredTables.map((table) => ({
  table,
  operations: perTable?.[table]
    ? [...new Set(perTable[table].map((operation) => String(operation).toUpperCase()))]
    : sharedOperations,
}));

if (!grants.length || grants.some((entry) => !entry.table || !entry.operations.length)) {
  throw new Error(`Repository-owned grant plan is incomplete for role: ${role}`);
}

const allowedPrivileges = new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]);
for (const entry of grants) {
  for (const operation of entry.operations) {
    if (!allowedPrivileges.has(operation)) {
      throw new Error(`Forbidden privilege in Staging grant plan: ${operation}`);
    }
  }
}

console.log(JSON.stringify({
  contract: "mad4b.staging-role-grant-plan.v1",
  role,
  grants,
  safety: {
    local_staging_only: true,
    production_accessed: false,
    provider_accessed: false,
    hostinger_mutation: false,
    cloudflare_mutation: false,
    grant_option_allowed: false,
    broad_schema_grants_allowed: false,
    secrets_included: false,
  },
}, null, 2));
