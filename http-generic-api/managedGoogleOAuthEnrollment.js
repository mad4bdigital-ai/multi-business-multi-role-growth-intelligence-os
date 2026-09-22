import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, openSync, closeSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import path from "node:path";

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY_ID_RE = /^[A-Za-z0-9._:-]{3,64}$/;

function enrollmentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeOrigin(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw enrollmentError("managed_google_enrollment_origin_invalid", "Site origin must be an HTTPS origin without user-info, query or fragment.");
  }
  if (url.pathname && url.pathname !== "/") {
    throw enrollmentError("managed_google_enrollment_origin_invalid", "Site origin must not include a path.");
  }
  return url.origin;
}

function parseJsonEnv(value, fallback, code) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    throw enrollmentError(code, "Existing managed Google registry environment contains invalid JSON.");
  }
}

export function planManagedGoogleSiteEnrollment({
  env = process.env,
  siteUuid,
  origin,
  keyId,
  environment = "staging",
  allowNewRegistry = false,
} = {}) {
  const uuid = String(siteUuid || "").trim().toLowerCase();
  if (!UUID_RE.test(uuid)) throw enrollmentError("managed_google_enrollment_site_uuid_invalid", "Exact Site Profile UUID is required.");
  const normalizedOrigin = normalizeOrigin(origin);
  const normalizedKeyId = String(keyId || "").trim();
  if (!KEY_ID_RE.test(normalizedKeyId)) throw enrollmentError("managed_google_enrollment_key_id_invalid", "Managed Google site key ID is invalid.");
  const normalizedEnvironment = String(environment || "").trim().toLowerCase();
  if (!["local", "development", "staging", "production"].includes(normalizedEnvironment)) {
    throw enrollmentError("managed_google_enrollment_environment_invalid", "Managed Google site environment is invalid.");
  }

  const callbackUri = `${normalizedOrigin}/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback`;
  const bindingsRaw = String(env.MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON || "").trim();
  const secretsRaw = String(env.MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON || "").trim();
  if ((!bindingsRaw || !secretsRaw) && !allowNewRegistry) {
    throw enrollmentError(
      "managed_google_enrollment_existing_registry_required",
      "Existing broker registries are missing. Pass allowNewRegistry only for an intentional first registry."
    );
  }

  const bindings = parseJsonEnv(bindingsRaw, [], "managed_google_enrollment_bindings_invalid");
  const secrets = parseJsonEnv(secretsRaw, {}, "managed_google_enrollment_secrets_invalid");
  if (!Array.isArray(bindings)) throw enrollmentError("managed_google_enrollment_bindings_invalid", "Site bindings registry must be a JSON array.");
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
    throw enrollmentError("managed_google_enrollment_secrets_invalid", "Site secrets registry must be a JSON object.");
  }

  const target = {
    site_uuid: uuid,
    origin: normalizedOrigin,
    callback_uri: callbackUri,
    key_id: normalizedKeyId,
    environment: normalizedEnvironment,
    status: "active",
  };

  const sameKey = bindings.filter((row) => row && String(row.key_id || "") === normalizedKeyId);
  if (sameKey.length > 1) throw enrollmentError("managed_google_enrollment_duplicate_key_id", "Broker bindings contain duplicate key IDs.");
  if (sameKey.length === 1) {
    const current = sameKey[0];
    for (const field of ["site_uuid", "origin", "callback_uri", "environment", "status"]) {
      if (String(current[field] || "") !== String(target[field])) {
        throw enrollmentError("managed_google_enrollment_key_id_conflict", "Existing key ID is bound to a different site tuple.");
      }
    }
  }

  const sameSite = bindings.filter((row) => row && String(row.site_uuid || "").toLowerCase() === uuid && String(row.environment || "") === normalizedEnvironment);
  for (const row of sameSite) {
    if (String(row.key_id || "") !== normalizedKeyId || String(row.origin || "") !== normalizedOrigin || String(row.callback_uri || "") !== callbackUri) {
      throw enrollmentError("managed_google_enrollment_site_binding_conflict", "Site Profile already has a conflicting active managed Google binding.");
    }
  }

  const existingSecret = Object.prototype.hasOwnProperty.call(secrets, normalizedKeyId) ? String(secrets[normalizedKeyId] || "") : "";
  if (existingSecret && existingSecret.length < 32) {
    throw enrollmentError("managed_google_enrollment_existing_secret_invalid", "Existing site HMAC secret is shorter than 32 characters.");
  }

  const secretDigests = new Map();
  for (const [existingKey, secret] of Object.entries(secrets)) {
    const raw = String(secret || "");
    if (raw.length < 32) throw enrollmentError("managed_google_enrollment_existing_secret_invalid", "Existing site HMAC registry contains an invalid secret.");
    const digest = createHash("sha256").update(raw, "utf8").digest("hex");
    if (secretDigests.has(digest) && secretDigests.get(digest) !== existingKey) {
      throw enrollmentError("managed_google_enrollment_secret_reused", "Existing site HMAC secrets are not unique per key ID.");
    }
    secretDigests.set(digest, existingKey);
  }

  return {
    contract: "mad4b.google-managed-oauth-site-enrollment-plan.v1",
    read_only: true,
    network_request_performed: false,
    site_binding: target,
    existing_binding_exact: sameKey.length === 1,
    existing_secret_present: !!existingSecret,
    broker_origin: normalizedEnvironment === "production" ? "https://auth.mad4b.com" : "https://dev.mad4b.com",
    current_bindings: bindings,
    current_secrets: secrets,
    key_id: normalizedKeyId,
    secrets_included_in_summary: false,
  };
}

function assertOutputDir(outputDir, cwd) {
  if (!path.isAbsolute(outputDir)) throw enrollmentError("managed_google_enrollment_output_dir_not_absolute", "Output directory must be absolute.");
  const resolved = path.resolve(outputDir);
  const working = path.resolve(cwd || process.cwd());
  if (resolved === working || resolved.startsWith(working + path.sep)) {
    throw enrollmentError("managed_google_enrollment_output_inside_repository", "Secret fragments must be written outside the repository working tree.");
  }
  return resolved;
}

function writePrivateFile(file, content) {
  if (existsSync(file)) throw enrollmentError("managed_google_enrollment_output_exists", `Refusing to overwrite existing enrollment output: ${file}`);
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(fd, content, { encoding: "utf8" });
  } finally {
    closeSync(fd);
  }
  chmodSync(file, 0o600);
}

export function materializeManagedGoogleSiteEnrollment(plan, {
  outputDir,
  cwd = process.cwd(),
  generatedSecret = "",
} = {}) {
  if (!plan || plan.contract !== "mad4b.google-managed-oauth-site-enrollment-plan.v1") {
    throw enrollmentError("managed_google_enrollment_plan_invalid", "A valid enrollment plan is required.");
  }
  const resolvedOutput = assertOutputDir(String(outputDir || ""), cwd);
  mkdirSync(resolvedOutput, { recursive: true, mode: 0o700 });
  chmodSync(resolvedOutput, 0o700);

  let secret = plan.existing_secret_present ? String(plan.current_secrets[plan.key_id] || "") : String(generatedSecret || "");
  if (!secret) secret = randomBytes(48).toString("base64url");
  if (secret.length < 32) throw enrollmentError("managed_google_enrollment_generated_secret_invalid", "Generated site HMAC secret is invalid.");

  const mergedBindings = plan.current_bindings.slice();
  if (!plan.existing_binding_exact) mergedBindings.push(plan.site_binding);
  const mergedSecrets = { ...plan.current_secrets, [plan.key_id]: secret };

  const brokerFile = path.join(resolvedOutput, "managed-google-broker.env.fragment");
  const wordpressFile = path.join(resolvedOutput, "managed-google-wordpress.env.fragment");
  const summaryFile = path.join(resolvedOutput, "managed-google-enrollment-summary.json");

  const brokerText = [
    `MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON=${JSON.stringify(JSON.stringify(mergedBindings))}`,
    `MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON=${JSON.stringify(JSON.stringify(mergedSecrets))}`,
    "",
  ].join("\n");
  const wordpressText = [
    `MAD4B_GOOGLE_MANAGED_OAUTH_BROKER_URL=${plan.broker_origin}`,
    `MAD4B_GOOGLE_MANAGED_OAUTH_SITE_KEY_ID=${plan.key_id}`,
    `MAD4B_GOOGLE_MANAGED_OAUTH_SITE_SECRET=${secret}`,
    "",
  ].join("\n");
  const summary = {
    contract: "mad4b.google-managed-oauth-site-enrollment-output.v1",
    site_binding: plan.site_binding,
    broker_origin: plan.broker_origin,
    key_id: plan.key_id,
    secret_sha256: createHash("sha256").update(secret, "utf8").digest("hex"),
    secret_length: secret.length,
    secret_value_included: false,
    files: {
      broker: brokerFile,
      wordpress: wordpressFile,
    },
  };

  writePrivateFile(brokerFile, brokerText);
  writePrivateFile(wordpressFile, wordpressText);
  writePrivateFile(summaryFile, JSON.stringify(summary, null, 2) + "\n");

  return summary;
}
