import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  boundedEvidencePayload,
  buildAuditPayloadEvidence,
  redactAuditPayload,
} from './auditPayloadEvidence.js';

const routeFile = readFileSync('routes/securityRoutes.js', 'utf8');
const migration = readFileSync('migrations/164_sprint65_audit_payload_evidence.sql', 'utf8');
const openapi = readFileSync('openapi.yaml', 'utf8');

const redacted = redactAuditPayload({
  authorization: 'Bearer secret-token',
  nested: { api_key: 'secret-key', safe: 'visible' },
  items: [{ password: 'hidden', value: 'visible-item' }],
});
assert.equal(redacted.authorization, '[REDACTED]');
assert.equal(redacted.nested.api_key, '[REDACTED]');
assert.equal(redacted.nested.safe, 'visible');
assert.equal(redacted.items[0].password, '[REDACTED]');
assert.equal(redacted.items[0].value, 'visible-item');

const bounded = boundedEvidencePayload({ token: 'SHOULD_NOT_APPEAR', safe: 'ok' }, 128);
assert.equal(bounded.redaction_status, 'redacted');
assert.equal(bounded.raw_sha256.length, 64);
assert.equal(bounded.redacted_sha256.length, 64);
assert(!bounded.preview.includes('SHOULD_NOT_APPEAR'));
assert(bounded.preview.includes('[REDACTED]'));

const evidence = buildAuditPayloadEvidence({
  tenant_id: 'tenant-1',
  actor_id: 'actor-1',
  action: 'audit.payload_evidence_smoke',
  source_table: 'audit_log',
  source_pk: 'audit-1',
  request_payload: { authorization: 'Bearer SHOULD_NOT_APPEAR', safe: 'request' },
  response_payload: { token: 'SHOULD_NOT_APPEAR', safe: 'response' },
});
assert.equal(evidence.redaction_status, 'redacted');
assert.equal(evidence.secrets_included, false);
assert.equal(evidence.request_sha256.length, 64);
assert.equal(evidence.response_sha256.length, 64);
assert(!evidence.request_preview.includes('SHOULD_NOT_APPEAR'));
assert(!evidence.response_preview.includes('SHOULD_NOT_APPEAR'));
assert(JSON.parse(evidence.metadata_json).policy.secret_values_returned === false);
assert(JSON.parse(evidence.metadata_json).policy.token_returned === false);

assert(routeFile.includes('/audit/evidence/smoke'), 'audit payload evidence smoke route must exist');
assert(routeFile.includes('writeAuditPayloadEvidence'), 'route must write bounded audit payload evidence');
assert(routeFile.includes('secret_values_returned: false'), 'route must not return secret values');
assert(routeFile.includes('token_returned: false'), 'route must not return tokens');
assert(routeFile.includes('secrets_included: false'), 'route must report secrets_included=false');
assert(routeFile.includes('DELETE FROM `audit_payload_evidence`'), 'smoke route must support cleanup');
assert(!routeFile.includes('includeSecret: true'), 'audit evidence route must not request secret inclusion');

assert(migration.includes('CREATE TABLE IF NOT EXISTS `audit_payload_evidence`'), 'audit payload evidence table migration must exist');
assert(migration.includes('request_preview'), 'migration must include bounded request preview');
assert(migration.includes('request_sha256'), 'migration must include request hash');
assert(migration.includes('response_preview'), 'migration must include bounded response preview');
assert(migration.includes('response_sha256'), 'migration must include response hash');
assert(migration.includes('secrets_included'), 'migration must include secrets flag');
assert(migration.includes('audit_payload_evidence_smoke'), 'admin tool must be registered');
assert(migration.includes('no_secrets'), 'admin tool must be tagged no_secrets');
assert(migration.includes('no_token_returned'), 'admin tool must be tagged no_token_returned');

assert(openapi.includes('/audit/evidence/smoke:'), 'audit evidence smoke path must be documented');
assert(openapi.includes('AuditPayloadEvidenceSmokeRequest'), 'audit evidence smoke request schema must be documented');
assert(openapi.includes('AuditPayloadEvidenceSmokeResponse'), 'audit evidence smoke response schema must be documented');

console.log('audit payload evidence tests passed');
