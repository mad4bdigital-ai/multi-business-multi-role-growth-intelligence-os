import assert from "node:assert/strict";
import {
  getNativeBrowserPluginTiers,
  resolveNativeBrowserPlugin,
  validateNativeBrowserPluginDefinition
} from "./nativeBrowserPluginRegistry.js";

const plugins = getNativeBrowserPluginTiers();

assert.equal(plugins.length, 4, "browser plugin tier registry exposes four initial tiers");
assert.deepEqual(
  plugins.map((plugin) => plugin.plugin_key),
  [
    "browser.playwright",
    "browser.puppeteer",
    "browser.stagehand",
    "browser.remote_browser_research"
  ],
  "browser plugin tiers stay stable and ordered"
);

for (const plugin of plugins) {
  assert.equal(plugin.validation.ok, true, `${plugin.plugin_key} validates: ${plugin.validation.errors.join(", ")}`);
  assert.equal(plugin.raw_library_api_exposed, false, `${plugin.plugin_key} does not expose raw library APIs`);
  assert.equal(plugin.domain_allowlist_required, true, `${plugin.plugin_key} requires domain allowlist`);
  assert.equal(plugin.audit_required, true, `${plugin.plugin_key} requires audit`);
  assert.equal(plugin.requires_tenant_entitlement, true, `${plugin.plugin_key} requires tenant entitlement`);
  assert.equal(plugin.requires_local_consent_for_customer, true, `${plugin.plugin_key} requires local customer consent`);
}

const playwright = resolveNativeBrowserPlugin("browser.playwright");
assert.equal(playwright?.library, "playwright", "resolves Playwright browser plugin");
assert(playwright.allowed_actions.includes("capture_screenshot"), "Playwright plugin supports screenshot platform verb");
assert(playwright.allowed_actions.includes("create_session"), "Playwright plugin supports managed browser sessions");
assert(playwright.allowed_actions.includes("wait_for_selector"), "Playwright plugin supports bounded waiting");
assert(playwright.allowed_actions.includes("download_allowlisted_file"), "Playwright plugin supports allowlisted downloads");
assert(playwright.allowed_actions.includes("upload_allowlisted_file"), "Playwright plugin supports allowlisted uploads");
assert(playwright.capability_groups.includes("qa"), "Playwright plugin advertises QA capability group");
assert.equal(playwright.default_client_strategy, "local_device_default_first", "Playwright prefers local device default browser");
assert(playwright.supported_browser_clients.includes("edge"), "Playwright supports Microsoft Edge client");
assert(playwright.supported_browser_clients.includes("chrome"), "Playwright supports Google Chrome client");
assert.deepEqual(playwright.fallback_browser_clients.slice(0, 2), ["edge", "chrome"], "Playwright falls back through common local browser clients");

const stagehand = resolveNativeBrowserPlugin("browser.stagehand");
assert.equal(stagehand?.requires_approval_hold, true, "Stagehand plugin is approval gated");
assert(!stagehand.allowed_actions.includes("generate_pdf"), "Stagehand initial tier avoids extra PDF/download surface");
assert(stagehand.capability_groups.includes("ai_adaptive"), "Stagehand plugin advertises AI-adaptive capability group");

const remoteBrowser = resolveNativeBrowserPlugin("browser.remote_browser_research");
assert.equal(remoteBrowser?.lifecycle, "research_only", "remote-browser stays research-only");
assert.equal(remoteBrowser.allowed_actions.length, 0, "remote-browser research tier has no executable actions");

const unsafe = validateNativeBrowserPluginDefinition({
  plugin_key: "browser.unsafe",
  lifecycle: "candidate_default",
  allowed_actions: ["open_url", "eval", "raw_cdp"],
  raw_library_api_exposed: true,
  domain_allowlist_required: false,
  audit_required: false,
  requires_tenant_entitlement: false,
  requires_local_consent_for_customer: false
});

assert.equal(unsafe.ok, false, "unsafe plugin definition is rejected");
assert(unsafe.errors.includes("raw_library_api_exposed must be false."), "rejects raw API exposure");
assert(unsafe.errors.includes("forbidden action declared: eval"), "rejects eval action");
assert(unsafe.errors.includes("forbidden action declared: raw_cdp"), "rejects raw CDP action");

console.log("native browser plugin registry tests passed");
