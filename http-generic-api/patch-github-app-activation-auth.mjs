/**
 * patch-github-app-activation-auth.mjs
 *
 * Wires activation GitHub validation to GitHub App installation auth.
 *
 * Sets on the `actions` row where action_key = 'github_api_mcp':
 *   api_key_mode         = github_app
 *   api_key_storage_mode = secret_reference
 *   secret_store_ref     = ref:secret:GITHUB_APP_PRIVATE_KEY
 *   api_key_value        = NULL
 *
 * GITHUB_APP_ID and GITHUB_APP_INSTALLATION_ID are read from runtime env vars.
 *
 * Run: node http-generic-api/patch-github-app-activation-auth.mjs          (dry-run)
 * Run: node http-generic-api/patch-github-app-activation-auth.mjs --apply  (execute)
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getPool } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch {
  // .env is optional for Cloud Run/runtime DB patching.
}

const APPLY = process.argv.includes("--apply");
const pool = getPool();

function maskPresence(key) {
  return process.env[key] ? "[OK] set" : "[MISS] not set";
}

console.log(`\n=== GitHub App Activation Auth Patcher - ${APPLY ? "APPLY" : "DRY RUN"} ===\n`);
console.log("Runtime env readiness:");
console.log(`  GITHUB_APP_INSTALLATION_ID: ${maskPresence("GITHUB_APP_INSTALLATION_ID")}`);
console.log(`  GITHUB_APP_ID:              ${maskPresence("GITHUB_APP_ID")}`);
console.log(`  GITHUB_APP_PRIVATE_KEY:     ${maskPresence("GITHUB_APP_PRIVATE_KEY")}`);
console.log(`  GITHUB_APP_PRIVATE_KEY_B64: ${maskPresence("GITHUB_APP_PRIVATE_KEY_B64")} (legacy fallback)`);
console.log(`  GITHUB_TOKEN:               ${maskPresence("GITHUB_TOKEN")} (not used for github_app mode)`);

const [rows] = await pool.query(
  `SELECT id, action_key, runtime_callable, api_key_mode, api_key_storage_mode,
          secret_store_ref, api_key_value
   FROM \`actions\`
   WHERE action_key = 'github_api_mcp'
   LIMIT 1`
);

if (!rows.length) {
  console.error("\nERROR: No action found with action_key = 'github_api_mcp'.");
  await pool.end();
  process.exit(1);
}

const row = rows[0];
console.log("\nCurrent action row:");
console.log(`  id:                   ${row.id}`);
console.log(`  runtime_callable:     ${row.runtime_callable}`);
console.log(`  api_key_mode:         ${row.api_key_mode}`);
console.log(`  api_key_storage_mode: ${row.api_key_storage_mode}`);
console.log(`  secret_store_ref:     ${row.secret_store_ref}`);
console.log(`  api_key_value:        ${row.api_key_value ? "[PRESENT - will be NULLed]" : "NULL"}`);

const target = {
  api_key_mode: "github_app",
  api_key_storage_mode: "secret_reference",
  secret_store_ref: "ref:secret:GITHUB_APP_PRIVATE_KEY",
  api_key_value: null,
};

const changes = Object.entries(target)
  .filter(([key, value]) => String(row[key] ?? "") !== String(value ?? ""))
  .map(([key, value]) => `${key}: ${JSON.stringify(row[key] ?? null)} -> ${JSON.stringify(value)}`);

console.log("\nPatch: actions.github_api_mcp");
if (!changes.length) {
  console.log("  [SKIP] action row already uses GitHub App auth.");
} else {
  for (const change of changes) {
    console.log(`  ${APPLY ? "[APPLY]" : "[DRY]  "} ${change}`);
  }

  if (APPLY) {
    await pool.query(
      `UPDATE \`actions\`
       SET api_key_mode = 'github_app',
           api_key_storage_mode = 'secret_reference',
           secret_store_ref = 'ref:secret:GITHUB_APP_PRIVATE_KEY',
           api_key_value = NULL
       WHERE id = ?`,
      [row.id]
    );
    console.log("  [DONE] action row patched.");
  }
}

const [afterRows] = await pool.query(
  `SELECT id, action_key, api_key_mode, api_key_storage_mode, secret_store_ref, api_key_value
   FROM \`actions\`
   WHERE action_key = 'github_api_mcp'
   LIMIT 1`
);

console.log("\nResolved action row:");
const after = afterRows[0] || {};
console.log(`  api_key_mode:         ${after.api_key_mode}`);
console.log(`  api_key_storage_mode: ${after.api_key_storage_mode}`);
console.log(`  secret_store_ref:     ${after.secret_store_ref}`);
console.log(`  api_key_value:        ${after.api_key_value ? "[PRESENT]" : "NULL"}`);

console.log(`\n${"-".repeat(55)}`);
if (APPLY) {
  console.log("Patch applied. Restart/redeploy the API with GitHub App env vars set before activation validation.");
} else {
  console.log("Dry-run complete. Re-run with --apply to execute.");
}

await pool.end();
