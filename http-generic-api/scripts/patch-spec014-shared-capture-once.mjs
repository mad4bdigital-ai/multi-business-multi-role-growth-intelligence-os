#!/usr/bin/env node
import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }
function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Missing transformation anchor: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Ambiguous transformation anchor: ${label}`);
  return `${source.slice(0, index)}${after}${source.slice(index + before.length)}`;
}

const wrapperPath = 'http-generic-api/hostingerStorageSharedCanary.js';
let wrapper = read(wrapperPath);
const oldExecute = `export function executeHostingerStorageSharedCanary(input = {}) {
  const authorization = input.canary_authorization?.authorization;
  const verification = verifyHostingerStorageSharedCanaryAuthorization({
    authorization,
    expected_digest: input.canary_authorization?.authorization_digest,
    now_epoch: input.now_epoch,
  });
  if (!verification.valid) throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORIZATION_INVALID', 'Shared canary authorization is stale or blocked.', { blockers: verification.blockers });
  requireCanonicalRepository(input.repository);
  requireCanonicalAdapter(input.adapter);
  requireCanonicalAuthorityStore(input.authority_store);
  requireCanonicalEnablementRegistry(input.enablement_registry);
  if (authorization?.quorum_policy?.mode === 'approved_quorum') {
    const quorumRecord = normalizeQuorumEvidence(authorization.quorum_policy);
    const blockers = governedQuorumBlockers(quorumRecord, input.authority_store, authorization, epoch(input.now_epoch ?? Math.floor(Date.now() / 1000), 'now_epoch'));
    if (blockers.length) throw fail(409, 'STORAGE_SHARED_CANARY_QUORUM_CURRENT_STATE_INVALID', 'Current governed quorum evidence no longer authorizes this Shared canary.', { blockers });
  }
  preflightPlanStatus({ authorization, repository: input.repository });
  return executeCoreCanary(input);
}
`;
const newExecute = `export function executeHostingerStorageSharedCanary(input = {}) {
  const canaryAuthorization = input.canary_authorization;
  const protocol = input.protocol;
  const protocolDigest = input.protocol_digest;
  const repository = input.repository;
  const adapter = input.adapter;
  const authorityStore = input.authority_store;
  const enablementRegistry = input.enablement_registry;
  const fault = input.fault ?? null;
  const nowEpoch = input.now_epoch ?? Math.floor(Date.now() / 1000);
  const authorization = canaryAuthorization?.authorization;
  const verification = verifyHostingerStorageSharedCanaryAuthorization({
    authorization,
    expected_digest: canaryAuthorization?.authorization_digest,
    now_epoch: nowEpoch,
  });
  if (!verification.valid) throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORIZATION_INVALID', 'Shared canary authorization is stale or blocked.', { blockers: verification.blockers });
  requireCanonicalRepository(repository);
  requireCanonicalAdapter(adapter);
  requireCanonicalAuthorityStore(authorityStore);
  requireCanonicalEnablementRegistry(enablementRegistry);
  if (authorization?.quorum_policy?.mode === 'approved_quorum') {
    const quorumRecord = normalizeQuorumEvidence(authorization.quorum_policy);
    const blockers = governedQuorumBlockers(quorumRecord, authorityStore, authorization, epoch(nowEpoch, 'now_epoch'));
    if (blockers.length) throw fail(409, 'STORAGE_SHARED_CANARY_QUORUM_CURRENT_STATE_INVALID', 'Current governed quorum evidence no longer authorizes this Shared canary.', { blockers });
  }
  preflightPlanStatus({ authorization, repository });
  const capturedInput = Object.freeze({
    canary_authorization: canaryAuthorization,
    protocol,
    protocol_digest: protocolDigest,
    repository,
    adapter,
    authority_store: authorityStore,
    enablement_registry: enablementRegistry,
    fault,
    now_epoch: nowEpoch,
  });
  return executeCoreCanary(capturedInput);
}
`;
wrapper = replaceOnce(wrapper, oldExecute, newExecute, 'single-read Shared execution boundary');
write(wrapperPath, wrapper);

const testPath = 'http-generic-api/test-hostinger-storage-shared-canary.mjs';
let test = read(testPath);
const captureTest = `const captureOnceFixture = fixtureFor('shared-capture-once');
const captureOncePrepared = prepare(captureOnceFixture);
const captureOnceStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const captureOnceRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(captureOnceStore, captureOnceRegistry, captureOnceFixture, captureOncePrepared);
const dependencyReads = { repository: 0, adapter: 0, authority_store: 0, enablement_registry: 0 };
const captureOnceInput = {
  canary_authorization: captureOncePrepared.authorization,
  protocol: captureOncePrepared.protocol,
  protocol_digest: captureOncePrepared.protocolDigest,
  fault: null,
  now_epoch: 1100,
};
const poisonedDependency = Object.freeze({});
Object.defineProperties(captureOnceInput, {
  repository: { enumerable: true, get() { dependencyReads.repository += 1; return dependencyReads.repository === 1 ? captureOncePrepared.repository : poisonedDependency; } },
  adapter: { enumerable: true, get() { dependencyReads.adapter += 1; return dependencyReads.adapter === 1 ? captureOnceFixture.adapter : poisonedDependency; } },
  authority_store: { enumerable: true, get() { dependencyReads.authority_store += 1; return dependencyReads.authority_store === 1 ? captureOnceStore : poisonedDependency; } },
  enablement_registry: { enumerable: true, get() { dependencyReads.enablement_registry += 1; return dependencyReads.enablement_registry === 1 ? captureOnceRegistry : poisonedDependency; } },
});
const captureOnceResult = executeHostingerStorageSharedCanary(captureOnceInput);
assert.equal(captureOnceResult.ok, true);
assert.deepEqual(dependencyReads, { repository: 1, adapter: 1, authority_store: 1, enablement_registry: 1 });
assert.equal(captureOnceRegistry.exportState()[0].consumed, true);

`;
test = replaceOnce(test, "const unknownFixture = fixtureFor('shared-unknown');\n", `${captureTest}const unknownFixture = fixtureFor('shared-unknown');\n`, 'capture-once regression insertion');
test = replaceOnce(test, '  forged_dependency_callbacks_not_invoked: true,\n', '  forged_dependency_callbacks_not_invoked: true,\n  dependency_getters_captured_once: true,\n', 'capture-once result evidence');
write(testPath, test);

const guardPath = '.github/workflows/hostinger-storage-shared-canary-guard.yml';
let guard = read(guardPath);
guard = replaceOnce(guard, "          grep -q \"enablement_registry_provenance\" http-generic-api/test-hostinger-storage-shared-canary.mjs\n", "          grep -q \"enablement_registry_provenance\" http-generic-api/test-hostinger-storage-shared-canary.mjs\n          grep -q \"dependency_getters_captured_once\" http-generic-api/test-hostinger-storage-shared-canary.mjs\n          grep -q \"const capturedInput = Object.freeze\" http-generic-api/hostingerStorageSharedCanary.js\n", 'capture-once guard markers');
guard = replaceOnce(guard, "          const repositoryBrand = wrapper.indexOf('requireCanonicalRepository(input.repository);');\n          const adapterBrand = wrapper.indexOf('requireCanonicalAdapter(input.adapter);');\n          const storeBrand = wrapper.indexOf('requireCanonicalAuthorityStore(input.authority_store);');\n          const registryBrand = wrapper.indexOf('requireCanonicalEnablementRegistry(input.enablement_registry);');\n          const quorumRead = wrapper.indexOf('store.readQuorum(record.policy_id)');\n          const planStatus = wrapper.indexOf('preflightPlanStatus({ authorization, repository: input.repository });');\n          const coreDispatch = wrapper.indexOf('return executeCoreCanary(input);');\n", "          const repositoryBrand = wrapper.indexOf('requireCanonicalRepository(repository);');\n          const adapterBrand = wrapper.indexOf('requireCanonicalAdapter(adapter);');\n          const storeBrand = wrapper.indexOf('requireCanonicalAuthorityStore(authorityStore);');\n          const registryBrand = wrapper.indexOf('requireCanonicalEnablementRegistry(enablementRegistry);');\n          const quorumRead = wrapper.indexOf('store.readQuorum(record.policy_id)');\n          const planStatus = wrapper.indexOf('preflightPlanStatus({ authorization, repository });');\n          const capturedInput = wrapper.indexOf('const capturedInput = Object.freeze');\n          const coreDispatch = wrapper.indexOf('return executeCoreCanary(capturedInput);');\n", 'capture-once guard ordering variables');
guard = replaceOnce(guard, "            && planStatus > quorumRead\n            && coreDispatch > planStatus)) {\n", "            && planStatus > quorumRead\n            && capturedInput > planStatus\n            && coreDispatch > capturedInput)) {\n", 'capture-once guard ordering assertion');
write(guardPath, guard);

console.log(JSON.stringify({ ok: true, patch: 'shared_capture_once', secrets_included: false }));
