#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import { upsertPlatformCredentialClientConfig } from "../platformCredentialClientsConfig.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, "..");

try {
  const env = readFileSync(resolve(apiRoot, ".env"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch {
  // Runtime environments can provide DB env vars directly.
}

function argValue(name) {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
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

function parseJsonArg(name, fallback = {}) {
  const raw = argValue(name);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Invalid JSON for --${name}: ${err.message}`);
    process.exit(1);
  }
}

const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"].filter((key) => !process.env[key]);
if (required.length) {
  console.error(`Missing required DB env vars: ${required.join(", ")}`);
  process.exit(1);
}

const result = await upsertPlatformCredentialClientConfig({
  owner_type: argValue("owner-type") || "platform",
  tenant_id: argValue("tenant-id"),
  channel_key: argValue("channel-key") || "custom_gpt",
  credential_type: argValue("credential-type") || "oauth_client",
  client_key: argValue("client-key"),
  display_name: argValue("display-name"),
  provider: argValue("provider") || "google",
  project_id: argValue("project-id"),
  status: argValue("status") || "active",
  client_id: argValue("client-id"),
  client_secret_ref: argValue("client-secret-ref"),
  redirect_uris: argValues("redirect-uri"),
  scopes: argValues("scope"),
  token_exchange_method: argValue("token-exchange-method") || "default_post_request",
  key_secret_ref: argValue("key-secret-ref"),
  allowed_apis: argValues("allowed-api"),
  restrictions: parseJsonArg("restrictions", {}),
  service_account_email: argValue("service-account-email"),
  roles: argValues("role"),
  note: argValue("note") || "platform_credential_client_script",
});

console.log(JSON.stringify(result, null, 2));
await getPool().end();
