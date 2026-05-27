import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('migrations/144_sprint65_cloak_browser_candidate.sql', 'utf8');

assert(migration.includes('cloak_browser_candidate_v1'), 'migration must seed CloakBrowser runtime candidate');
assert(migration.includes('cloak_browser_stealth_public_extraction_candidate'), 'migration must seed CloakBrowser candidate binding');
assert(migration.includes("'cloakbrowser'"), 'provider must be cloakbrowser');
assert(migration.includes("'stealth_public_extraction'"), 'capability/use-case must classify stealth public extraction');
assert(migration.includes("'candidate_under_review'"), 'runtime must remain candidate-only until reviewed');
assert(migration.includes("'planned'"), 'binding must remain planned until reviewed');
assert(migration.includes('https://github.com/CloakHQ/CloakBrowser'), 'migration must retain source repository URL');
assert(migration.includes('playwright_api_compatible'), 'candidate capabilities must include Playwright compatibility');
assert(migration.includes('puppeteer_api_compatible'), 'candidate capabilities must include Puppeteer compatibility');
assert(migration.includes('binary_trust_review_required'), 'candidate must require binary trust review');
assert(migration.includes('proxy_policy_review_required'), 'candidate must require proxy policy review');
assert(migration.includes('not_for_credentials_by_default'), 'candidate must not be used for credentials by default');
assert(migration.includes('candidate_only'), 'binding policy must mark candidate_only');
assert(migration.includes('credentialed_login'), 'binding policy must block credentialed login by default');
assert(migration.includes('session_reuse'), 'binding policy must block session reuse by default');
assert(migration.includes('payment_or_checkout_submit'), 'binding policy must block checkout/payment flows');
assert(migration.includes('captcha_solving_service'), 'binding policy must block CAPTCHA-solving service use');
assert(migration.includes('domain_allowlist_required'), 'binding policy must require domain allowlist');
assert(migration.includes('no_cookie_token_echo'), 'binding policy must forbid cookie/token echo');

console.log('cloak browser runtime candidate migration tests passed');
