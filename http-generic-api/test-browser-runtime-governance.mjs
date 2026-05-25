import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SEEDED_BROWSER_RUNTIMES,
  assertNoSecretLike,
  checkBrowserRuntimePolicy,
  normalizeBrowserRuntime,
  normalizeBrowserRuntimeBinding,
  parseBrowserUrl,
} from "./browserRuntimeGovernance.js";

const essamRuntime = normalizeBrowserRuntime(SEEDED_BROWSER_RUNTIMES[0]);
assert.equal(essamRuntime.runtime_key, "native_essam_edge_connector_v1");
assert.equal(essamRuntime.status, "active_open_url_degraded_visual_capture");
assert(essamRuntime.capabilities.includes("open_url"));
assert(essamRuntime.degraded_capabilities.includes("visual_screenshot"));
assert(essamRuntime.metadata.do_not_use_for.includes("primary_data_extraction"));
assert.equal(essamRuntime.secrets_included, false);

const extractionBinding = normalizeBrowserRuntimeBinding({
  binding_key: "browser4_extraction_essam",
  runtime_key: "browser4_essam_v1",
  use_case: "structured_local_extraction",
  allowed_actions: ["extract_data", "inspect_site"],
  domain_allowlist: ["mad4b.com"],
  policy: { domain_allowlist_required: true, no_destructive_actions: true, no_form_submit: true },
});

const allowed = checkBrowserRuntimePolicy({
  runtime: normalizeBrowserRuntime(SEEDED_BROWSER_RUNTIMES[1]),
  binding: extractionBinding,
  input: { url: "https://n8n.mad4b.com/", action: "extract_data" },
});
assert.equal(allowed.ok, true);
assert.equal(allowed.policy_result, "allowed");
assert.equal(allowed.url_host, "n8n.mad4b.com");
assert.equal(allowed.secrets_included, false);

const blockedDomain = checkBrowserRuntimePolicy({
  runtime: normalizeBrowserRuntime(SEEDED_BROWSER_RUNTIMES[1]),
  binding: extractionBinding,
  input: { url: "https://evil.example/products", action: "extract_data" },
});
assert.equal(blockedDomain.ok, false);
assert(blockedDomain.reasons.includes("domain_not_allowlisted"));

const formBinding = normalizeBrowserRuntimeBinding({
  binding_key: "auto_browser_takeover_essam",
  runtime_key: "auto_browser_essam_v1",
  use_case: "visual_takeover",
  allowed_actions: ["form_submit"],
  domain_allowlist: ["mad4b.com"],
  policy: { no_destructive_actions: true, no_form_submit: true },
});
const blockedSubmit = checkBrowserRuntimePolicy({
  runtime: normalizeBrowserRuntime(SEEDED_BROWSER_RUNTIMES[2]),
  binding: formBinding,
  input: { url: "https://n8n.mad4b.com/", action: "form_submit", explicit_approval: true },
});
assert.equal(blockedSubmit.ok, false);
assert(blockedSubmit.reasons.includes("form_submit_blocked"));
assert(blockedSubmit.reasons.includes("destructive_action_blocked"));

const persistentBinding = normalizeBrowserRuntimeBinding({
  binding_key: "vessel_browser_persistent_essam",
  runtime_key: "vessel_browser_essam_v1",
  use_case: "persistent_authenticated_session",
  allowed_actions: ["open_url"],
  domain_allowlist: ["mad4b.com"],
});
const blockedLoginReuse = checkBrowserRuntimePolicy({
  runtime: normalizeBrowserRuntime(SEEDED_BROWSER_RUNTIMES[3]),
  binding: persistentBinding,
  input: { url: "https://n8n.mad4b.com/", action: "open_url" },
});
assert.equal(blockedLoginReuse.ok, false);
assert(blockedLoginReuse.reasons.includes("login_or_session_reuse_requires_approval"));

assert.throws(
  () => assertNoSecretLike({ headers: { authorization: "Bearer abc.def.ghi" } }),
  /Secret-like field is not allowed/,
);
assert.throws(
  () => assertNoSecretLike({ query: "api_key=abc123" }),
  /Secret-like value is not allowed/,
);
assert.throws(
  () => parseBrowserUrl("ftp://example.com"),
  /must use http or https/,
);

{
  const routes = readFileSync("routes/browserRuntimeRoutes.js", "utf8");
  assert(routes.includes("/browser-runtime/runtimes"), "browser runtime list route must be mounted");
  assert(routes.includes("/browser-runtime/policy-check"), "policy check route must be mounted");
  assert(routes.includes("/browser-runtime/extract-data"), "extraction route must be mounted");
  assert(routes.includes("/browser-runtime/inspect-site"), "inspection route must be mounted");
  assert(routes.includes("requireAdminPrincipal"), "browser runtime routes must be admin protected");
}

{
  const index = readFileSync("routes/index.js", "utf8");
  assert(index.includes("buildBrowserRuntimeRoutes"), "browser runtime routes must be registered in route index");
}

{
  const migration = readFileSync("migrations/130_sprint65_browser_runtime_governance.sql", "utf8");
  for (const tableName of [
    "browser_runtime_registry",
    "browser_runtime_bindings",
    "browser_runtime_capabilities",
    "browser_runtime_policy",
    "browser_runtime_sessions",
    "browser_runtime_events",
    "browser_runtime_artifacts",
    "browser_data_extraction_jobs",
    "browser_site_inspection_runs",
  ]) {
    assert(migration.includes(tableName), `${tableName} must be created or referenced`);
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
    assert(migration.includes(toolKey), `${toolKey} must be registered as an admin tool`);
  }
  assert(migration.includes("native_essam_edge_connector_v1"), "current Essam browser runtime must be seeded");
  assert(migration.includes("active_open_url_degraded_visual_capture"), "Essam visual-capture degradation must be explicit");
  assert(!/Bearer\s+[A-Za-z0-9._~+\-/]+=*/i.test(migration), "migration must not contain bearer secrets");
}
