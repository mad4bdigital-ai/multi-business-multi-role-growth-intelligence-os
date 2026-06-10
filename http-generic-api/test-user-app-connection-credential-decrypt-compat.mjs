import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const previousTokenKey = process.env.TOKEN_ENCRYPTION_KEY;
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");

const { encryptCredentials } = await import("./tokenEncryption.js");
const { decryptUserAppCredentials } = await import("./userAppConnectionCredentials.js");

try {
  const stored = encryptCredentials({
    username: "wp-user",
    application_password: "app-pass",
    api_base_url: "https://example.com/wp-json/",
  });
  const decrypted = decryptUserAppCredentials(stored);
  assert.equal(decrypted.username, "wp-user", "tokenEncryption credential envelope must expose username");
  assert.equal(decrypted.application_password, "app-pass", "tokenEncryption credential envelope must expose application_password");
  assert.equal(decrypted.api_base_url, "https://example.com/wp-json/", "tokenEncryption credential envelope must preserve non-secret metadata");

  const plaintext = decryptUserAppCredentials(JSON.stringify({ username: "plain", application_password: "plain-pass" }));
  assert.equal(plaintext.username, "plain", "plain JSON compatibility must be preserved");
  assert.equal(plaintext.application_password, "plain-pass", "plain JSON secret field compatibility must be preserved");

  console.log("user app connection credential decrypt compatibility tests passed");
} finally {
  if (previousTokenKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = previousTokenKey;
}
