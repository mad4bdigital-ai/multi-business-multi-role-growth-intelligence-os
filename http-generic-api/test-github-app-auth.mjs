/**
 * test-github-app-auth.mjs
 *
 * Fast, offline checks for GitHub App JWT and installation-token auth plumbing.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  clearGitHubAppInstallationTokenCache,
  createGitHubAppJwt,
  decodeGitHubAppPrivateKey,
  getGitHubAppInstallationToken,
  resolveGitHubAppConfig,
} from "./githubAppAuth.js";
import { buildResolvedAuthHeaders, inferAuthMode } from "./authInjection.js";

const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const privateKeyPem = privateKey.export({
  type: "pkcs8",
  format: "pem",
});
const privateKeyB64 = Buffer.from(privateKeyPem, "utf8").toString("base64");

assert.equal(
  decodeGitHubAppPrivateKey(privateKeyB64),
  privateKeyPem.trim(),
  "base64 private key decodes to PEM"
);

const jwt = createGitHubAppJwt({
  appId: "3654304",
  privateKey: privateKeyB64,
  nowSeconds: 1_700_000_000,
});

const parts = jwt.split(".");
assert.equal(parts.length, 3, "GitHub App JWT has three segments");

const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
assert.equal(payload.iss, "3654304", "JWT issuer is GitHub App id");
assert.equal(payload.iat, 1_699_999_940, "JWT iat is backdated for clock skew");
assert.equal(payload.exp, 1_700_000_540, "JWT exp stays within GitHub ten-minute limit");

process.env.TEST_GITHUB_APP_PRIVATE_KEY = privateKeyPem;
clearGitHubAppInstallationTokenCache();

let calls = 0;
const token = await getGitHubAppInstallationToken({
  action: {
    github_app_id: "3654304",
    github_app_installation_id: "130821054",
    secret_store_ref: "ref:secret:TEST_GITHUB_APP_PRIVATE_KEY",
  },
  fetchImpl: async (url, options = {}) => {
    calls += 1;
    assert.equal(
      url,
      "https://api.github.com/app/installations/130821054/access_tokens",
      "installation token endpoint uses configured installation id"
    );
    assert.equal(options.method, "POST", "installation token request is POST");

    const authHeader = options.headers?.Authorization || "";
    assert.ok(authHeader.startsWith("Bearer "), "installation token request uses app JWT bearer");
    assert.equal(
      authHeader.slice("Bearer ".length).split(".").length,
      3,
      "installation token request bearer contains a JWT"
    );

    return {
      ok: true,
      status: 201,
      json: async () => ({
        token: "installation-token",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    };
  },
});

assert.equal(token, "installation-token", "installation token is returned");

const cached = await getGitHubAppInstallationToken({
  action: {
    github_app_id: "3654304",
    github_app_installation_id: "130821054",
    secret_store_ref: "ref:secret:TEST_GITHUB_APP_PRIVATE_KEY",
  },
  fetchImpl: async () => {
    throw new Error("cache miss");
  },
});

assert.equal(cached, "installation-token", "installation token is cached");
assert.equal(calls, 1, "installation token fetch runs once before cache reuse");

const savedGitHubAppId = process.env.GITHUB_APP_ID;
const savedGitHubAppInstallationId = process.env.GITHUB_APP_INSTALLATION_ID;
const savedGitHubAppPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;
const savedGitHubAppPrivateKeyB64 = process.env.GITHUB_APP_PRIVATE_KEY_B64;
delete process.env.GITHUB_APP_ID;
delete process.env.GITHUB_APP_INSTALLATION_ID;
delete process.env.GITHUB_APP_PRIVATE_KEY;
delete process.env.GITHUB_APP_PRIVATE_KEY_B64;

assert.deepEqual(
  resolveGitHubAppConfig({}),
  { appId: "", installationId: "", privateKey: "" },
  "github app config has no hardcoded fallback ids"
);

if (savedGitHubAppId === undefined) delete process.env.GITHUB_APP_ID;
else process.env.GITHUB_APP_ID = savedGitHubAppId;
if (savedGitHubAppInstallationId === undefined) delete process.env.GITHUB_APP_INSTALLATION_ID;
else process.env.GITHUB_APP_INSTALLATION_ID = savedGitHubAppInstallationId;
if (savedGitHubAppPrivateKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
else process.env.GITHUB_APP_PRIVATE_KEY = savedGitHubAppPrivateKey;
if (savedGitHubAppPrivateKeyB64 === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY_B64;
else process.env.GITHUB_APP_PRIVATE_KEY_B64 = savedGitHubAppPrivateKeyB64;

assert.equal(
  inferAuthMode({ action: { api_key_mode: "github_app" }, brand: {} }),
  "github_app",
  "github_app is inferred as an explicit auth mode"
);

assert.deepEqual(
  buildResolvedAuthHeaders({ mode: "github_app", secret: "abc123" }),
  { Authorization: "Bearer abc123" },
  "github_app injects as bearer Authorization"
);

console.log("ALL GITHUB APP AUTH TESTS PASS");
