#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installStagingActivationTrust } from "../stagingActivationTrustInstaller.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

try {
  const expectedSha = String(argValue("expected-sha") || "").trim().toLowerCase();
  const envFile = path.resolve(argValue("env-file") || path.join(apiRoot, ".env.staging"));
  const mode = String(argValue("mode") || "dry_run").trim().toLowerCase();
  const result = await installStagingActivationTrust({ expectedSha, envFile, mode });
  console.log(JSON.stringify(result));
  if (result.ready !== true) process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({
    contract: "mad4b.staging.activation-recovery-trust-install.v1",
    status: "blocked",
    error: {
      code: error?.code || "staging_activation_trust_install_failed",
      message: String(error?.message || "failed"),
      details: error?.details || {},
    },
    provider_mutation: false,
    cloudflare_mutation: false,
    workflow_dispatch: false,
    production_mutation: false,
    database_mutation: false,
    secrets_included: false,
  }));
  process.exitCode = 1;
}
