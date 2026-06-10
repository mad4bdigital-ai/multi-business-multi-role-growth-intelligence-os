#!/usr/bin/env node
import { buildActivationAuthorizedAccess } from "../routes/activationRoutes.js";

function summarize(access = {}) {
  const registeredSurfaces = access.authorized?.registered_surfaces || [];
  const text = JSON.stringify(access);
  return {
    ok: access.readiness === "active" && registeredSurfaces.length > 0 && access.secrets_included === false,
    source: access.source,
    readiness: access.readiness,
    scope_resolution: access.scope_resolution,
    counts: access.counts || {},
    registered_surface_count: registeredSurfaces.length,
    registered_surface_keys: registeredSurfaces.map((surface) => surface.surface_key).filter(Boolean),
    auth_gaps: access.auth_gaps || [],
    degraded_surface_count: access.degraded_surfaces?.length || 0,
    policy: access.activation_policy || {},
    blocked_field_leak_detected: /(credential_ref|value_ciphertext|secret_value|token_value|password|private_key|config_json)/i.test(text),
    secrets_included: access.secrets_included === true,
  };
}

async function main() {
  const access = await buildActivationAuthorizedAccess({
    auth: { mode: "backend_api_key", is_admin: true, user_id: null, tenant_id: null },
    query: { authorized_access_limit: "10", authorized_surface_limit: "10" },
  });
  const summary = summarize(access);
  summary.ok = summary.ok && summary.blocked_field_leak_detected === false && summary.policy?.do_not_return_secret_values === true;
  console.log(JSON.stringify({ ...summary, external_provider_called: false, session_opened: false }, null, 2));
  process.exit(summary.ok ? 0 : 2);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: { code: error.code || "activation_authorized_access_smoke_failed", message: error.message }, secrets_included: false }, null, 2));
  process.exit(1);
});
