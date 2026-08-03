from __future__ import annotations

import json
from pathlib import Path

ROUTE = Path('http-generic-api/routes/tenantGptOAuthTokenExchangeRoutes.js')
BINDING = Path('http-generic-api/tenantGptOAuthTokenExchangeBindingGuard.js')
INTEGRATION_TEST = Path('http-generic-api/test-auth-oauth-routes.mjs')
READINESS_TEST = Path('http-generic-api/test-spec012-t031-oauth-token-route-wiring.mjs')
E2E = Path('.changes/e2e/spec012-t031-oauth-token-route-test-parity.json')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def update_route() -> None:
    text = ROUTE.read_text(encoding='utf-8')
    text = replace_once(text, 'import jwt from "jsonwebtoken";\n', '', 'route jsonwebtoken import')
    text = replace_once(
        text,
        'import { TENANT_GPT_OAUTH_CLIENT_ID, TENANT_GPT_SCOPE } from "../tenantGptOAuthPreset.js";\n',
        'import { TENANT_GPT_OAUTH_CLIENT_ID } from "../tenantGptOAuthPreset.js";\n',
        'route OAuth preset import',
    )
    text = replace_once(
        text,
        '  TENANT_GPT_AUTHORIZATION_SERVER,\n',
        '',
        'route authorization server import',
    )
    text = replace_once(
        text,
        'const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";\n'
        'const USER_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;\n',
        '',
        'route local JWT defaults',
    )
    text = replace_once(
        text,
        'function safeCodeEvidence(code, nowMs) {\n'
        '  const raw = String(code || "");\n'
        '  if (!raw) return { present: false, decoded: false };\n'
        '  const decoded = jwt.decode(raw);\n',
        'function safeCodeEvidence(code, nowMs, decodeCode) {\n'
        '  const raw = String(code || "");\n'
        '  if (!raw) return { present: false, decoded: false };\n'
        '  const decoded = typeof decodeCode === "function" ? decodeCode(raw) : null;\n',
        'route diagnostic decoder',
    )
    start = text.index('function defaultVerifyCode(code) {\n')
    end = text.index('async function resolveActiveTokenSubject', start)
    text = text[:start] + text[end:]
    text = replace_once(
        text,
        '  const verifyCode = deps.verifyCode || defaultVerifyCode;\n'
        '  const issueAccessToken = deps.issueAccessToken || defaultIssueAccessToken;\n',
        '  const verifyCode = deps.verifyCode;\n'
        '  const issueAccessToken = deps.issueAccessToken;\n'
        '  const decodeCode = deps.decodeCode;\n'
        '  if (typeof verifyCode !== "function" || typeof issueAccessToken !== "function") {\n'
        '    const error = new Error("Governed OAuth code verification and access-token issuance dependencies are required.");\n'
        '    error.code = "oauth_token_exchange_crypto_dependencies_required";\n'
        '    throw error;\n'
        '  }\n',
        'route governed crypto dependencies',
    )
    text = replace_once(
        text,
        '      code: safeCodeEvidence(req.body?.code, startedAtMs),\n',
        '      code: safeCodeEvidence(req.body?.code, startedAtMs, decodeCode),\n',
        'route safe code evidence call',
    )
    ROUTE.write_text(text, encoding='utf-8')


def update_binding() -> None:
    text = BINDING.read_text(encoding='utf-8')
    anchor = '  const injectedIssueAccessToken = typeof deps.issueAccessToken === "function" ? deps.issueAccessToken : null;\n'
    text = replace_once(
        text,
        anchor,
        anchor + '  const decodeCode = typeof deps.decodeCode === "function" ? deps.decodeCode : ((code) => jwt.decode(String(code || "")));\n',
        'binding diagnostic decoder',
    )
    text = replace_once(
        text,
        '    issueAccessToken,\n',
        '    issueAccessToken,\n    decodeCode,\n',
        'binding dependency return',
    )
    BINDING.write_text(text, encoding='utf-8')


def update_integration_test() -> None:
    text = INTEGRATION_TEST.read_text(encoding='utf-8')
    text = replace_once(
        text,
        'app.use(buildTenantGptOAuthMetadataRoutes());\n',
        'app.use(buildTenantGptOAuthMetadataRoutes({ getPool: () => oauthClientPool }));\n',
        'integration metadata route dependencies',
    )
    INTEGRATION_TEST.write_text(text, encoding='utf-8')


def update_readiness_test() -> None:
    text = READINESS_TEST.read_text(encoding='utf-8')
    anchor = 'assert.match(route, /router\\.post\\("\\/auth\\/oauth\\/token"/u);\n'
    addition = '''assert.doesNotMatch(route, /from ["']jsonwebtoken["']/u,
  "route must not import a local JWT implementation");
assert.doesNotMatch(route, /development_fallback_secret_only/u,
  "route must not contain a local JWT fallback secret");
assert.doesNotMatch(route, /defaultVerifyCode|defaultIssueAccessToken/u,
  "route must require governed crypto dependencies from the binding layer");
assert.match(route, /oauth_token_exchange_crypto_dependencies_required/u);
assert.match(bindingGuard, /decodeCode/u,
  "binding layer must provide bounded diagnostic code decoding");
'''
    text = replace_once(text, anchor, anchor + addition, 'readiness governed crypto assertions')
    READINESS_TEST.write_text(text, encoding='utf-8')


def write_e2e() -> None:
    payload = {
        '$schema': '../../.specify/schemas/e2e-phases.schema.json',
        'schema_version': 1,
        'feature_key': 'spec012-t031-oauth-token-route-test-parity',
        'title': 'Spec 012 T031 governed token route dependency and integration parity',
        'delivery_mode': 'single_pr',
        'current_phase': 'mvp',
        'scope': {
            'include': [
                '.changes/e2e/spec012-t031-oauth-token-route-test-parity.json',
                'http-generic-api/routes/tenantGptOAuthTokenExchangeRoutes.js',
                'http-generic-api/tenantGptOAuthTokenExchangeBindingGuard.js',
                'http-generic-api/test-auth-oauth-routes.mjs',
                'http-generic-api/test-spec012-t031-oauth-token-route-wiring.mjs',
            ],
        },
        'merge_contract': {'minimum_phase': 'mvp'},
        'phases': [{
            'id': 'mvp',
            'status': 'implemented',
            'objective': (
                'Keep POST /auth/oauth/token on the governed T031 handler while requiring fail-closed crypto dependencies '
                'from the binding layer and preserving the legacy integration test harness through the same injected pool.'
            ),
            'e2e_journeys': [{
                'id': 'metadata-mount-to-governed-token-exchange',
                'end_to_end': True,
                'level': 'synthetic_runtime',
                'actor': 'Tenant GPT OAuth integration reviewer',
                'entrypoint': 'The metadata router mounted before the legacy auth router with an injected test pool',
                'terminal_outcome': (
                    'Invalid client and resource requests retain their OAuth errors, a valid authorization code returns a fresh '
                    'access token and diagnostics, and the governed route contains no local JWT fallback or legacy bypass.'
                ),
                'steps': [
                    'Mount the metadata router before the legacy auth router with the bounded integration-test pool.',
                    'Resolve verification, access-token issuance, and diagnostic decoding through the governed binding layer.',
                    'Exercise invalid-client, invalid-target, successful exchange, activation context, and diagnostic behavior.',
                    'Verify the legacy handler is not reached for POST /auth/oauth/token and no secret or raw token is logged.',
                ],
                'assertions': [
                    'The route requires injected verifyCode and issueAccessToken dependencies and fails closed when they are absent.',
                    'The route does not import jsonwebtoken or contain a development fallback secret.',
                    'The metadata integration test uses the same mock pool for client validation, active subject checks, code consumption, and diagnostics.',
                    'Successful and rejected exchanges preserve their documented OAuth status and error semantics.',
                    'No deployment, provider, database, migration, credential, Production, protected-ref, or external business mutation is performed.',
                ],
                'tests': [
                    {'id': 'auth-oauth-routes-integration', 'runner': 'node', 'working_directory': 'http-generic-api', 'path': 'test-auth-oauth-routes.mjs', 'args': []},
                    {'id': 't031-token-route', 'runner': 'node', 'working_directory': 'http-generic-api', 'path': 'test-tenant-gpt-oauth-token-exchange-routes.mjs', 'args': []},
                    {'id': 't031-route-wiring', 'runner': 'node', 'working_directory': 'http-generic-api', 'path': 'test-spec012-t031-oauth-token-route-wiring.mjs', 'args': []},
                ],
                'evidence_paths': [
                    '.changes/e2e/spec012-t031-oauth-token-route-test-parity.json',
                    'http-generic-api/routes/tenantGptOAuthTokenExchangeRoutes.js',
                    'http-generic-api/tenantGptOAuthTokenExchangeBindingGuard.js',
                    'http-generic-api/test-auth-oauth-routes.mjs',
                    'http-generic-api/test-spec012-t031-oauth-token-route-wiring.mjs',
                ],
            }],
        }],
    }
    E2E.parent.mkdir(parents=True, exist_ok=True)
    E2E.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def main() -> None:
    update_route()
    update_binding()
    update_integration_test()
    update_readiness_test()
    write_e2e()


if __name__ == '__main__':
    main()
