import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('routes/connectorProxyRoutes.js', 'utf8');

assert(source.includes('status === 403 && errorCode === "DISABLED"'), 'connector proxy must special-case disabled optional capabilities');
assert(source.includes('connector_capability_status: "disabled"'), 'disabled capability responses must be labeled explicitly');
assert(source.includes('await markRouteSuccess(route);'), 'disabled capability should keep the route healthy because the connector was reachable');
assert(source.includes('Optional break-glass capabilities such as /ps or /win'), 'source should document why /ps disabled is not an auth failure');
assert(source.indexOf('status === 403 && errorCode === "DISABLED"') < source.indexOf('if ([401, 403].includes(status))'), 'disabled capability handling must run before generic 401/403 auth-failure handling');
assert(source.includes('markRouteFailure(route, "connector_auth_failed"'), 'generic auth failures must still mark route failure');

console.log('connector disabled capability health tests passed');
