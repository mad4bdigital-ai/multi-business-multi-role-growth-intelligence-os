import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const routePath = 'http-generic-api/routes/tenantGptOAuthTokenExchangeRoutes.js';
const bindingPath = 'http-generic-api/tenantGptOAuthTokenExchangeBindingGuard.js';
const showMain = path => execFileSync('git', ['show', `origin/main:${path}`], { encoding: 'utf8' });
const replaceOnce = (source, before, after, label) => {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(before, after);
};

let route = showMain(routePath);
route = replaceOnce(
  route,
  'import { getPool } from "../db.js";\n',
  'import { getPool } from "../db.js";\nimport {\n  resolveTenantGptAccessTokenTtlSeconds,\n  validateTenantGptAccessTokenTtlSeconds,\n} from "../tenantGptAccessTokenProfile.js";\n',
  'route profile import',
);
route = replaceOnce(
  route,
  'import { TENANT_GPT_OAUTH_CLIENT_ID } from "../tenantGptOAuthPreset.js";\n',
  '',
  'route unused preset import',
);
route = replaceOnce(
  route,
  'const USER_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;\n',
  '',
  'route legacy ttl constant',
);
route = replaceOnce(
  route,
  '      resource_profile: event.resource_profile || null,\n      subject_prevalidated: event.subject_prevalidated === true,\n',
  '      resource_profile: event.resource_profile || null,\n      bearer_profile: event.bearer_profile || null,\n      subject_prevalidated: event.subject_prevalidated === true,\n',
  'route diagnostic bearer profile',
);
route = replaceOnce(
  route,
  '  const now = deps.now || (() => Date.now());\n\n  router.post',
  '  const now = deps.now || (() => Date.now());\n  const accessTokenTtlSeconds = deps.accessTokenTtlSeconds === undefined\n    ? resolveTenantGptAccessTokenTtlSeconds(deps.env || process.env)\n    : validateTenantGptAccessTokenTtlSeconds(deps.accessTokenTtlSeconds);\n\n  router.post',
  'route governed ttl resolution',
);
route = replaceOnce(
  route,
  '      client: safeClientEvidence(oauthClientCredentials(req)),\n    };\n',
  '      client: safeClientEvidence(oauthClientCredentials(req)),\n      bearer_profile: {\n        ttl_seconds: accessTokenTtlSeconds,\n        issuer_claim_required: true,\n        audience_claim_required: true,\n        subject_claim_required: true,\n        expiry_claim_required: true,\n        user_claim_required: true,\n        tenant_claim_required: true,\n        short_lived: true,\n        secrets_included: false,\n      },\n    };\n',
  'route request bearer profile',
);
const legacyTtlUses = (route.match(/USER_TOKEN_TTL_SECONDS/g) || []).length;
if (legacyTtlUses !== 3) throw new Error(`route ttl uses: expected 3, found ${legacyTtlUses}`);
route = route.replaceAll('USER_TOKEN_TTL_SECONDS', 'accessTokenTtlSeconds');

for (const required of [
  'const decodeCode = deps.decodeCode;',
  'oauth_token_exchange_crypto_dependencies_required',
  'code: safeCodeEvidence(req.body?.code, startedAtMs, decodeCode)',
  'access_token: event.access_token || null',
  'requested_scope: event.requested_scope || null',
  'tokenLogContext.access_token = {',
  'tokenLogContext.requested_scope = {',
  'expires_in: accessTokenTtlSeconds',
]) {
  if (!route.includes(required)) throw new Error(`route missing reconciled contract: ${required}`);
}
if (route.includes('from "jsonwebtoken"') || route.includes('USER_TOKEN_TTL_SECONDS')) {
  throw new Error('route retained forbidden local crypto or legacy ttl');
}

let binding = showMain(bindingPath);
binding = replaceOnce(
  binding,
  'import jwt from "jsonwebtoken";\n',
  'import jwt from "jsonwebtoken";\nimport {\n  resolveTenantGptAccessTokenTtlSeconds,\n} from "./tenantGptAccessTokenProfile.js";\n',
  'binding profile import',
);
binding = replaceOnce(
  binding,
  'export function buildTenantGptOAuthTokenExchangeDeps(deps = {}, env = deps.env || process.env) {\n',
  'export function buildTenantGptOAuthTokenExchangeDeps(deps = {}, env = deps.env || process.env) {\n  const accessTokenTtlSeconds = resolveTenantGptAccessTokenTtlSeconds(env);\n',
  'binding ttl resolution',
);
binding = replaceOnce(
  binding,
  '  const issueAccessToken = injectedIssueAccessToken || ((payload, options = {}) => issueTenantGptAccessToken(\n    payload,\n    { ...options, jwtSecret: requireJwtSecret(env) },\n  ));\n',
  '  const issueAccessToken = injectedIssueAccessToken || ((payload, options = {}) => issueTenantGptAccessToken(\n    payload,\n    {\n      ...options,\n      expiresIn: accessTokenTtlSeconds,\n      jwtSecret: requireJwtSecret(env),\n    },\n  ));\n',
  'binding governed issuer ttl',
);
binding = replaceOnce(
  binding,
  '  return {\n    ...deps,\n    verifyCode(code) {\n',
  '  return {\n    ...deps,\n    env,\n    accessTokenTtlSeconds,\n    verifyCode(code) {\n',
  'binding exported ttl',
);
for (const required of [
  'const decodeCode = typeof deps.decodeCode === "function"',
  'expiresIn: accessTokenTtlSeconds',
  'accessTokenTtlSeconds,',
  'decodeCode,',
]) {
  if (!binding.includes(required)) throw new Error(`binding missing reconciled contract: ${required}`);
}

fs.writeFileSync(routePath, route);
fs.writeFileSync(bindingPath, binding);
