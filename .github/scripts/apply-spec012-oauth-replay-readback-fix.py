from pathlib import Path

INTEGRATION_TEST = Path('http-generic-api/test-auth-oauth-routes.mjs')
READINESS_TEST = Path('http-generic-api/test-spec012-t031-oauth-token-route-wiring.mjs')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def update_integration_test() -> None:
    text = INTEGRATION_TEST.read_text(encoding='utf-8')
    text = replace_once(
        text,
        '''      durableOAuthCodes.set(params[0], {
        client_id: params[3],
        redirect_uri_hash: params[4],
        status: "issued",
      });
''',
        '''      durableOAuthCodes.set(params[0], {
        client_id: params[3],
        redirect_uri_hash: params[4],
        status: "issued",
        expires_at: params[5],
        consumed_at: null,
      });
''',
        'authorization-code insert mock',
    )
    text = replace_once(
        text,
        '''      if (canConsume) record.status = "consumed";
      return [{ affectedRows: canConsume ? 1 : 0 }];
    }
    if (sql.includes("INSERT INTO `execution_log`")) {
''',
        '''      if (canConsume) {
        record.status = "consumed";
        record.consumed_at = new Date();
      }
      return [{ affectedRows: canConsume ? 1 : 0 }];
    }
    if (sql.includes("FROM `tenant_gpt_oauth_authorization_codes`")) {
      const record = durableOAuthCodes.get(params[2]);
      if (!record) return [[]];
      return [[{
        status: record.status,
        expires_at: record.expires_at,
        consumed_at: record.consumed_at,
        client_matches: record.client_id === params[0] ? 1 : 0,
        redirect_matches: record.redirect_uri_hash === params[1] ? 1 : 0,
        expired_by_store: 0,
      }]];
    }
    if (sql.includes("INSERT INTO `execution_log`")) {
''',
        'authorization-code replay readback mock',
    )
    INTEGRATION_TEST.write_text(text, encoding='utf-8')


def update_readiness_test() -> None:
    text = READINESS_TEST.read_text(encoding='utf-8')
    text = replace_once(
        text,
        '''assert.doesNotMatch(route, /access_token:\\s*event/u,
  "diagnostics must not attach an access token");
''',
        '''assert.match(route, /access_token:\\s*event\\.access_token \\|\\| null/u,
  "diagnostics may attach only the bounded access-token evidence object");
assert.match(route, /tokenLogContext\\.access_token = \\{[\\s\\S]*token_type: "bearer"[\\s\\S]*length: String\\(accessToken \\|\\| ""\\)\\.length[\\s\\S]*secrets_included: false/u,
  "access-token diagnostics must contain only token type, length, and the no-secret marker");
assert.doesNotMatch(route, /tokenLogContext\\.access_token\\s*=\\s*accessToken/u,
  "diagnostics must never attach the raw access token");
''',
        'bounded access-token diagnostic assertion',
    )
    READINESS_TEST.write_text(text, encoding='utf-8')


def main() -> None:
    update_integration_test()
    update_readiness_test()


if __name__ == '__main__':
    main()
