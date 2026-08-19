#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import {
  provisionRemoteMcpOAuthClient,
  readRemoteMcpOAuthClientProvisioningStatus,
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

const environment = String(argValue("environment") || process.env.REMOTE_MCP_ENVIRONMENT || "").trim().toLowerCase();
if (!environment || !["staging", "production"].includes(environment)) {
  console.error("Usage requires --environment=staging|production.");
  process.exit(1);
}

const envFile = argValue("env-file") || (environment === "staging" ? resolve(apiRoot, ".env.staging") : resolve(apiRoot, ".env"));
loadEnvFile(envFile);
process.env.REMOTE_MCP_ENVIRONMENT = environment;

const pool = getPool();
try {
  if (process.argv.includes("--status")) {
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
        client_id: argValue("client-id"),
        client_name: argValue("client-name"),
        client_secret: process.env.REMOTE_MCP_OAUTH_CLIENT_SECRET || "",
        redirect_uris: argValues("redirect-uri"),
        scopes: argValues("scope"),
        token_endpoint_auth_method: argValue("token-endpoint-auth-method") || "client_secret_basic",
        rotate: process.argv.includes("--rotate"),
        note: argValue("note") || `remote_mcp_oauth_client_${environment}_operator`,
      });
      console.log(JSON.stringify(result, null, 2));
      console.error("Store client_secret in the approved client configuration now. It is returned once and is never included in status/readback.");
    }
  }
} finally {
  await pool.end();
}
