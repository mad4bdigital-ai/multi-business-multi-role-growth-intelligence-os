import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const MANIFEST_RELATIVE_PATH = "autopilot-portable-staging/manifest.json";
const MANIFEST_PATH = path.join(REPO_ROOT, MANIFEST_RELATIVE_PATH);
const REQUIRED_PORTABLE_STAGING_FILES = [
  "autopilot-portable-staging/Invoke-Staging-One-Click.ps1",
  "autopilot-portable-staging/Invoke-Staging-One-Click-Core.ps1",
  "autopilot-portable-staging/Converge-StagingActivationGateway.ps1",
  "autopilot-portable-staging/activation-gateway-smart-convergence-policy.json",
  "autopilot-portable-staging/Staging-Environment.ps1",
  "autopilot-portable-staging/Staging-WindowsCloudflared.ps1",
  "autopilot-portable-staging/Staging-GitTransport.ps1",
  "autopilot-portable-staging/Staging-Operations-Log.ps1",
  "autopilot-portable-staging/Invoke-StagingCertification.ps1",
  "autopilot-portable-staging/Repair-LocalConnectorTunnel.ps1",
  "autopilot-portable-staging/Provision-LocalConnectorTunnelToken.ps1",
  "autopilot-portable-staging/Staging-Schema-Governance-Preflight.ps1",
  "autopilot-portable-staging/Clone-StagingDatabases.Legacy.ps1",
  "local-connector/install-service.ps1",
  "local-connector/connector-watchdog.ps1",
  "local-connector/server.mjs",
  "http-generic-api/docker-compose.staging.yml",
  "http-generic-api/docker-compose.staging.windows-service.yml",
  "http-generic-api/docker-compose.staging.docker-sidecar.yml",
  "http-generic-api/scripts/generate-portable-staging-manifest.mjs",
  "http-generic-api/scripts/provision-remote-mcp-client.mjs",
  "http-generic-api/scripts/staging-public-schema-readiness.mjs",
  "http-generic-api/scripts/staging-authenticated-remote-readiness.mjs",
  "http-generic-api/openapi/openapi.tenant-gpt.auth.staging.yaml",
  "http-generic-api/openapi/openapi.custom-gpt.auth-dispatcher.staging.yaml",
  "http-generic-api/openapi/openapi.remote-mcp.staging.yaml",
  "http-generic-api/openapi/openapi.tenant-gpt.activation.staging.yaml",
  "http-generic-api/openapi/openapi.custom-gpt.activation-admin.staging.yaml",
  "http-generic-api/scripts/prepare-staging-role-schema-replay.mjs",
  "http-generic-api/scripts/staging-sql-parser.mjs",
  "http-generic-api/config/staging-database-role-migration-manifest.json",
];
const check = process.argv.includes("--check");
const write = process.argv.includes("--write") || !check;
if (check && write) throw new Error("--check and --write are mutually exclusive");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertRelativeManifestPath(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("..")) {
    throw new Error(`portable staging manifest path must be repository-relative: ${relativePath}`);
  }
}

const originalText = fs.readFileSync(MANIFEST_PATH, "utf8");
const manifest = JSON.parse(originalText);
if (manifest.schema_version !== 1 || !Array.isArray(manifest.files)) {
  throw new Error("portable staging manifest schema is unsupported");
}

const seen = new Set();
const refreshedFiles = manifest.files.map((entry) => {
  const relativePath = String(entry.path || "").replaceAll("\\", "/");
  assertRelativeManifestPath(relativePath);
  if (seen.has(relativePath)) throw new Error(`duplicate portable staging manifest path: ${relativePath}`);
  seen.add(relativePath);
  const absolutePath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`portable staging manifest file is missing: ${relativePath}`);
  }
  return { ...entry, path: relativePath, sha256: sha256(absolutePath) };
});
for (const relativePath of REQUIRED_PORTABLE_STAGING_FILES) {
  assertRelativeManifestPath(relativePath);
  if (seen.has(relativePath)) continue;
  const absolutePath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`required portable staging manifest file is missing: ${relativePath}`);
  }
  refreshedFiles.push({ path: relativePath, sha256: sha256(absolutePath) });
  seen.add(relativePath);
}
const refreshed = {
  ...manifest,
  files: refreshedFiles,
};

const nextText = `${JSON.stringify(refreshed, null, 2)}\n`;
if (check) {
  if (nextText !== originalText) {
    const stale = refreshed.files
      .filter((entry, index) => entry.sha256 !== manifest.files[index]?.sha256)
      .map((entry) => entry.path);
    console.error(JSON.stringify({ ok: false, mode: "check", stale_files: stale, secrets_included: false }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, mode: "check", file_count: refreshed.files.length, secrets_included: false }, null, 2));
  }
} else if (write) {
  fs.writeFileSync(MANIFEST_PATH, nextText, "utf8");
  console.log(JSON.stringify({ ok: true, mode: "write", output: MANIFEST_RELATIVE_PATH, file_count: refreshed.files.length, secrets_included: false }, null, 2));
}
