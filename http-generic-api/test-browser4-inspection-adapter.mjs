import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _testingBrowser4InspectionAdapter } from './browser4InspectionAdapter.js';

const { boundedTimeout, connectorEndpoint, sanitizeConnectorResult } = _testingBrowser4InspectionAdapter;

assert.equal(boundedTimeout(0), 180000);
assert.equal(boundedTimeout(999), 1000);
assert.equal(boundedTimeout(999999), 300000);
assert.equal(
  connectorEndpoint('essam-pc', 'http://localhost:8080/'),
  'http://localhost:8080/connector/essam-pc/browser4',
);

{
  const sanitized = sanitizeConnectorResult({
    ok: true,
    action: 'inspect_site',
    run_key: 'abc',
    target_host: 'n8n.mad4b.com',
    checks: ['snapshot'],
    exit_code: 0,
    status: 'completed',
    artifacts: { snapshot_path: 'D:/x/snapshot.txt' },
    stdout_preview: 'x'.repeat(3000),
    stderr_preview: 'y'.repeat(3000),
    secret: 'should not be copied',
  });
  assert.equal(sanitized.ok, true);
  assert.equal(sanitized.secrets_included, false);
  assert.equal(sanitized.stdout_preview.length, 2000);
  assert.equal(sanitized.stderr_preview.length, 2000);
  assert.equal(sanitized.secret, undefined);
}

{
  const route = readFileSync('routes/browserRuntimeRoutes.js', 'utf8');
  assert(route.includes('/browser-runtime/inspect-site/run'));
  assert(route.includes('runBrowser4InspectionAdapter'));
}

{
  const proxy = readFileSync('routes/connectorProxyRoutes.js', 'utf8');
  assert(proxy.includes('/connector/:device_id/browser4'));
  assert(proxy.includes('"/browser4"'));
}

{
  const migration = readFileSync('migrations/131_sprint65_browser4_local_adapter.sql', 'utf8');
  assert(migration.includes('connector_browser4'));
  assert(migration.includes('browser_runtime_inspect_site_run'));
  assert(migration.includes('/browser-runtime/inspect-site/run'));
}

{
  const connectorAgentRoutes = readFileSync('routes/connectorAgentRoutes.js', 'utf8');
  const localInstallRoutes = readFileSync('routes/localConnectorInstallRoutes.js', 'utf8');
  for (const source of [connectorAgentRoutes, localInstallRoutes]) {
    assert(source.includes('CONNECTOR_BROWSER4_ENABLED=true'));
    assert(source.includes('BROWSER4_ALLOWED_HOSTS=mad4b.com,n8n.mad4b.com'));
    assert(source.includes('BROWSER4_JAVA_HOME=D:\\\\n8n-data\\\\browser-runtime\\\\jre17\\\\jdk-17.0.19+10-jre'));
  }
}

console.log('browser4 inspection adapter tests passed');
