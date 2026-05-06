import assert from "node:assert/strict";

import {
  dispatchNativeBrowserPluginRequest,
  validateNativeBrowserPluginRequest
} from "./nativeBrowserPluginDispatcher.js";

function assertBrowserPluginError(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code);
    assert.equal(typeof error.status, "number");
    return true;
  });
}

async function assertBrowserPluginRejects(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    assert.equal(typeof error.status, "number");
    return true;
  });
}

const status = await dispatchNativeBrowserPluginRequest({
  plugin_key: "browser.playwright",
  action: "status"
});
assert.equal(status.ok, true);
assert.equal(status.plugin_key, "browser.playwright");
assert.equal(status.dependency_status, "missing");
assert.equal(status.executable, true);
assert(status.allowed_actions.includes("capture_screenshot"));

assertBrowserPluginError(
  () => validateNativeBrowserPluginRequest({ plugin_key: "browser.unknown", action: "status" }),
  "browser_plugin_not_found"
);

assertBrowserPluginError(
  () => validateNativeBrowserPluginRequest({ plugin_key: "browser.playwright", action: "evaluate" }),
  "browser_plugin_action_forbidden"
);

assertBrowserPluginError(
  () => validateNativeBrowserPluginRequest({ plugin_key: "browser.playwright", action: "inspect_shadow_dom" }),
  "browser_plugin_action_not_allowed"
);

assertBrowserPluginError(
  () => validateNativeBrowserPluginRequest({ plugin_key: "browser.remote_browser_research", action: "open_url" }),
  "browser_plugin_research_only"
);

assertBrowserPluginError(
  () => validateNativeBrowserPluginRequest({ plugin_key: "browser.stagehand", action: "open_url" }),
  "browser_plugin_approval_required"
);

assertBrowserPluginError(
  () =>
    validateNativeBrowserPluginRequest({
      plugin_key: "browser.playwright",
      action: "open_url",
      url: "https://example.com/page"
    }),
  "browser_plugin_domain_allowlist_required"
);

assertBrowserPluginError(
  () =>
    validateNativeBrowserPluginRequest({
      plugin_key: "browser.playwright",
      action: "open_url",
      url: "https://evil.example/page",
      domain_allowlist: ["example.com"]
    }),
  "browser_plugin_domain_not_allowed"
);

assertBrowserPluginError(
  () =>
    validateNativeBrowserPluginRequest({
      plugin_key: "browser.playwright",
      action: "open_url",
      url: "file:///C:/Windows/System32/calc.exe",
      domain_allowlist: ["example.com"]
    }),
  "browser_plugin_invalid_url_protocol"
);

await assertBrowserPluginRejects(
  dispatchNativeBrowserPluginRequest({
    plugin_key: "browser.playwright",
    action: "open_url",
    url: "https://example.com/page",
    domain_allowlist: ["example.com"]
  }),
  "browser_plugin_dependency_missing"
);

const calls = [];
const executed = await dispatchNativeBrowserPluginRequest(
  {
    plugin_key: "browser.playwright",
    action: "open_url",
    url: "https://app.example.com/page",
    domain_allowlist: ["*.example.com"],
    selector: "#ignored-for-open",
    options: { wait_until: "networkidle" }
  },
  {
    adapters: {
      playwright: {
        dispatch(input) {
          calls.push(input);
          return { opened: input.url };
        }
      }
    }
  }
);

assert.equal(executed.ok, true);
assert.equal(executed.result.opened, "https://app.example.com/page");
assert.equal(calls.length, 1);
assert.equal(calls[0].plugin.plugin_key, "browser.playwright");
assert.equal(calls[0].plugin.library, "playwright");
assert.equal(calls[0].action, "open_url");
assert.deepEqual(calls[0].domain_allowlist, ["*.example.com"]);

const stagehandExecuted = await dispatchNativeBrowserPluginRequest(
  {
    plugin_key: "browser.stagehand",
    action: "open_url",
    url: "https://example.com/",
    domain_allowlist: ["example.com"],
    approval_granted: true
  },
  {
    adapters: {
      stagehand: {
        dispatch(input) {
          return { approved_action: input.action };
        }
      }
    }
  }
);
assert.equal(stagehandExecuted.result.approved_action, "open_url");

console.log("test-native-browser-plugin-dispatcher: ok");
