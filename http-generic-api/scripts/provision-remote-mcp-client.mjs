#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import { listRemoteMcpClientProfiles } from "../remoteMcpClientProfileRegistry.js";
import {
  provisionRemoteMcpOAuthClient,
  readRemoteMcpOAuthClientProvisioningStatus,
  listRemoteMcpOAuthClientProvisioningStatus,
} from "../remoteMcpOAuthClientProvisioning.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, "..");

function argValue(name) {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function argValues(name) {
  const prefix = `--${name}=`;
  const values = process.argv
    .filter((arg) => arg.startsWith(prefix))
    .map((arg) => arg.slice(prefix.length));
  process.argv.forEach((arg, index) => {
    if (arg === `--${name}` && process.argv[index + 1]) values.push(process.argv[index + 1]);
  });
  return values;
}

function loadEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equal = trimmed.indexOf("=");
      if (equal < 1) continue;
      const key = trimmed.slice(0, equal).trim();
      const value = trimmed.slice(equal + 1).trim().replace(/^(["'])(.*)\1$/u, "$2");
      if (key && !process.env[key]) process.env[key] = value;
    }
  } catch {
    // Runtime deployments provide DB settings directly.
  }
}

function secretFreeProvisioningOutput(result) {
  if (!result || typeof result !== "object") return result;
  return {
    ...result,
    client_secret: result.client_secret ? "[REDACTED]" : null,
    secret_available_from_canonical_env: Boolean(process.env.REMOTE_MCP_APP_SECRET),
    secrets_included: false,
  };
}

const listProfiles = process.argv.includes("--list-profiles");
if (listProfiles) {
  console.log(JSON.stringify(listRemoteMcpClientProfiles(), null, 2));
  process.exit(0);
}

const environment = String(argValue("environment") || process.env.REMOTE_MCP_ENVIRONMENT || "").trim().toLowerCase();
if (!environment || !["staging", "production"].includes(environment)) {
  console.error("Usage requires --environment=staging|production.");
  process.exit(1);
}

const envFile = argValue("env-file") || (environment === "staging" ? resolve(apiRoot, ".env.staging") : resolve(apiRoot, ".env"));
loadEnvFile(envFile);
process.env.REMOTE_MCP_ENVIRONMENT = environment;
const profileKey = argValue("profile") || process.env.REMOTE_MCP_CLIENT_PROFILE_KEY || "generic_remote_mcp_client";
process.env.REMOTE_MCP_CLIENT_PROFILE_KEY = profileKey;

for (const key of ["REMOTE_MCP_ACCESS_TOKEN", "REMOTE_MCP_REFRESH_TOKEN", "REMOTE_MCP_AUTHORIZATION_CODE"]) {
  if (String(process.env[key] || "").trim()) {
    console.error(`${key} must not be sourced from an environment file; Remote MCP user tokens are runtime-minted by OAuth.`);
    process.exit(1);
  }
}

const canonicalAppId = String(process.env.REMOTE_MCP_APP_ID || "").trim();
const canonicalAppSecret = String(process.env.REMOTE_MCP_APP_SECRET || process.env.REMOTE_MCP_OAUTH_CLIENT_SECRET || "").trim();
if (environment === "production" && (process.env.REMOTE_MCP_APP_ID || process.env.REMOTE_MCP_APP_SECRET)) {
  console.error("Production provisioning must not consume Staging canonical REMOTE_MCP_APP_ID/REMOTE_MCP_APP_SECRET variables.");
  process.exit(1);
}

// When the canonical Staging App Secret is already present, echoing it back is
// unnecessary and unsafe. Explicit redaction remains available for legacy callers.
const redactSecretOutput = process.argv.includes("--redact-secret-output") || Boolean(process.env.REMOTE_MCP_APP_SECRET);
const pool = getPool();
try {
  if (process.argv.includes("--all-status")) {
    const result = await listRemoteMcpOAuthClientProvisioningStatus({ env: process.env, pool });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } else if (process.argv.includes("--status")) {
    const result = await readRemoteMcpOAuthClientProvisioningStatus({ env: process.env, pool });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } else {
    const expectedConfirmation = `PROVISION_REMOTE_MCP_${environment.toUpperCase()}`;
    if (argValue("confirm") !== expectedConfirmation) {
      console.error(`Refusing mutation. Re-run with --confirm=${expectedConfirmation} after verifying the selected database and environment.`);
      process.exitCode = 1;
    } else {
      const result = await provisionRemoteMcpOAuthClient({
        env: process.env,
        pool,
        environment,
        profile_key: profileKey,
        client_id: argValue("client-id") || canonicalAppId,
        client_name: argValue("client-name"),
        client_secret: canonicalAppSecret,
        redirect_uris: argValues("redirect-uri"),
        scopes: argValues("scope"),
        token_endpoint_auth_method: argValue("token-endpoint-auth-method") || "client_secret_basic",
        rotate: process.argv.includes("--rotate"),
        note: argValue("note") || `remote_mcp_oauth_client_${environment}_${profileKey}_operator`,
      });
      console.log(JSON.stringify(redactSecretOutput ? secretFreeProvisioningOutput(result) : result, null, 2));
      console.error(redactSecretOutput
        ? "Client secret output was redacted; the canonical Staging secret remains only in ignored .env.staging and encrypted platform_secrets after provisioning. Access/refresh tokens remain OAuth-runtime only."
        : "Store client_secret only in the approved client configuration. Access/refresh tokens are minted by OAuth and must not be persisted in .env files.");
    }
  }
} finally {
  await pool.end();
}
