from __future__ import annotations

from pathlib import Path

ROUTE_INDEX = Path("http-generic-api/routes/index.js")
INTEGRATION_TEST = Path("http-generic-api/test-auth-oauth-routes.mjs")
WIRING_TEST = Path("http-generic-api/test-spec012-t031-oauth-token-route-wiring.mjs")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def update_route_index() -> None:
    text = ROUTE_INDEX.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "  app.use(buildTenantGptOAuthMetadataRoutes());\n",
        "  app.use(buildTenantGptOAuthMetadataRoutes(deps));\n",
        "runtime dependency-bearing metadata mount",
    )
    ROUTE_INDEX.write_text(text, encoding="utf-8")


def update_integration_test() -> None:
    text = INTEGRATION_TEST.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "app.use(buildTenantGptOAuthMetadataRoutes());\n",
        "app.use(buildTenantGptOAuthMetadataRoutes({ getPool: () => oauthClientPool }));\n",
        "integration metadata mount",
    )

    update_block = '''    if (sql.includes("UPDATE `tenant_gpt_oauth_authorization_codes`")) {
      const record = durableOAuthCodes.get(params[0]);
      const canConsume = record
        && record.client_id === params[1]
        && record.redirect_uri_hash === params[2]
        && record.status === "issued";
      if (canConsume) record.status = "consumed";
      return [{ affectedRows: canConsume ? 1 : 0 }];
    }
'''
    readback_block = update_block + '''    if (
      sql.includes("SELECT status, expires_at, consumed_at")
      && sql.includes("FROM `tenant_gpt_oauth_authorization_codes`")
    ) {
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
'''
    text = replace_once(
        text,
        update_block,
        readback_block,
        "authorization-code replay readback mock",
    )

    text = replace_once(
        text,
        'assert("invalid client diagnostic uses OAuth action key", invalidClientDiagnostic?.action_key === "tenant_gpt_oauth_token_exchange", JSON.stringify(invalidClientDiagnostic));',
        'assert("invalid client diagnostic uses governed OAuth v2 action key", invalidClientDiagnostic?.action_key === "tenant_gpt_oauth_token_exchange_v2", JSON.stringify(invalidClientDiagnostic));',
        "v2 diagnostic action key",
    )
    text = replace_once(
        text,
        '''  assert("invalid client diagnostic captures code timing", invalidClientDiagnostic?.runtime_evidence_json?.code_timing?.ttl_seconds === 300, JSON.stringify(invalidClientDiagnostic));
  assert("invalid client diagnostic captures code age", Number.isFinite(invalidClientDiagnostic?.runtime_evidence_json?.code_timing?.age_seconds), JSON.stringify(invalidClientDiagnostic));''',
        '''  assert("invalid client diagnostic captures bounded code expiry", Number.isFinite(invalidClientDiagnostic?.runtime_evidence_json?.code?.expires_in_seconds), JSON.stringify(invalidClientDiagnostic));
  assert("invalid client diagnostic captures code age", Number.isFinite(invalidClientDiagnostic?.runtime_evidence_json?.code?.age_seconds), JSON.stringify(invalidClientDiagnostic));''',
        "v2 diagnostic code evidence",
    )
    text = replace_once(
        text,
        '''  assert("success diagnostic captures lowercase token type", successDiagnostic?.runtime_evidence_json?.access_token?.token_type === "bearer", JSON.stringify(successDiagnostic));
  assert("success diagnostic captures token length only", successDiagnostic?.runtime_evidence_json?.access_token?.length === exchange.body.access_token.length, JSON.stringify(successDiagnostic));
  assert("success diagnostic captures activation context storage only", successDiagnostic?.runtime_evidence_json?.activation_context?.stored === true, JSON.stringify(successDiagnostic));
  assert("success diagnostic captures requested scope count only", successDiagnostic?.runtime_evidence_json?.requested_scope?.count === TENANT_SCOPE_LINKS.length, JSON.stringify(successDiagnostic));''',
        '''  assert("success diagnostic records access-token preparation only", successDiagnostic?.runtime_evidence_json?.access_token_prepared === true, JSON.stringify(successDiagnostic));
  assert("success diagnostic captures activation context storage only", successDiagnostic?.runtime_evidence_json?.activation_context?.stored === true, JSON.stringify(successDiagnostic));
  assert("success diagnostic captures atomic code consumption only", successDiagnostic?.runtime_evidence_json?.code_consumption?.consumed === true, JSON.stringify(successDiagnostic));
  assert("success diagnostic marks secrets excluded", successDiagnostic?.runtime_evidence_json?.secrets_included === false, JSON.stringify(successDiagnostic));''',
        "v2 success diagnostic evidence",
    )
    INTEGRATION_TEST.write_text(text, encoding="utf-8")


def update_wiring_test() -> None:
    text = WIRING_TEST.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'const metadataMount = routeIndex.indexOf("app.use(buildTenantGptOAuthMetadataRoutes())");',
        'const metadataMount = routeIndex.indexOf("app.use(buildTenantGptOAuthMetadataRoutes(deps))");',
        "dependency-bearing wiring assertion",
    )
    WIRING_TEST.write_text(text, encoding="utf-8")


def main() -> None:
    update_route_index()
    update_integration_test()
    update_wiring_test()


if __name__ == "__main__":
    main()
