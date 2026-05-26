import assert from 'node:assert/strict';
import {
  buildBrowser4InspectionScript,
  parseBrowser4AllowedHosts,
  sanitizeBrowser4Checks,
  validateBrowser4Url,
} from './browser4-adapter.mjs';

assert.deepEqual(parseBrowser4AllowedHosts('mad4b.com, n8n.mad4b.com'), ['mad4b.com', 'n8n.mad4b.com']);

{
  const target = validateBrowser4Url('https://n8n.mad4b.com/', ['mad4b.com']);
  assert.equal(target.host, 'n8n.mad4b.com');
  assert.equal(target.url, 'https://n8n.mad4b.com/');
}

assert.throws(() => validateBrowser4Url('file:///tmp/secret', ['mad4b.com']), /http or https/);
assert.throws(() => validateBrowser4Url('https://evil.example.net/', ['mad4b.com']), /allowlist/);

assert.deepEqual(sanitizeBrowser4Checks(['snapshot', 'snapshot', 'dom_snapshot']), ['snapshot', 'dom_snapshot']);
assert.throws(() => sanitizeBrowser4Checks(['eval']), /unsupported Browser4 check/);

{
  const built = buildBrowser4InspectionScript({
    url: 'https://n8n.mad4b.com/',
    checks: ['snapshot', 'screenshot'],
    runKey: 'smoke/unsafe key',
    workDir: 'D:\\n8n-data\\browser-runtime-artifacts',
    javaHome: 'D:\\n8n-data\\browser-runtime\\jre17\\jdk-17.0.19+10-jre',
  });
  assert.equal(built.secrets_included, false);
  assert.equal(built.run_key, 'smoke_unsafe_key');
  assert(built.script.includes('browser4-cli open --server'));
  assert(built.script.includes('browser4-cli goto'));
  assert(built.script.includes('browser4-cli snapshot'));
  assert(built.script.includes('browser4-cli screenshot'));
  assert(!built.script.includes('Authorization'));
  assert(!built.script.includes('access_token'));
}

console.log('browser4 adapter helper tests passed');
