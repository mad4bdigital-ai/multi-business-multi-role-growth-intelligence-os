from pathlib import Path


def replace_once(path, old, new):
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one old expression, found {count}")
    if new in text:
        raise SystemExit(f"{path}: replacement already present before authorized patch")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "http-generic-api/routes/index.js",
    "app.use(buildTenantGptOAuthMetadataRoutes());",
    "app.use(buildTenantGptOAuthMetadataRoutes(deps));",
)
replace_once(
    "http-generic-api/test-auth-oauth-routes.mjs",
    "app.use(buildTenantGptOAuthMetadataRoutes());",
    "app.use(buildTenantGptOAuthMetadataRoutes({ getPool: () => oauthClientPool }));",
)
replace_once(
    "http-generic-api/test-spec012-t031-oauth-token-route-wiring.mjs",
    'const metadataMount = routeIndex.indexOf("app.use(buildTenantGptOAuthMetadataRoutes())");',
    'const metadataMount = routeIndex.indexOf("app.use(buildTenantGptOAuthMetadataRoutes(deps))");',
)

old_update = '''    if (sql.includes("UPDATE `tenant_gpt_oauth_authorization_codes`")) {
      const record = durableOAuthCodes.get(params[0]);
      const canConsume = record
        && record.client_id === params[1]
        && record.redirect_uri_hash === params[2]
        && record.status === "issued";
      if (canConsume) record.status = "consumed";
      return [{ affectedRows: canConsume ? 1 : 0 }];
    }
    if (sql.includes("INSERT INTO `execution_log`")) {'''
new_update = '''    if (sql.includes("UPDATE `tenant_gpt_oauth_authorization_codes`")) {
      const record = durableOAuthCodes.get(params[0]);
      const canConsume = record
        && record.client_id === params[1]
        && record.redirect_uri_hash === params[2]
        && record.status === "issued";
      if (canConsume) record.status = "consumed";
      return [{ affectedRows: canConsume ? 1 : 0 }];
    }
    if (sql.includes("SELECT status, expires_at, consumed_at")) {
      const record = durableOAuthCodes.get(params[2]);
      if (!record) return [[]];
      return [[{
        status: record.status,
        expires_at: new Date(Date.now() + 300_000),
        consumed_at: record.status === "consumed" ? new Date() : null,
        client_matches: record.client_id === params[0] ? 1 : 0,
        redirect_matches: record.redirect_uri_hash === params[1] ? 1 : 0,
        expired_by_store: 0,
      }]];
    }
    if (sql.includes("INSERT INTO `execution_log`")) {'''
replace_once("http-generic-api/test-auth-oauth-routes.mjs", old_update, new_update)

replacements = [
    (
        'assert("invalid client diagnostic uses OAuth action key", invalidClientDiagnostic?.action_key === "tenant_gpt_oauth_token_exchange", JSON.stringify(invalidClientDiagnostic));',
        'assert("invalid client diagnostic uses OAuth action key", invalidClientDiagnostic?.action_key === "tenant_gpt_oauth_token_exchange_v2", JSON.stringify(invalidClientDiagnostic));',
    ),
    (
        'assert("invalid client diagnostic captures code timing", invalidClientDiagnostic?.runtime_evidence_json?.code_timing?.ttl_seconds === 300, JSON.stringify(invalidClientDiagnostic));',
        'assert("invalid client diagnostic captures code timing", invalidClientDiagnostic?.runtime_evidence_json?.code?.expires_in_seconds === 300, JSON.stringify(invalidClientDiagnostic));',
    ),
    (
        'assert("invalid client diagnostic captures code age", Number.isFinite(invalidClientDiagnostic?.runtime_evidence_json?.code_timing?.age_seconds), JSON.stringify(invalidClientDiagnostic));',
        'assert("invalid client diagnostic captures code age", Number.isFinite(invalidClientDiagnostic?.runtime_evidence_json?.code?.age_seconds), JSON.stringify(invalidClientDiagnostic));',
    ),
    (
        'assert("success diagnostic captures lowercase token type", successDiagnostic?.runtime_evidence_json?.access_token?.token_type === "bearer", JSON.stringify(successDiagnostic));',
        'assert("success diagnostic marks access token prepared", successDiagnostic?.runtime_evidence_json?.access_token_prepared === true, JSON.stringify(successDiagnostic));',
    ),
    (
        'assert("success diagnostic captures token length only", successDiagnostic?.runtime_evidence_json?.access_token?.length === exchange.body.access_token.length, JSON.stringify(successDiagnostic));',
        'assert("success diagnostic excludes access token metadata", !Object.prototype.hasOwnProperty.call(successDiagnostic?.runtime_evidence_json || {}, "access_token"), JSON.stringify(successDiagnostic));',
    ),
    (
        'assert("success diagnostic captures requested scope count only", successDiagnostic?.runtime_evidence_json?.requested_scope?.count === TENANT_SCOPE_LINKS.length, JSON.stringify(successDiagnostic));',
        'assert("success diagnostic excludes requested scope details", !Object.prototype.hasOwnProperty.call(successDiagnostic?.runtime_evidence_json || {}, "requested_scope"), JSON.stringify(successDiagnostic));',
    ),
]
for old, new in replacements:
    replace_once("http-generic-api/test-auth-oauth-routes.mjs", old, new)

trigger = Path(".changes/probes/oauth-dependency-composition-writer-a61cd9e8-v2.txt")
if not trigger.is_file():
    raise SystemExit("authorization trigger missing")
trigger.unlink()
