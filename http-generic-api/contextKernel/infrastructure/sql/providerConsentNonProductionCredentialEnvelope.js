import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const NON_PRODUCTION_ENVIRONMENTS = new Set([
  "test",
  "development",
  "staging",
  "non_production",
]);
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
  error.name = "ProviderConsentNonProductionCredentialEnvelopeError";
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
      "Credential envelope simulation cannot be constructed for Production.",
      403,
      { environment: normalized },
    );
  }
  return normalized;
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, freeze(entry)]),
  ));
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function stableJson(value) {
  const serialize = (entry) => {
    if (entry == null || typeof entry !== "object") {
      const encoded = JSON.stringify(entry);
      if (encoded === undefined) {
        throw new TypeError("Credential payload must be JSON serializable.");
      }
      return encoded;
    }
    if (Array.isArray(entry)) return `[${entry.map(serialize).join(",")}]`;
    return `{${Object.keys(entry).sort().map(
      (key) => `${JSON.stringify(key)}:${serialize(entry[key])}`,
    ).join(",")}}`;
  };
  return serialize(value);
}

function normalizeScopes(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError("grantedScopes must be an array.");
  return [...new Set(value.map(
    (scope) => requiredString(scope, "grantedScopes[]"),
  ))].sort();
}

function safeAccountMetadata(account = {}) {
  if (!account || typeof account !== "object" || Array.isArray(account)) {
    return Object.freeze({});
  }
  const result = {};
  for (const key of SAFE_ACCOUNT_METADATA_KEYS) {
    if (!Object.hasOwn(account, key)) continue;
    const value = account[key];
    if (value == null) continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    result[key] = typeof value === "string"
      ? value.trim().slice(0, 512)
      : value;
  }
  return Object.freeze(result);
}

function requireKeyResolution(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("keyResolver returned no key resolution.");
  }
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
  const parsed = JSON.parse(
    requiredString(encryptedCredentials, "encryptedCredentials"),
  );
  const resolution = requireKeyResolution(await keyResolver({
    purpose: "provider-credential-envelope.v1",
    keyRef: parsed.keyRef,
    keyVersionRef: parsed.keyVersionRef,
    context,
  }));
  if (
    resolution.keyRef !== parsed.keyRef
    || resolution.keyVersionRef !== parsed.keyVersionRef
  ) {
    throw new Error("Credential envelope key identity mismatch.");
  }
  const aad = aadFor(context);
  if (sha256(aad) !== parsed.aadDigestSha256) {
    throw new Error("Credential envelope AAD mismatch.");
  }
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
  versionRef = "provider-credential-envelope.v2",
  metadataPolicyVersion = "provider-account-safe.v1",
  envelopeFormatVersion = "provider-credential-envelope.aesgcm.v1",
  randomBytesFn = randomBytes,
} = {}) {
  const normalizedEnvironment = assertNonProduction(environment);
  if (typeof keyResolver !== "function") {
    throw new TypeError("keyResolver must be a function.");
  }
  if (typeof randomBytesFn !== "function") {
    throw new TypeError("randomBytesFn must be a function.");
  }

  async function sealProviderCredential(input = {}) {
    const providerKey = requiredString(input.providerKey, "providerKey");
    const providerResult = input.providerResult;
    if (
      !providerResult
      || typeof providerResult !== "object"
      || Array.isArray(providerResult)
    ) {
      throw new TypeError("providerResult must be an object.");
    }
    if (
      !providerResult.credentials
      || typeof providerResult.credentials !== "object"
      || Array.isArray(providerResult.credentials)
    ) {
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
      ownerScopeType: requiredString(
        input.ownerScopeType,
        "ownerScopeType",
      ),
      ownerScopeRef: requiredString(input.ownerScopeRef, "ownerScopeRef"),
    });
    const resolution = requireKeyResolution(await keyResolver({
      purpose: "provider-credential-envelope.v1",
      context,
    }));
    const iv = randomBytesFn(12);
    if (!Buffer.isBuffer(iv) || iv.length !== 12) {
      throw new TypeError(
        "randomBytesFn must return a 12-byte Buffer for AES-GCM IVs.",
      );
    }
    const aad = aadFor(context);
    const cipher = createCipheriv("aes-256-gcm", resolution.key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const plaintext = Buffer.from(
      stableJson(providerResult.credentials),
      "utf8",
    );
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
    const account = providerResult.account
      && typeof providerResult.account === "object"
      && !Array.isArray(providerResult.account)
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
      );
    }
    return freeze({
      providerKey,
      encryptedCredentials,
      providerAccountRef,
      providerAccountBindingHash: sha256(
        `${providerKey}:${providerAccountRef}`,
      ),
      providerAccountBindingVersion: "provider-account-binding.sha256.v1",
      displayLabel: optionalString(providerResult.displayLabel) || providerKey,
      accountLabel: optionalString(
        providerResult.accountLabel || account.email,
      ) || providerAccountRef,
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
      metadataPolicyVersion: requiredString(
        metadataPolicyVersion,
        "metadataPolicyVersion",
      ),
      envelopeFormatVersion: requiredString(
        envelopeFormatVersion,
        "envelopeFormatVersion",
      ),
      bindingHashAlgorithm: "sha-256",
      secretsIncluded: false,
    }),
    sealProviderCredential,
  });
}

export const _testingProviderConsentNonProductionCredentialEnvelope = Object.freeze({
  aadFor,
  openEnvelopeForTest,
  safeAccountMetadata,
  sha256,
  stableJson,
});
