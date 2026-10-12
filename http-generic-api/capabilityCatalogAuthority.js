import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";

export const CATALOG_RECEIPT_CONTRACT = "mad4b.source-catalog-attestation.v1";
export const CATALOG_CONTRACT = "mad4b.site-source-catalog.v1";
export const CATALOG_KEY_PURPOSE = "capability.catalog.attestation";

const ID = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const SHA = /^[a-f0-9]{64}$/;
const ENV = new Set(["development", "local", "staging", "production"]);
const KINDS = new Set(["connector", "skill", "external_service", "operator"]);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const obj = x => x !== null && typeof x === "object" && !Array.isArray(x);
const invalid = code => { throw Object.assign(new Error(code), { code }); };
const int = x => Number.isSafeInteger(x) && x >= 0;

export function canonicalCatalogJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalCatalogJson).join(",") + "]";
  if (!obj(value) || Object.keys(value).some(k => ["__proto__", "prototype", "constructor"].includes(k)))
    invalid("UNSAFE_CANONICAL_VALUE");
  return "{" + Object.keys(value).sort().map(k =>
    JSON.stringify(k) + ":" + canonicalCatalogJson(value[k])).join(",") + "}";
}
const hash = value => createHash("sha256").update(canonicalCatalogJson(value), "utf8").digest("hex");
const safeSite = x => obj(x) && ID.test(x.tenant_id ?? "") && ID.test(x.site_id ?? "") &&
  ENV.has(x.environment) && SHA.test(x.origin_sha256 ?? "") &&
  SHA.test(x.runtime_generation ?? "") &&
  (!own(x, "profile_digest") || SHA.test(x.profile_digest ?? ""));
const equalSite = (a, b) => safeSite(a) && safeSite(b) &&
  ["tenant_id", "site_id", "environment", "origin_sha256",
    "runtime_generation", "profile_digest"].every(k => (a[k] ?? null) === (b[k] ?? null));

function normalizeSources(sources, site) {
  if (!Array.isArray(sources) || sources.length > 32) invalid("CATALOG_SOURCE_BUDGET");
  const seen = new Set();
  const out = [];
  for (const row of sources) {
    if (!obj(row) || !ID.test(row.id ?? "") || !KINDS.has(row.kind) ||
      row.connected !== true || row.read_authorized !== true || row.lane !== "read" ||
      !equalSite(row, site) || seen.has(row.id) ||
      row.authorizing === true || row.execution_allowed === true)
      invalid("CATALOG_UNTRUSTED_SOURCE");
    seen.add(row.id);
    // Projection contains only bounded, non-secret descriptors. Capabilities
    // are separately inspected/certified; no endpoint, credential or URL here.
    out.push({
      id: row.id, kind: row.kind, ...site,
      connected: true, read_authorized: true, lane: "read",
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function validKey(k, site, now, expiration) {
  if (!obj(k) || k.purpose !== CATALOG_KEY_PURPOSE || k.status !== "active" ||
      !ID.test(k.kid ?? "") || !ID.test(k.issuer ?? "") || !equalSite(k.site, site) ||
      !int(k.not_before) || !int(k.not_after) || k.not_before > now ||
      k.not_after < expiration || typeof k.public_key_pem !== "string" ||
      typeof k.sign !== "function" || k.revoked !== false)
    invalid("CATALOG_SIGNER_NOT_ENROLLED");
  let key;
  try { key = createPublicKey(k.public_key_pem); } catch { invalid("CATALOG_SIGNING_KEY_INVALID"); }
  if (key.asymmetricKeyType !== "ed25519") invalid("CATALOG_SIGNING_ALGORITHM_INVALID");
  return key;
}

/**
 * Non-authorizing issuer. All three injected providers must belong to the
 * authenticated server composition, NOT to the caller, WordPress or a tool
 * descriptor. Nothing here provisions grants, executes providers or writes sites.
 */
export function createCentralCatalogIssuer({
  getAuthorizedSite, listAuthorizedSources, getSiteSigningKey,
  clock = () => Math.floor(Date.now() / 1000), nonce = () => randomBytes(24).toString("base64url")
} = {}) {
  if (![getAuthorizedSite, listAuthorizedSources, getSiteSigningKey, clock, nonce]
    .every(x => typeof x === "function")) invalid("SERVER_MANAGED_DEPENDENCIES_MISSING");
  return Object.freeze({
    async issue({ principal, site_id } = {}) {
      if (!ID.test(site_id ?? "") || !obj(principal)) invalid("INVALID_ISSUER_REQUEST");
      // getAuthorizedSite resolves identity from authenticated principal and
      // server-managed tenancy; caller-provided tenant/environment are ignored.
      const claimedSite = await getAuthorizedSite({ principal, site_id });
      if (!safeSite(claimedSite) || claimedSite.site_id !== site_id)
        invalid("SITE_AUTHORITY_MISSING");
      // Never serialize unrelated fields accidentally returned by a profile
      // reader (tokens, credentials, user PII or host internals).
      const { tenant_id, environment, origin_sha256, runtime_generation,
        profile_digest } = claimedSite;
      const site = Object.freeze({
        tenant_id, site_id, environment, origin_sha256, runtime_generation,
        ...(profile_digest ? { profile_digest } : {})
      });
      const observed = await listAuthorizedSources({ site, principal });
      if (!obj(observed) || observed.complete !== true ||
        observed.authoritative !== true || !equalSite(observed.site, site))
        invalid("CATALOG_COVERAGE_NOT_PROVEN");
      const sources = normalizeSources(observed.sources, site);
      const catalog = {
        contract: CATALOG_CONTRACT, binding: { ...site },
        read_only: true, authorizing: false, complete: true, sources,
      };
      const now = clock();
      if (!int(now) || now < 1000000000) invalid("ISSUER_CLOCK_UNTRUSTED");
      const expires = now + 120;
      const key = await getSiteSigningKey({ site, purpose: CATALOG_KEY_PURPOSE });
      const publicKey = validKey(key, site, now, expires);
      const singleNonce = nonce();
      if (typeof singleNonce !== "string" || !/^[A-Za-z0-9_-]{16,96}$/.test(singleNonce))
        invalid("ISSUER_NONCE_INVALID");
      const body = {
        contract: CATALOG_RECEIPT_CONTRACT, issuer: key.issuer, site: { ...site },
        source_ids: sources.map(s => s.id), complete: true,
        catalog_sha256: hash(catalog), nonce: singleNonce,
        issued_at: now, expires_at: expires, lane: "read",
      };
      const encoded = canonicalCatalogJson(body);
      const raw = await key.sign(Buffer.from(encoded, "utf8"));
      const signature = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (signature.length !== 64 ||
        !cryptoVerify(null, Buffer.from(encoded, "utf8"), publicKey, signature))
        invalid("CATALOG_SIGNER_SELF_CHECK_FAILED");
      return Object.freeze({
        catalog, receipt: Object.freeze({
          contract: CATALOG_RECEIPT_CONTRACT, kid: key.kid, body: encoded,
          signature_b64url: signature.toString("base64url"),
        }),
        authorizing: false, execution_allowed: false,
      });
    },
  });
}

/** Read-only public trust projection. Never returns signer or private key. */
export function publicCatalogTrust(keyRecord, site) {
  if (!safeSite(site) || !obj(keyRecord) || keyRecord.purpose !== CATALOG_KEY_PURPOSE ||
    !equalSite(keyRecord.site, site) || !ID.test(keyRecord.kid ?? "") ||
    !ID.test(keyRecord.issuer ?? "") || typeof keyRecord.public_key_pem !== "string")
    invalid("PUBLIC_TRUST_SCOPE_INVALID");
  return Object.freeze({
    kid: keyRecord.kid, issuer: keyRecord.issuer, site: { ...site },
    public_key_pem: keyRecord.public_key_pem,
    not_before: keyRecord.not_before, not_after: keyRecord.not_after,
    revoked: keyRecord.revoked, purpose: CATALOG_KEY_PURPOSE,
  });
}
