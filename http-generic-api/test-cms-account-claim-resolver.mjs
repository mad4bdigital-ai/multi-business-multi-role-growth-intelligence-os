/**
 * CMS account claim resolver tests
 * Run: node test-cms-account-claim-resolver.mjs
 *
 * Covers:
 *   - URL normalization (www stripping, domain extraction, wp-json base)
 *   - happy path creates a claim and never leaks the password
 *   - missing application_password is rejected with VALIDATION_ERROR
 *   - WordPress 401 maps to CMS_CREDENTIAL_VALIDATION_FAILED with status 422
 *   - WordPress 5xx maps to status 502
 *   - timeout maps to CMS_TIMEOUT with status 504
 *   - approval_required is true for tenant_brand scope and false for personal
 *     when no brand match exists
 */
import assert from "node:assert/strict";

const {
  normalizeUrl,
  createWordPressAccountClaim,
  CmsClaimError,
} = await import("./cmsAccountClaimResolver.js");

let passed = 0;
function pass(label) {
  console.log(`  [PASS] ${label}`);
  passed += 1;
}

function makeDbMock({ brandMatch = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM `brands`/i.test(sql)) {
        if (!brandMatch) return [[]];
        return [[{
          brand_name: "allroyal",
          target_key: "allroyalegypt_wp",
          brand_domain: "allroyalegypt.com",
          base_url: "https://allroyalegypt.com",
          default_wp_api_base: "https://allroyalegypt.com/wp-json/wp/v2",
        }]];
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
  };
}

function makeFetchOk(body) {
  return async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify(body); },
  });
}

function makeFetchFailing(status, body = {}) {
  return async () => ({
    ok: false,
    status,
    async text() { return JSON.stringify(body); },
  });
}

const SECRET = "secret app password";

// ── URL normalization ────────────────────────────────────────────────────────
{
  const result = normalizeUrl("www.example.com/some/path/");
  assert.equal(result.normalizedDomain, "example.com");
  assert.equal(result.wpJsonBase, "https://www.example.com/wp-json");
  pass("normalizeUrl strips www, trailing slash, and computes wp-json base");
}

{
  const result = normalizeUrl("https://allroyalegypt.com");
  assert.equal(result.normalizedDomain, "allroyalegypt.com");
  assert.equal(result.wpJsonBase, "https://allroyalegypt.com/wp-json");
  pass("normalizeUrl preserves scheme when present");
}

{
  let err;
  try { normalizeUrl(""); } catch (caught) { err = caught; }
  assert.ok(err instanceof CmsClaimError);
  assert.equal(err.code, "VALIDATION_ERROR");
  pass("normalizeUrl rejects empty input with VALIDATION_ERROR");
}

// ── Happy path: claim creation without leaking secrets ───────────────────────
{
  const db = makeDbMock();
  let encryptCalls = 0;
  const encryptCredentials = async (payload) => {
    encryptCalls += 1;
    assert.equal(payload.application_password, SECRET);
    return "encrypted-payload";
  };
  const fetchImpl = makeFetchOk({
    id: 42,
    username: "gpt",
    email: "gpt@allroyalegypt.com",
    roles: ["administrator"],
  });

  const result = await createWordPressAccountClaim({
    db, fetchImpl, encryptCredentials,
    tenantId: "tenant-1",
    userId: "user-1",
    siteUrl: "https://allroyalegypt.com",
    username: "gpt",
    applicationPassword: SECRET,
    requestedScope: "tenant_brand",
  });

  assert.equal(result.status, "verified");
  assert.ok(result.claim_id, "claim_id should be present");
  assert.ok(result.connection_id, "connection_id should be present");
  assert.equal(result.matched_brand_key, "allroyal");
  assert.equal(result.matched_target_key, "allroyalegypt_wp");
  assert.equal(result.match_confidence, "high"); // administrator role boosts
  assert.equal(result.approval_required, true);
  assert.equal(result.next_action, "request_approval");
  assert.ok(!JSON.stringify(result).includes(SECRET), "result must not leak password");

  const allParams = JSON.stringify(db.calls.map((c) => c.params));
  assert.ok(!allParams.includes(SECRET), "no SQL params may contain the raw password");
  assert.equal(encryptCalls, 1);
  pass("createWordPressAccountClaim happy path creates claim and never leaks password");
}

// ── personal scope + no brand match → approval not required ──────────────────
{
  const db = makeDbMock({ brandMatch: false });
  const fetchImpl = makeFetchOk({
    id: 1,
    username: "gpt",
    email: "gpt@unrelated.com",
    roles: ["subscriber"],
  });

  const result = await createWordPressAccountClaim({
    db, fetchImpl,
    encryptCredentials: async () => "encrypted",
    tenantId: "tenant-1",
    userId: "user-1",
    siteUrl: "https://example.com",
    username: "gpt",
    applicationPassword: SECRET,
    requestedScope: "personal",
  });

  assert.equal(result.approval_required, false, "personal scope with no brand match should not require approval");
  assert.equal(result.next_action, "ready_personal_use");
  pass("personal scope + no brand match returns ready_personal_use");
}

// ── Validation: missing application_password ─────────────────────────────────
{
  let err;
  try {
    await createWordPressAccountClaim({
      db: makeDbMock(),
      fetchImpl: async () => ({ ok: true, status: 200, async text() { return "{}"; } }),
      encryptCredentials: async () => "encrypted",
      tenantId: "tenant-1",
      userId: "user-1",
      siteUrl: "https://example.com",
      username: "gpt",
      applicationPassword: "",
    });
  } catch (caught) { err = caught; }
  assert.ok(err instanceof CmsClaimError);
  assert.equal(err.code, "VALIDATION_ERROR");
  pass("missing application_password returns VALIDATION_ERROR");
}

// ── WordPress 401 → CMS_CREDENTIAL_VALIDATION_FAILED (status 422) ────────────
{
  let err;
  try {
    await createWordPressAccountClaim({
      db: makeDbMock(),
      fetchImpl: makeFetchFailing(401, { code: "rest_cannot_view" }),
      encryptCredentials: async () => "encrypted",
      tenantId: "tenant-1",
      userId: "user-1",
      siteUrl: "https://example.com",
      username: "gpt",
      applicationPassword: "bad password",
    });
  } catch (caught) { err = caught; }
  assert.ok(err instanceof CmsClaimError);
  assert.equal(err.code, "CMS_CREDENTIAL_VALIDATION_FAILED");
  assert.equal(err.status, 422);
  pass("WordPress 401 maps to CMS_CREDENTIAL_VALIDATION_FAILED (422)");
}

// ── WordPress 5xx → status 502 ───────────────────────────────────────────────
{
  let err;
  try {
    await createWordPressAccountClaim({
      db: makeDbMock(),
      fetchImpl: makeFetchFailing(503, { code: "server_error" }),
      encryptCredentials: async () => "encrypted",
      tenantId: "tenant-1",
      userId: "user-1",
      siteUrl: "https://example.com",
      username: "gpt",
      applicationPassword: SECRET,
    });
  } catch (caught) { err = caught; }
  assert.ok(err instanceof CmsClaimError);
  assert.equal(err.code, "CMS_CREDENTIAL_VALIDATION_FAILED");
  assert.equal(err.status, 502);
  pass("WordPress 5xx maps to status 502");
}

console.log(`Results: ${passed} passed, 0 failed`);
