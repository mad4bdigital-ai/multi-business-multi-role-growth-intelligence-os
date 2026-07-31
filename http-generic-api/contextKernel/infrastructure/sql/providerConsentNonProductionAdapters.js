import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const NON_PRODUCTION_ENVIRONMENTS = new Set(["test", "development", "staging", "non_production"]);
const SAFE_ACCOUNT_METADATA_KEYS = Object.freeze([
  "account_id",
  "avatar_url",
  "display_name",
  "domain",
  "email",
  "organization_id",
]);

function adapterError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.name = "ProviderConsentNonProductionAdapterError";
  error.code = code;
  error.status = status;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value) {
  if (value == null || value === "") return null;
  return requiredString(value, "value");
}

function assertNonProduction(environment) {
  const normalized = requiredString(environment, "environment").toLowerCase();
  if (!NON_PRODUCTION_ENVIRONMENTS.has(normalized)) {
    throw adapterError(
      "provider_consent_nonprod_adapter_environment_forbidden",
      "Provider-consent simulation adapters cannot be constructed for Production.",
      403,
      { environment: normalized },
    );
  }
  return normalized;
}

function validateIdentifier(value, fieldName) {
  const identifier = requiredString(value, fieldName);
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(identifier)) {
    throw new TypeError(`${fieldName} must be a safe SQL identifier.`);
  }
  return identifier;
}

function executorMethod(executor) {
  if (typeof executor?.execute === "function") return executor.execute.bind(executor);
  if (typeof executor?.query === "function") return executor.query.bind(executor);
  throw new TypeError("SQL executor must provide execute() or query().");
}

async function execute(executor, statement, params = []) {
  return executorMethod(executor)(statement, params);
}

function mutationResult(result) {
  if (Array.isArray(result)) return result[0] || {};
  return result || {};
}

function rowResult(result) {
  if (!Array.isArray(result)) return [];
  return Array.isArray(result[0]) ? result[0] : [];
}

function affectedRows(result) {
  const value = Number(mutationResult(result)?.affectedRows ?? mutationResult(result)?.rowCount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freeze(entry)])));
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function stableJson(value) {
  const serialize = (entry) => {
    if (entry == null || typeof entry !== "object") return JSON.stringify(entry);
    if (Array.isArray(entry)) return `[${entry.map(serialize).join(",")}]`;
    return `{${Object.keys(entry).sort().map((key) => `${JSON.stringify(key)}:${serialize(entry[key])}`).join(",")}}`;
  };
  return serialize(value);
}

function normalizeScopes(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError("grantedScopes must be an array.");
  return [...new Set(value.map((scope) => requiredString(scope, "grantedScopes[]")))].sort();
}

function safeAccountMetadata(account = {}) {
  if (!account || typeof account !== "object" || Array.isArray(account)) return Object.freeze({});
  const result = {};
  for (const key of SAFE_ACCOUNT_METADATA_KEYS) {
    if (!Object.hasOwn(account, key)) continue;
    const value = account[key];
    if (value == null) continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    const normalized = typeof value === "string" ? value.trim().slice(0, 512) : value;
    result[key] = normalized;
  }
  return Object.freeze(result);
}

export function createSqlProviderConsentHandoffStore({
  executor,
  tableName = "provider_consent_handoffs",
  environment = "non_production",
  schemaDigestSha256,
  adapterVersionRef = "provider-consent-handoff-sql.v1",
  maxLeaseSeconds = 60,
  maxAttempts = 4,
} = {}) {
  executorMethod(executor);
  const normalizedEnvironment = assertNonProduction(environment);
  const table = validateIdentifier(tableName, "tableName");
  const schemaDigest = requiredString(schemaDigestSha256, "schemaDigestSha256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(schemaDigest)) {
    throw new TypeError("schemaDigestSha256 must be a SHA-256 value.");
  }
  if (!Number.isSafeInteger(maxLeaseSeconds) || maxLeaseSeconds < 1 || maxLeaseSeconds > 300) {
    throw new TypeError("maxLeaseSeconds must be between 1 and 300.");
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new TypeError("maxAttempts must be between 1 and 20.");
  }

  const statements = Object.freeze({
    insert: `
      INSERT INTO ${table} (
        handoff_ref, status, stage, expires_at, max_attempts, attempt_count,
        sealed_payload, certification_version_ref, created_at, updated_at
      ) VALUES (?, 'ready', 'claimed_handoff_ready', ?, ?, 0, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
    `,
    acquire: `
      UPDATE ${table}
      SET status = 'leased', lease_ref = ?, lease_expires_at = ?,
          attempt_count = attempt_count + 1, updated_at = UTC_TIMESTAMP()
      WHERE handoff_ref = ?
        AND status IN ('ready', 'retryable')
        AND expires_at > ?
        AND attempt_count < max_attempts
        AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
    `,
    readLease: `
      SELECT handoff_ref, lease_ref, stage, attempt_count AS attempt,
             sealed_payload, sealed_credential_checkpoint,
             sealed_completion_checkpoint, expires_at
      FROM ${table}
      WHERE handoff_ref = ? AND lease_ref = ? AND status = 'leased'
      LIMIT 2
    `,
    checkpoint: `
      UPDATE ${table}
      SET stage = ?,
          sealed_credential_checkpoint = COALESCE(?, sealed_credential_checkpoint),
          sealed_completion_checkpoint = COALESCE(?, sealed_completion_checkpoint),
          updated_at = UTC_TIMESTAMP()
      WHERE handoff_ref = ? AND lease_ref = ? AND status = 'leased'
    `,
    release: `
      UPDATE ${table}
      SET status = ?, lease_ref = NULL, lease_expires_at = NULL,
          retry_at = ?, last_error_code = ?, updated_at = UTC_TIMESTAMP()
      WHERE handoff_ref = ? AND lease_ref = ? AND status = 'leased'
    `,
    complete: `
      UPDATE ${table}
      SET status = 'completed', stage = 'completed', completed_at = UTC_TIMESTAMP(),
          lease_ref = NULL, lease_expires_at = NULL, updated_at = UTC_TIMESTAMP()
      WHERE handoff_ref = ? AND lease_ref = ? AND status = 'leased'
        AND sealed_completion_checkpoint IS NOT NULL
    `,
    readStatus: `
      SELECT handoff_ref, status, stage, attempt_count, max_attempts,
             expires_at, retry_at, last_error_code,
             sealed_credential_checkpoint IS NOT NULL AS provider_checkpoint_present,
             sealed_completion_checkpoint IS NOT NULL AS completion_checkpoint_present
      FROM ${table}
      WHERE handoff_ref = ?
      LIMIT 2
    `,
  });

  async function insert(input = {}) {
    const handoffRef = requiredString(input.handoffRef, "handoffRef");
    const result = await execute(executor, statements.insert, [
      handoffRef,
      requiredString(input.expiresAt, "expiresAt"),
      input.maxAttempts || maxAttempts,
      requiredString(input.sealedPayload, "sealedPayload"),
      requiredString(input.certificationVersionRef, "certificationVersionRef"),
    ]);
    return Object.freeze({ created: affectedRows(result) === 1, handoffRef });
  }

  async function acquire(input = {}) {
    const handoffRef = requiredString(input.handoffRef, "handoffRef");
    const leaseRef = requiredString(input.leaseRef, "leaseRef");
    const now = requiredString(input.now, "now");
    const update = await execute(executor, statements.acquire, [
      leaseRef,
      requiredString(input.leaseExpiresAt, "leaseExpiresAt"),
      handoffRef,
      now,
      now,
    ]);
    if (affectedRows(update) !== 1) return null;
    const rows = rowResult(await execute(executor, statements.readLease, [handoffRef, leaseRef]));
    if (rows.length !== 1) {
      throw adapterError(
        "provider_consent_handoff_lease_readback_ambiguous",
        "Provider-consent handoff lease did not have an exact readback.",
        500,
        { row_count: rows.length },
      );
    }
    const row = rows[0];
    return freeze({
      acquired: true,
      handoffRef,
      leaseRef,
      attempt: Number(row.attempt || 0),
      sealedPayload: row.sealed_payload,
      sealedCredentialCheckpoint: row.sealed_credential_checkpoint || null,
      sealedCompletionCheckpoint: row.sealed_completion_checkpoint || null,
    });
  }

  async function checkpoint(input = {}) {
    const stage = requiredString(input.stage, "stage");
    if (!["provider_completed", "persistence_completed"].includes(stage)) {
      throw new TypeError("stage must be provider_completed or persistence_completed.");
    }
    const result = await execute(executor, statements.checkpoint, [
      stage,
      input.sealedCredentialCheckpoint || null,
      input.sealedCompletionCheckpoint || null,
      requiredString(input.handoffRef, "handoffRef"),
      requiredString(input.leaseRef, "leaseRef"),
    ]);
    return Object.freeze({ checkpointed: affectedRows(result) === 1 });
  }

  async function release(input = {}) {
    const result = await execute(executor, statements.release, [
      input.retryable === true ? "retryable" : "failed",
      input.retryable === true ? optionalString(input.retryAt) : null,
      requiredString(input.errorCode, "errorCode"),
      requiredString(input.handoffRef, "handoffRef"),
      requiredString(input.leaseRef, "leaseRef"),
    ]);
    return Object.freeze({ released: affectedRows(result) === 1 });
  }

  async function complete(input = {}) {
    const result = await execute(executor, statements.complete, [
      requiredString(input.handoffRef, "handoffRef"),
      requiredString(input.leaseRef, "leaseRef"),
    ]);
    return Object.freeze({ completed: affectedRows(result) === 1 });
  }

  async function readStatus({ handoffRef } = {}) {
    const ref = requiredString(handoffRef, "handoffRef");
    const rows = rowResult(await execute(executor, statements.readStatus, [ref]));
    if (rows.length > 1) {
      throw adapterError(
        "provider_consent_handoff_status_ambiguous",
        "Provider-consent handoff status readback was ambiguous.",
        500,
        { row_count: rows.length },
      );
    }
    if (!rows.length) return null;
    const row = rows[0];
    return freeze({
      handoffRef: ref,
      status: row.status,
      stage: row.stage,
      attemptCount: Number(row.attempt_count || 0),
      maxAttempts: Number(row.max_attempts || 0),
      expiresAt: row.expires_at,
      retryAt: row.retry_at || null,
      lastErrorCode: row.last_error_code || null,
      providerCheckpointPresent: Boolean(row.provider_checkpoint_present),
      completionCheckpointPresent: Boolean(row.completion_checkpoint_present),
      secretsIncluded: false,
    });
  }

  return Object.freeze({
    certification: freeze({
      status: "certified",
      versionRef: requiredString(adapterVersionRef, "adapterVersionRef"),
      environment: normalizedEnvironment,
      schemaRef: `db-schema://${table}`,
      schemaDigestSha256: schemaDigest,
      capabilities: {
        atomicCreate: true,
        leaseCas: true,
        checkpointCas: true,
        oneTimeCompletion: true,
        expiryEnforced: true,
        payloadEncryption: true,
      },
      maxLeaseSeconds,
      maxAttempts,
      secretsIncluded: false,
    }),
    insert,
    acquire,
    checkpoint,
    release,
    complete,
    readStatus,
  });
}

function classifyProviderError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 429) return Object.freeze({ code: "provider_rate_limited", retryable: true });
  if (status >= 500 || error?.code === "ETIMEDOUT" || error?.code === "ECONNRESET") {
    return Object.freeze({ code: "provider_transient_error", retryable: true });
  }
  return Object.freeze({ code: "provider_exchange_rejected", retryable: false });
}

export function createNonProductionProviderExchangeAdapter({
  providerKey,
  simulationTransport,
  environment = "non_production",
  versionRef = "provider-exchange-simulation.v1",
  transportRef = "provider-simulation-transport.v1",
  timeoutMs = 15000,
  retryClassificationVersion = "provider-retry-classification.v1",
} = {}) {
  const normalizedEnvironment = assertNonProduction(environment);
  const provider = requiredString(providerKey, "providerKey");
  if (typeof simulationTransport !== "function") {
    throw new TypeError("simulationTransport must be a function.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    throw new TypeError("timeoutMs must be between 1000 and 60000.");
  }

  async function exchangeAuthorizationCode(input = {}) {
    if (input.providerKey !== provider) {
      throw adapterError(
        "provider_exchange_simulation_provider_mismatch",
        "Simulation provider does not match the certified adapter.",
      );
    }
    const idempotencyKey = requiredString(input.idempotencyKey, "idempotencyKey");
    const authorizationCode = requiredString(input.authorizationCode, "authorizationCode");
    try {
      const result = await simulationTransport(Object.freeze({
        providerKey: provider,
        authorizationCode,
        redirectTargetRef: requiredString(input.redirectTargetRef, "redirectTargetRef"),
        requestedProviderScopes: normalizeScopes(input.requestedProviderScopes),
        idempotencyKey,
        timeoutMs: Math.min(Number(input.timeoutMs || timeoutMs), timeoutMs),
        simulationOnly: true,
      }));
      if (!result || typeof result !== "object" || result.providerKey !== provider) {
        throw adapterError(
          "provider_exchange_simulation_result_invalid",
          "Provider simulation returned an invalid provider-bound result.",
          502,
        );
      }
      return result;
    } catch (cause) {
      if (cause?.name === "ProviderConsentNonProductionAdapterError") throw cause;
      const classification = classifyProviderError(cause);
      const error = adapterError(
        classification.code,
        "Provider simulation exchange failed without exposing provider payloads.",
        classification.retryable ? 503 : 409,
        { retryable: classification.retryable },
      );
      error.retryable = classification.retryable;
      error.cause = cause;
      throw error;
    }
  }

  return Object.freeze({
    certification: freeze({
      status: "certified",
      providerKey: provider,
      versionRef: requiredString(versionRef, "versionRef"),
      mode: "simulation",
      environment: normalizedEnvironment,
      transportRef: requiredString(transportRef, "transportRef"),
      supportsIdempotency: true,
      unknownOutcomeSafe: true,
      timeoutMs,
      retryClassificationVersion: requiredString(
        retryClassificationVersion,
        "retryClassificationVersion",
      ),
      liveProviderCalled: false,
      secretsIncluded: false,
    }),
    exchangeAuthorizationCode,
  });
}

function requireKeyResolution(value) {
  if (!value || typeof value !== "object") throw new TypeError("keyResolver returned no key resolution.");
  if (!Buffer.isBuffer(value.key) || value.key.length !== 32) {
    throw new TypeError("keyResolver must return a 32-byte Buffer key.");
  }
  return Object.freeze({
    key: value.key,
    keyRef: requiredString(value.keyRef, "keyRef"),
    keyVersionRef: requiredString(value.keyVersionRef, "keyVersionRef"),
  });
}

function aadFor(input) {
  return stableJson({
    providerKey: input.providerKey,
    tenantRef: input.tenantRef,
    workspaceRef: input.workspaceRef,
    brandRef: input.brandRef || null,
    ownerScopeType: input.ownerScopeType,
    ownerScopeRef: input.ownerScopeRef,
  });
}

async function openEnvelopeForTest({ encryptedCredentials, keyResolver, context }) {
  const parsed = JSON.parse(requiredString(encryptedCredentials, "encryptedCredentials"));
  const resolution = requireKeyResolution(await keyResolver({
    purpose: "provider-credential-envelope.v1",
    keyRef: parsed.keyRef,
    keyVersionRef: parsed.keyVersionRef,
    context,
  }));
  const aad = aadFor(context);
  if (sha256(aad) !== parsed.aadDigestSha256) throw new Error("Credential envelope AAD mismatch.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    resolution.key,
    Buffer.from(parsed.iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

export function createAes256GcmProviderCredentialEnvelopeService({
  keyResolver,
  environment = "non_production",
  versionRef = "provider-credential-envelope.v1",
  metadataPolicyVersion = "provider-account-safe.v1",
  envelopeFormatVersion = "provider-credential-envelope.aesgcm.v1",
  randomBytesFn = randomBytes,
} = {}) {
  const normalizedEnvironment = assertNonProduction(environment);
  if (typeof keyResolver !== "function") throw new TypeError("keyResolver must be a function.");
  if (typeof randomBytesFn !== "function") throw new TypeError("randomBytesFn must be a function.");

  async function sealProviderCredential(input = {}) {
    const providerKey = requiredString(input.providerKey, "providerKey");
    const providerResult = input.providerResult;
    if (!providerResult || typeof providerResult !== "object" || Array.isArray(providerResult)) {
      throw new TypeError("providerResult must be an object.");
    }
    if (!providerResult.credentials || typeof providerResult.credentials !== "object") {
      throw adapterError(
        "provider_credential_payload_missing",
        "Provider simulation did not return a credential payload to seal.",
        502,
      );
    }
    const context = Object.freeze({
      providerKey,
      tenantRef: requiredString(input.tenantRef, "tenantRef"),
      workspaceRef: requiredString(input.workspaceRef, "workspaceRef"),
      brandRef: input.brandRef || null,
      ownerScopeType: requiredString(input.ownerScopeType, "ownerScopeType"),
      ownerScopeRef: requiredString(input.ownerScopeRef, "ownerScopeRef"),
    });
    const resolution = requireKeyResolution(await keyResolver({
      purpose: "provider-credential-envelope.v1",
      context,
    }));
    const iv = randomBytesFn(12);
    if (!Buffer.isBuffer(iv) || iv.length !== 12) {
      throw new TypeError("randomBytesFn must return a 12-byte Buffer for AES-GCM IVs.");
    }
    const aad = aadFor(context);
    const cipher = createCipheriv("aes-256-gcm", resolution.key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const plaintext = Buffer.from(stableJson(providerResult.credentials), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encryptedCredentials = JSON.stringify({
      version: envelopeFormatVersion,
      algorithm: "aes-256-gcm",
      keyRef: resolution.keyRef,
      keyVersionRef: resolution.keyVersionRef,
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: tag.toString("base64url"),
      aadDigestSha256: sha256(aad),
    });
    const account = providerResult.account && typeof providerResult.account === "object"
      ? providerResult.account
      : {};
    const providerAccountRef = optionalString(
      providerResult.providerAccountRef
      || account.id
      || account.sub
      || account.account_id,
    );
    if (!providerAccountRef) {
      throw adapterError(
        "provider_account_binding_missing",
        "Provider simulation result lacks a durable account identifier.",
        409,
      );
    }
    return freeze({
      providerKey,
      encryptedCredentials,
      providerAccountRef,
      providerAccountBindingHash: sha256(`${providerKey}:${providerAccountRef}`),
      providerAccountBindingVersion: "provider-account-binding.sha256.v1",
      displayLabel: optionalString(providerResult.displayLabel) || providerKey,
      accountLabel: optionalString(providerResult.accountLabel || account.email) || providerAccountRef,
      accountMetadata: safeAccountMetadata({
        account_id: providerAccountRef,
        avatar_url: account.avatar_url,
        display_name: account.display_name || account.name,
        domain: account.domain,
        email: account.email,
        organization_id: account.organization_id,
      }),
      grantedScopes: normalizeScopes(providerResult.grantedScopes),
      tokenExpiresAt: providerResult.tokenExpiresAt || null,
    });
  }

  return Object.freeze({
    certification: freeze({
      status: "certified",
      versionRef: requiredString(versionRef, "versionRef"),
      environment: normalizedEnvironment,
      algorithm: "aes-256-gcm",
      keyRotationSupported: true,
      keyMaterialExported: false,
      secretsExcludedFromProjection: true,
      metadataPolicyVersion: requiredString(metadataPolicyVersion, "metadataPolicyVersion"),
      envelopeFormatVersion: requiredString(envelopeFormatVersion, "envelopeFormatVersion"),
      bindingHashAlgorithm: "sha-256",
      secretsIncluded: false,
    }),
    sealProviderCredential,
  });
}

export const _testingProviderConsentNonProductionAdapters = Object.freeze({
  aadFor,
  classifyProviderError,
  openEnvelopeForTest,
  safeAccountMetadata,
  sha256,
  stableJson,
});
