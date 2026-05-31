import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SEEDED_BROWSER_RUNTIMES,
  assertNoSecretLike,
  checkBrowserRuntimePolicy,
  normalizeBrowserRuntime,
  normalizeBrowserRuntimeBinding,
  parseBrowserUrl,
  createManagedVisualTakeoverSession,
  closeBrowserRuntimeSession,
  getBrowserRuntimeSession,
} from "./browserRuntimeGovernance.js";

const nativeEssam = SEEDED_BROWSER_RUNTIMES.find((runtime) => runtime.runtime_key === "native_essam_edge_connector_v1");
assert(nativeEssam, "current Essam browser connector must be seeded");
assert.equal(nativeEssam.status, "active_open_url_degraded_visual_capture");
assert(nativeEssam.degraded_capabilities.includes("visual_screenshot"));
assert(nativeEssam.degraded_capabilities.includes("remote_human_takeover"));

const runtime = normalizeBrowserRuntime(nativeEssam);
assert.equal(runtime.secrets_included, false);
assert.equal(runtime.metadata.browser_alias, "edge");

const binding = normalizeBrowserRuntimeBinding({
  binding_key: "browser4_inspect_essam",
  runtime_key: "browser4_essam_v1",
  use_case: "site_diagnostics",
  allowed_actions_json: JSON.stringify(["inspect_site"]),
  domain_allowlist_json: JSON.stringify(["mad4b.com"]),
  policy_json: JSON.stringify({
    domain_allowlist_required: true,
    audit_required: true,
    no_destructive_actions: true,
    no_form_submit: true,
    redact_cookies: true,
    redact_tokens: true,
  }),
  status: "planned",
});

{
  const parsed = parseBrowserUrl("https://n8n.mad4b.com/");
  assert.equal(parsed.host, "n8n.mad4b.com");
  assert.throws(() => parseBrowserUrl("file:///tmp/secret"), /http or https/);
}

{
  const allowed = checkBrowserRuntimePolicy({
    runtime,
    binding,
    input: { url: "https://n8n.mad4b.com/", action: "inspect_site" },
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.policy_result, "allowed");
  assert.equal(allowed.secrets_included, false);
  assert.equal(allowed.controls.audit_required, true);
}

{
  const blocked = checkBrowserRuntimePolicy({
    runtime,
    binding,
    input: { url: "https://evil.example.net/", action: "inspect_site" },
  });
  assert.equal(blocked.ok, false);
  assert(blocked.reasons.includes("domain_not_allowlisted"));
}

{
  const blocked = checkBrowserRuntimePolicy({
    runtime,
    binding,
    input: { url: "https://n8n.mad4b.com/", action: "delete" },
  });
  assert.equal(blocked.ok, false);
  assert(blocked.reasons.includes("destructive_action_blocked"));
}

{
  const blocked = checkBrowserRuntimePolicy({
    runtime,
    binding: normalizeBrowserRuntimeBinding({
      ...binding,
      allowed_actions_json: JSON.stringify(["click_selector"]),
    }),
    input: { url: "https://n8n.mad4b.com/", action: "click_selector" },
  });
  assert.equal(blocked.ok, false);
  assert(blocked.reasons.includes("high_risk_action_requires_explicit_approval"));

  const approved = checkBrowserRuntimePolicy({
    runtime,
    binding: normalizeBrowserRuntimeBinding({
      ...binding,
      allowed_actions_json: JSON.stringify(["click_selector"]),
    }),
    input: { url: "https://n8n.mad4b.com/", action: "click_selector", explicit_approval: true },
  });
  assert.equal(approved.ok, true);
}

{
  assert.throws(
    () => assertNoSecretLike({ Authorization: "Bearer abc.def.ghi" }),
    /Secret-like field/,
  );
  assert.throws(
    () => checkBrowserRuntimePolicy({
      runtime,
      binding,
      input: { url: "https://n8n.mad4b.com/?access_token=abc123", action: "inspect_site" },
    }),
    /Secret-like value/,
  );
}

{
  assert.equal(typeof createManagedVisualTakeoverSession, "function", "managed visual takeover session helper must be exported");
  assert.equal(typeof getBrowserRuntimeSession, "function", "browser runtime session get helper must be exported");
  assert.equal(typeof closeBrowserRuntimeSession, "function", "browser runtime session close helper must be exported");
}

{
  const routes = readFileSync("routes/browserRuntimeRoutes.js", "utf8");
  assert(routes.includes("/browser-runtime/runtimes"), "browser runtime list route must be mounted");
  assert(routes.includes("/browser-runtime/policy-check"), "policy check route must exist");
  assert(routes.includes("/browser-runtime/extract-data"), "extract data route must exist");
  assert(routes.includes("/browser-runtime/inspect-site"), "inspect site route must exist");
  assert(routes.includes("/browser-runtime/visual-takeover/sessions"), "managed visual takeover session create route must exist");
  assert(routes.includes("/browser-runtime/visual-takeover/sessions/:session_id"), "managed visual takeover session read route must exist");
  assert(routes.includes("/browser-runtime/visual-takeover/sessions/:session_id/close"), "managed visual takeover session close route must exist");
  assert(routes.includes("raw_novnc_public_exposure_forbidden"), "managed session route must forbid raw noVNC exposure");
  assert(routes.includes("requireAdminPrincipal"), "browser runtime routes must be admin protected");
}

{
  const index = readFileSync("routes/index.js", "utf8");
  assert(index.includes("buildBrowserRuntimeRoutes"), "browser runtime routes must be registered");
}

{
  const migration = readFileSync("migrations/130_sprint65_browser_runtime_governance.sql", "utf8");
  const managedSessionToolsMigration = readFileSync("migrations/174_sprint65_auto_browser_managed_session_tools.sql", "utf8");
  for (const tableName of [
    "browser_runtime_registry",
    "browser_runtime_bindings",
    "browser_runtime_events",
    "browser_runtime_artifacts",
    "browser_data_extraction_jobs",
    "browser_site_inspection_runs",
  ]) {
    assert(migration.includes(tableName), `${tableName} migration must exist`);
  }
  for (const toolKey of [
    "browser_runtime_list",
    "browser_runtime_get",
    "browser_runtime_health",
    "browser_runtime_binding_upsert",
    "browser_runtime_policy_check",
    "browser_runtime_extract_data",
    "browser_runtime_inspect_site",
  ]) {
    assert(migration.includes(toolKey), `${toolKey} must be registered`);
  }
  assert(migration.includes("active_open_url_degraded_visual_capture"), "Essam degraded visual capture status must be seeded");
  for (const toolKey of [
    "browser_runtime_visual_takeover_session_create",
    "browser_runtime_visual_takeover_session_get",
    "browser_runtime_visual_takeover_session_close",
  ]) {
    assert(managedSessionToolsMigration.includes(toolKey), `${toolKey} must be registered`);
  }
  assert(managedSessionToolsMigration.includes("raw noVNC exposure is forbidden"), "managed session tools must forbid raw noVNC exposure");
  assert(managedSessionToolsMigration.includes("auto_browser_managed_visual_takeover_v1"), "managed session create tool must default to managed binding");
}

console.log("browser runtime governance tests passed");
