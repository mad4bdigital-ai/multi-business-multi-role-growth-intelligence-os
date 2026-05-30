import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('routes/connectApiRoutes.js', 'utf8');

assert(source.includes('cms_site_access_grants'), 'approval route must read/update cms_site_access_grants');
assert(source.includes("WHERE claim_id = ?"), 'approval route must locate grant by claim_id');
assert(source.includes("SET status = 'active'"), 'approval route must activate approved grants');
assert(source.includes('approved_by = ?'), 'approval route must record grant approver');
assert(source.includes('grant_promotion: grantPromotion'), 'approval route must return grant promotion evidence');
assert(source.includes('secrets_included: false'), 'approval route must not return secrets');

console.log('cms claim approval grant promotion test passed');
