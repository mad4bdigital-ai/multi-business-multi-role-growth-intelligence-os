import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  planManagedGoogleSiteEnrollment,
  materializeManagedGoogleSiteEnrollment,
} from "./managedGoogleOAuthEnrollment.js";

const SITE_UUID = "d745d81f-6fc4-5c6a-99dd-d953c92137bf";
const ORIGIN = "https://staging.egypttourgates.com";
const KEY_ID = "etg-staging-v1";
const CALLBACK = ORIGIN + "/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback";
const OLD_SECRET = "other-site-managed-google-secret-abcdefghijklmnopqrstuvwxyz";
const NEW_SECRET = "etg-staging-generated-secret-fixture-abcdefghijklmnopqrstuvwxyz";

assert.throws(
  () => planManagedGoogleSiteEnrollment({ siteUuid: SITE_UUID, origin: ORIGIN, keyId: KEY_ID }),
  (error) => error?.code === "managed_google_enrollment_existing_registry_required"
);

const env = {
  MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON: JSON.stringify([{
    site_uuid: "11111111-1111-4111-8111-111111111111",
    origin: "https://other.example",
    callback_uri: "https://other.example/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback",
    key_id: "other-staging-v1",
    environment: "staging",
    status: "active",
  }]),
  MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON: JSON.stringify({
    "other-staging-v1": OLD_SECRET,
  }),
};

const plan = planManagedGoogleSiteEnrollment({
  env,
  siteUuid: SITE_UUID,
  origin: ORIGIN,
  keyId: KEY_ID,
  environment: "staging",
});
assert.equal(plan.contract, "mad4b.google-managed-oauth-site-enrollment-plan.v1");
assert.equal(plan.site_binding.site_uuid, SITE_UUID);
assert.equal(plan.site_binding.origin, ORIGIN);
assert.equal(plan.site_binding.callback_uri, CALLBACK);
assert.equal(plan.broker_origin, "https://dev.mad4b.com");
assert.equal(plan.existing_binding_exact, false);
assert.equal(plan.existing_secret_present, false);
assert.equal(plan.secrets_included_in_summary, false);

const root = mkdtempSync(path.join(os.tmpdir(), "mad4b-managed-google-enrollment-"));
try {
  const outputDir = path.join(root, "private");
  const result = materializeManagedGoogleSiteEnrollment(plan, {
    outputDir,
    cwd: path.resolve(process.cwd()),
    generatedSecret: NEW_SECRET,
  });
  assert.equal(result.secret_value_included, false);
  assert.equal(JSON.stringify(result).includes(NEW_SECRET), false);

  const broker = readFileSync(path.join(outputDir, "managed-google-broker.env.fragment"), "utf8");
  const wordpress = readFileSync(path.join(outputDir, "managed-google-wordpress.env.fragment"), "utf8");
  const summary = readFileSync(path.join(outputDir, "managed-google-enrollment-summary.json"), "utf8");

  assert.ok(broker.includes("MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON="));
  assert.ok(broker.includes("MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON="));
  assert.ok(broker.includes(SITE_UUID));
  assert.ok(broker.includes(KEY_ID));
  assert.ok(broker.includes(NEW_SECRET));
  assert.ok(broker.includes(OLD_SECRET), "Existing registry entry must be retained.");

  assert.ok(wordpress.includes("MAD4B_GOOGLE_MANAGED_OAUTH_BROKER_URL=https://dev.mad4b.com"));
  assert.ok(wordpress.includes("MAD4B_GOOGLE_MANAGED_OAUTH_SITE_KEY_ID=" + KEY_ID));
  assert.ok(wordpress.includes("MAD4B_GOOGLE_MANAGED_OAUTH_SITE_SECRET=" + NEW_SECRET));
  assert.equal(summary.includes(NEW_SECRET), false);

  for (const file of [
    "managed-google-broker.env.fragment",
    "managed-google-wordpress.env.fragment",
    "managed-google-enrollment-summary.json",
  ]) {
    assert.equal(statSync(path.join(outputDir, file)).mode & 0o777, 0o600);
  }
  assert.equal(statSync(outputDir).mode & 0o777, 0o700);

  assert.throws(
    () => materializeManagedGoogleSiteEnrollment(plan, {
      outputDir,
      cwd: path.resolve(process.cwd()),
      generatedSecret: NEW_SECRET,
    }),
    (error) => error?.code === "managed_google_enrollment_output_exists"
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

const exactEnv = {
  MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON: JSON.stringify([plan.site_binding]),
  MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON: JSON.stringify({ [KEY_ID]: NEW_SECRET }),
};
const exact = planManagedGoogleSiteEnrollment({
  env: exactEnv,
  siteUuid: SITE_UUID,
  origin: ORIGIN,
  keyId: KEY_ID,
  environment: "staging",
});
assert.equal(exact.existing_binding_exact, true);
assert.equal(exact.existing_secret_present, true);

assert.throws(
  () => planManagedGoogleSiteEnrollment({
    env: exactEnv,
    siteUuid: SITE_UUID,
    origin: "https://different.example",
    keyId: KEY_ID,
    environment: "staging",
  }),
  (error) => ["managed_google_enrollment_key_id_conflict", "managed_google_enrollment_site_binding_conflict"].includes(error?.code)
);

assert.throws(
  () => planManagedGoogleSiteEnrollment({
    env: {},
    siteUuid: SITE_UUID,
    origin: "http://staging.egypttourgates.com",
    keyId: KEY_ID,
    environment: "staging",
    allowNewRegistry: true,
  }),
  (error) => error?.code === "managed_google_enrollment_origin_invalid"
);

console.log("Managed Google site enrollment helper PASS");
