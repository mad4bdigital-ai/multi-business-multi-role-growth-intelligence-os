import fs from "node:fs";
import zlib from "node:zlib";
import { validateSchemaBundleManifest, sha256Hex } from "./runtimeBootstrapContract.js";
import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";
import { buildRoleBundleBinding } from "./recoveryExecutionBinding.js";

const ROLE_KEYS = new Set(["runtime", "governance", "runtime_persistence"]);
const SHA40 = /^[0-9a-f]{40}$/u;

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, status: 409, details: { ...details, secrets_included: false } });
}

export function computeStagingRoleBundleBindings({ manifestPath, expectedSha, roles, contract } = {}) {
  const sha = String(expectedSha || "").trim().toLowerCase();
  const selected = Array.isArray(roles) ? [...new Set(roles.map((role) => String(role).trim()))] : [];
  if (!SHA40.test(sha)) fail("STAGING_ROLE_BUNDLE_SHA_INVALID", "Exact source SHA is required for role-bundle binding.");
  if (!manifestPath || !fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) fail("STAGING_ROLE_BUNDLE_MANIFEST_MISSING", "Generated schema-bundle manifest is missing.");
  if (!selected.length || selected.some((role) => !ROLE_KEYS.has(role))) fail("STAGING_ROLE_BUNDLE_ROLE_INVALID", "Role-bundle binding requires a non-empty registered role set.");
  return Object.fromEntries(selected.map((role) => {
    const bundle = validateSchemaBundleManifest(manifestPath, sha, contract, role);
    const sql = zlib.gunzipSync(fs.readFileSync(bundle.bundlePath)).toString("utf8");
    const statements = splitMigrationSqlStatements(sql).map((statement) => String(statement).trim()).filter(Boolean);
    if (!statements.length) fail("STAGING_ROLE_BUNDLE_EMPTY", "Generated role schema bundle contains no statements.", { role });
    const binding = buildRoleBundleBinding({
      role,
      bundleManifestSha256: bundle.manifest_sha256,
      roleBundleSha256: String(bundle.role.sha256 || "").trim().toLowerCase(),
      statementCount: statements.length,
      statementFingerprints: statements.map((statement) => sha256Hex(statement)),
    });
    return [role, binding];
  }));
}
