#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import {
  defaultGoogleAuthPlatformTabs,
  GOOGLE_AUTH_PLATFORM_TABS,
  upsertGoogleAuthPlatformConfig,
} from "../googleAuthPlatformConfig.js";

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

const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"].filter((key) => !process.env[key]);
if (required.length) {
  console.error(`Missing required DB env vars: ${required.join(", ")}`);
  process.exit(1);
}

const baseArgs = {
  owner_type: argValue("owner-type") || "platform",
  tenant_id: argValue("tenant-id"),
  project_key: argValue("project-key") || "growth-intelligence-os",
  project_id: argValue("project-id"),
  project_display_name: argValue("project-display-name") || "Growth-Intelligence-OS",
  app_name: argValue("app-name") || "Growth Intelligence Platform",
  user_support_email: argValue("user-support-email") || "mad4b.digital@gmail.com",
  logo_ref: argValue("logo-ref") || "platform_brand_logo",
};

const defaults = defaultGoogleAuthPlatformTabs(baseArgs);
const results = [];
for (const tab of GOOGLE_AUTH_PLATFORM_TABS) {
  results.push(await upsertGoogleAuthPlatformConfig({
    ...baseArgs,
    tab,
    state: defaults[tab],
    note: "google_auth_platform_tab_seed",
  }));
}

console.log(JSON.stringify({
  ok: true,
  count: results.length,
  config_keys: results.map((result) => result.config_key),
}, null, 2));
await getPool().end();
