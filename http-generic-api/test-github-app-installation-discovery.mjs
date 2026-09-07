import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import {
  clearGitHubAppInstallationTokenCache,
  discoverGitHubAppInstallationId,
  getGitHubAppInstallationToken,
} from "./githubAppAuth.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });

{
  let requestedUrl = null;
  const installationId = await discoverGitHubAppInstallationId({
    appId: "3654304",
    privateKey: privateKeyPem,
    owner: "mad4bdigital-ai",
    repo: "multi-business-multi-role-growth-intelligence-os",
    fetchImpl: async (url, options = {}) => {
      requestedUrl = String(url);
      assert.match(String(options.headers?.Authorization || ""), /^Bearer /);
      return new Response(JSON.stringify({ id: 130821054 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(installationId, "130821054");
  assert.equal(
    requestedUrl,
    "https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/installation",
  );
}

{
  clearGitHubAppInstallationTokenCache();
  process.env.TEST_GITHUB_APP_PRIVATE_KEY = privateKeyPem;
  const calls = [];
  try {
    const token = await getGitHubAppInstallationToken({
      action: {
        github_app_id: "3654304",
        secret_store_ref: "ref:secret:TEST_GITHUB_APP_PRIVATE_KEY",
      },
      repositoryResolver: async () => ({
        ok: true,
        config: {
          github_owner: "mad4bdigital-ai",
          github_repo: "multi-business-multi-role-growth-intelligence-os",
        },
      }),
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || "GET" });
        if (String(url).endsWith("/installation")) {
          return new Response(JSON.stringify({ id: 130821054 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        assert.equal(String(url), "https://api.github.com/app/installations/130821054/access_tokens");
        assert.equal(options.method, "POST");
        return new Response(JSON.stringify({
          token: "installation-token",
          expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
    });
    assert.equal(token, "installation-token");
    assert.deepEqual(calls.map((call) => call.method), ["GET", "POST"]);
  } finally {
    delete process.env.TEST_GITHUB_APP_PRIVATE_KEY;
  }
}

{
  await assert.rejects(
    () => discoverGitHubAppInstallationId({
      appId: "3654304",
      privateKey: privateKeyPem,
      owner: "",
      repo: "",
      fetchImpl: async () => { throw new Error("must not call network"); },
    }),
    (error) => error?.code === "github_app_repository_binding_required",
  );
}

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.github-app.repository-bound-installation-discovery.v1",
  installation_id_not_required_in_bootstrap: true,
  caller_repository_body_not_required: true,
  cache_key_resolved_after_installation_discovery: true,
  secrets_included: false,
}));
