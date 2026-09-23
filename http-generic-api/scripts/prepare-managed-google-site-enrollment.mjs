#!/usr/bin/env node
import process from "node:process";
import {
  planManagedGoogleSiteEnrollment,
  materializeManagedGoogleSiteEnrollment,
} from "../managedGoogleOAuthEnrollment.js";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const siteUuid = arg("site-uuid", process.env.MAD4B_SITE_UUID || "");
const origin = arg("origin", process.env.MAD4B_SITE_ORIGIN || "");
const keyId = arg("key-id", process.env.MAD4B_GOOGLE_MANAGED_OAUTH_SITE_KEY_ID || "");
const environment = arg("environment", process.env.MAD4B_SITE_ENVIRONMENT || "staging");
const apply = flag("apply");
const allowNewRegistry = flag("allow-new-registry");
const outputDir = arg("output-dir", "");

if (!siteUuid || !origin || !keyId) {
  console.error("Required: --site-uuid <uuid> --origin <https-origin> --key-id <key-id>.");
  process.exit(2);
}
if (environment === "production" && !flag("allow-production")) {
  console.error("Production enrollment requires explicit --allow-production.");
  process.exit(2);
}

const plan = planManagedGoogleSiteEnrollment({
  env: process.env,
  siteUuid,
  origin,
  keyId,
  environment,
  allowNewRegistry,
});

if (!apply) {
  console.log(JSON.stringify({
    contract: plan.contract,
    mode: "dry_run",
    site_binding: plan.site_binding,
    broker_origin: plan.broker_origin,
    existing_binding_exact: plan.existing_binding_exact,
    existing_secret_present: plan.existing_secret_present,
    new_registry_requested: allowNewRegistry,
    network_request_performed: false,
    mutation_performed: false,
    secret_value_included: false,
    next_action: "Re-run with --apply --output-dir <absolute-path-outside-repository> after reviewing this exact binding.",
  }, null, 2));
  process.exit(0);
}

if (!outputDir) {
  console.error("--output-dir is required with --apply.");
  process.exit(2);
}

const result = materializeManagedGoogleSiteEnrollment(plan, { outputDir });
console.log(JSON.stringify({
  ...result,
  mode: "materialized_private_fragments",
  network_request_performed: false,
  server_environment_mutation_performed: false,
  secret_value_included: false,
  next_action: "Apply the broker and WordPress fragments through the governed secret/config deployment paths, then delete the local fragments after readback.",
}, null, 2));
